#!/bin/bash
# Script to run CI workflows locally

set -e  # Exit on error

# Parse command line arguments
CI_WORKFLOW="test"  # Default to test workflow
VERBOSE=false

print_usage() {
  echo "Usage: $0 [options]"
  echo "Options:"
  echo "  --workflow=WORKFLOW  Specify the workflow to run (test, nightly)"
  echo "  --verbose            Enable verbose output"
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
cd "$(git rev-parse --show-toplevel)"

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
  
  echo -e "\n${BLUE}⏳ Running step: ${step_name}${NC}"
  
  if $VERBOSE; then
    eval "$command"
  else
    if ! eval "$command" > step_output.log 2>&1; then
      echo -e "${RED}❌ Step failed: ${step_name}${NC}"
      echo -e "${YELLOW}Last 20 lines of output:${NC}"
      tail -n 20 step_output.log
      echo -e "\nFull logs available in step_output.log"
      exit 1
    fi
  fi
  
  echo -e "${GREEN}✅ Step completed: ${step_name}${NC}"
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
  if [[ $(echo "$node_version < 20.0.0" | bc -l) -eq 1 ]]; then
    echo -e "${YELLOW}⚠️ Node.js version is less than 20.0.0 (found $node_version). The CI uses Node.js 20.${NC}"
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
  
  # Run TypeScript client unit tests
  run_step "TypeScript Client Tests" "cd ts-client && npm run test:unit"
  
  # Run integration tests
  run_step "Integration Tests" "npm run test:integration"
  
  echo -e "\n${GREEN}✅ Test workflow completed successfully!${NC}"
}

# Run nightly workflow
run_nightly_workflow() {
  echo -e "${BLUE}🌙 Running Nightly Workflow${NC}"
  
  run_common_steps
  
  # Run contract tests with coverage
  run_step "Smart Contract Tests with Coverage" "forge test -vvv && forge coverage --report lcov"
  
  # Run all TypeScript client tests with coverage
  run_step "TypeScript Client Tests" "cd ts-client && npm test -- --coverage"
  
  # Run integration tests
  run_step "Integration Tests" "npm run test:integration"
  
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

# Clean up
rm -f step_output.log 2>/dev/null || true

echo -e "\n${GREEN}🎉 All CI checks passed locally!${NC}"