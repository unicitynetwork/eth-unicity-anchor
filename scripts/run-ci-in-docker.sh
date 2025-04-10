#!/bin/bash
# Script to run CI in Docker

set -e  # Exit on error

# Parse command line arguments
CI_WORKFLOW="test"  # Default to test workflow
VERBOSE=false
BUILD_ONLY=false
DOCKER_IMAGE="eth-unicity-anchor-ci"
RUN_INTEGRATION=false  # Default to not run integration tests

print_usage() {
  echo "Usage: $0 [options]"
  echo "Options:"
  echo "  --workflow=WORKFLOW  Specify the workflow to run (test, nightly)"
  echo "  --verbose            Enable verbose output"
  echo "  --build-only         Only build the Docker image, don't run tests"
  echo "  --image=NAME         Specify a custom Docker image name (default: eth-unicity-anchor-ci)"
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
    --build-only)
      BUILD_ONLY=true
      ;;
    --image=*)
      DOCKER_IMAGE="${arg#*=}"
      ;;
    --integration)
      RUN_INTEGRATION=true
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

# Define colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔨 Building Docker image: ${DOCKER_IMAGE}${NC}"

# Make sure we're in the project root
if command -v git &> /dev/null && git rev-parse --is-inside-work-tree &> /dev/null; then
  cd "$(git rev-parse --show-toplevel)"
fi

# Build Docker image
docker build -t "$DOCKER_IMAGE" -f Dockerfile.ci .

echo -e "${GREEN}✅ Docker image built successfully${NC}"

# If build-only flag is set, exit here
if $BUILD_ONLY; then
  echo -e "${BLUE}Image built successfully. Use the following command to run tests:${NC}"
  echo -e "  docker run --rm $DOCKER_IMAGE --workflow=$CI_WORKFLOW"
  exit 0
fi

echo -e "${BLUE}🚀 Running CI workflow in Docker: $CI_WORKFLOW${NC}"

# Run Docker container with appropriate flags
DOCKER_ARGS=""
if $VERBOSE; then
  DOCKER_ARGS="$DOCKER_ARGS --verbose"
fi

if $RUN_INTEGRATION; then
  DOCKER_ARGS="$DOCKER_ARGS --integration"
fi

docker run --rm "$DOCKER_IMAGE" --workflow="$CI_WORKFLOW" $DOCKER_ARGS

exit_code=$?

if [ $exit_code -eq 0 ]; then
  echo -e "${GREEN}✅ CI workflow completed successfully in Docker!${NC}"
else
  echo -e "${RED}❌ CI workflow failed in Docker with exit code $exit_code${NC}"
  exit $exit_code
fi