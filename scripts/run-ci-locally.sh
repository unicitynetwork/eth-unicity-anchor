#!/bin/bash
# Script to run CI workflows locally

set -e  # Exit on error

# Parse command line arguments
CI_WORKFLOW="test"  # Default to test workflow
VERBOSE=false
SKIP_INTEGRATION_TESTS=true  # Skip integration tests by default

print_usage() {
  echo "Usage: $0 [options]"
  echo "Options:"
  echo "  --workflow=WORKFLOW  Specify the workflow to run (test, nightly)"
  echo "  --verbose            Enable verbose output"
  echo "  --integration        Enable integration tests (requires Anvil)"
  echo "  --help               Show this help message"
}

for arg in "$@"; do
  case $arg in
    --workflow=*)
      CI_WORKFLOW="${arg#*=}"
      ;;
    --verbose)
      VERBOSE=true
      ;;
    --integration)
      SKIP_INTEGRATION_TESTS=false
      ;;
    --help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg"
      print_usage
      exit 1
      ;;
  esac
done

echo "🚀 Running CI workflow locally: $CI_WORKFLOW"

# Make sure we're in the project root
if command -v git &> /dev/null && git rev-parse --is-inside-work-tree &> /dev/null; then
  cd "$(git rev-parse --show-toplevel)"
else
  # Already at the root in Docker
  cd "${WORKSPACE_ROOT:-/workspace}"
fi

# Define colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper function to run a step
run_step() {
  local step_name=$1
  local command=$2
  local allow_failure=${3:-false}
  
  echo -e "\n${BLUE}⏳ Running step: ${step_name}${NC}"
  
  if $VERBOSE; then
    # Run with direct output in verbose mode
    if ! eval "$command"; then
      if [ "$allow_failure" = "true" ]; then
        echo -e "${YELLOW}⚠️ Step had non-zero exit code but continuing: ${step_name}${NC}"
      else
        echo -e "${RED}❌ Step failed: ${step_name}${NC}"
        exit 1
      fi
    fi
  else
    # Run with captured output in normal mode
    local temp_log=$(mktemp)
    if ! eval "$command" > "$temp_log" 2>&1; then
      if [ "$allow_failure" = "true" ]; then
        echo -e "${YELLOW}⚠️ Step had non-zero exit code but continuing: ${step_name}${NC}"
        echo -e "${YELLOW}Last 20 lines of output:${NC}"
        tail -n 20 "$temp_log"
      else
        echo -e "${RED}❌ Step failed: ${step_name}${NC}"
        echo -e "${YELLOW}Last 20 lines of output:${NC}"
        tail -n 20 "$temp_log"
        echo -e "\nFull command output is above"
        rm -f "$temp_log"
        exit 1
      fi
    fi
    rm -f "$temp_log"
  fi
  
  if [ "$allow_failure" = "true" ]; then
    echo -e "${YELLOW}⚠️ Step completed (with possible warnings): ${step_name}${NC}"
  else
    echo -e "${GREEN}✅ Step completed: ${step_name}${NC}"
  fi
}

# Check required tools
check_tools() {
  echo -e "${BLUE}Checking required tools...${NC}"
  
  if ! command -v forge &> /dev/null; then
    echo -e "${RED}❌ Foundry (forge) not found. Please install it first: https://getfoundry.sh/${NC}"
    exit 1
  fi
  
  if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install it first.${NC}"
    exit 1
  fi
  
  node_version=$(node -v | cut -d'v' -f2)
  node_major_version=$(echo "$node_version" | cut -d'.' -f1)
  
  if [[ "$node_major_version" -lt 20 ]]; then
    echo -e "${YELLOW}⚠️ Node.js version is less than 20.0.0 (found $node_version). The CI uses Node.js 20.${NC}"
  fi
  
  # Check for Anvil if integration tests are enabled
  if [[ "$SKIP_INTEGRATION_TESTS" != "true" ]]; then
    if ! command -v anvil &> /dev/null; then
      echo -e "${RED}❌ Anvil not found, but required for integration tests. Please install it first: https://getfoundry.sh/${NC}"
      exit 1
    fi
    
    # Check if port 8545 is already in use
    if ss -tln | grep ":8545 " > /dev/null; then
      echo -e "${RED}❌ Port 8545 is already in use. Integration tests need this port for Anvil.${NC}"
      echo -e "${RED}   Please stop any Ethereum nodes or services using this port and try again.${NC}"
      exit 1
    fi
  fi
  
  echo -e "${GREEN}✅ All required tools found${NC}"
}

# Common steps for all workflows
run_common_steps() {
  # Check code formatting
  run_step "Code Formatting Check" "forge fmt --check"
  
  # Build contracts
  run_step "Build Contracts" "forge build --sizes"
}

# Run test workflow
run_test_workflow() {
  echo -e "${BLUE}🔍 Running Test Workflow${NC}"
  
  run_common_steps
  
  # Run contract tests
  run_step "Smart Contract Tests" "forge test -vvv"
  
  # Install dependencies for both root and TypeScript client
  run_step "Installing root dependencies" "npm ci"
  run_step "Installing TypeScript client dependencies" "cd ts-client && npm ci && cd .."
  
  # Run TypeScript unit tests and fail pipeline if they fail
  run_step "TypeScript Unit Tests" "cd ts-client && npm run test:unit && cd .."
  
  # Run integration tests if enabled
  if [[ "$SKIP_INTEGRATION_TESTS" != "true" ]]; then
    # First try to ensure the script is executable wherever it might be
    chmod +x ./scripts/manual-e2e-test.sh 2>/dev/null || true
    chmod +x /workspace/scripts/manual-e2e-test.sh 2>/dev/null || true
    
    # Try to find the script in different locations
    if [ -f "./scripts/manual-e2e-test.sh" ]; then
      run_step "TypeScript Integration Tests" "VERBOSE=$VERBOSE ./scripts/manual-e2e-test.sh" 
    elif [ -f "/workspace/scripts/manual-e2e-test.sh" ]; then
      run_step "TypeScript Integration Tests" "VERBOSE=$VERBOSE /workspace/scripts/manual-e2e-test.sh" 
    else
      echo -e "${RED}❌ Could not find manual-e2e-test.sh script in any expected location${NC}"
      echo -e "Current directory: $(pwd)"
      echo -e "Contents of ./scripts/:"
      ls -la ./scripts/ 2>/dev/null || echo "Directory not found"
      echo -e "Contents of /workspace/scripts/:"
      ls -la /workspace/scripts/ 2>/dev/null || echo "Directory not found"
    fi
  else
    echo -e "${YELLOW}⚠️ Skipping integration tests - use --integration to enable them${NC}"
  fi
  
  echo -e "\n${GREEN}✅ Test workflow completed successfully!${NC}"
}

# Run nightly workflow
run_nightly_workflow() {
  echo -e "${BLUE}🌙 Running Nightly Workflow${NC}"
  
  run_common_steps
  
  # Run contract tests with coverage
  run_step "Smart Contract Tests with Coverage" "forge test -vvv && forge coverage --report lcov"
  
  # Install dependencies for both root and TypeScript client
  run_step "Installing root dependencies" "npm ci"
  run_step "Installing TypeScript client dependencies" "cd ts-client && npm ci && cd .."
  
  # Run TypeScript unit tests with coverage and fail pipeline if they fail
  run_step "TypeScript Tests with Coverage" "cd ts-client && npm run test:unit -- --coverage && cd .."
  
  # Run integration tests if enabled
  if [[ "$SKIP_INTEGRATION_TESTS" != "true" ]]; then
    # First try to ensure the script is executable wherever it might be
    chmod +x ./scripts/manual-e2e-test.sh 2>/dev/null || true
    chmod +x /workspace/scripts/manual-e2e-test.sh 2>/dev/null || true
    
    # Try to find the script in different locations
    if [ -f "./scripts/manual-e2e-test.sh" ]; then
      run_step "TypeScript Integration Tests" "VERBOSE=$VERBOSE ./scripts/manual-e2e-test.sh" 
    elif [ -f "/workspace/scripts/manual-e2e-test.sh" ]; then
      run_step "TypeScript Integration Tests" "VERBOSE=$VERBOSE /workspace/scripts/manual-e2e-test.sh" 
    else
      echo -e "${RED}❌ Could not find manual-e2e-test.sh script in any expected location${NC}"
      echo -e "Current directory: $(pwd)"
      echo -e "Contents of ./scripts/:"
      ls -la ./scripts/ 2>/dev/null || echo "Directory not found"
      echo -e "Contents of /workspace/scripts/:"
      ls -la /workspace/scripts/ 2>/dev/null || echo "Directory not found"
    fi
  else
    echo -e "${YELLOW}⚠️ Skipping integration tests - use --integration to enable them${NC}"
  fi
  
  echo -e "\n${GREEN}✅ Nightly workflow completed successfully!${NC}"
}

# Main execution
check_tools

if [[ "$CI_WORKFLOW" == "test" ]]; then
  run_test_workflow
elif [[ "$CI_WORKFLOW" == "nightly" ]]; then
  run_nightly_workflow
else
  echo -e "${RED}❌ Unknown workflow: $CI_WORKFLOW${NC}"
  print_usage
  exit 1
fi

# No cleanup needed anymore

echo -e "\n${GREEN}🎉 All CI checks passed locally!${NC}"