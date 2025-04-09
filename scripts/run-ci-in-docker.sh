#!/bin/bash
# Run CI workflows in a Docker container

set -e  # Exit on error

# Parse command line arguments
CI_WORKFLOW="test"  # Default to test workflow
DOCKER_IMAGE="ubuntu:22.04"  # Default Docker image

print_usage() {
  echo "Usage: $0 [options]"
  echo "Options:"
  echo "  --workflow=WORKFLOW  Specify the workflow to run (test, nightly)"
  echo "  --image=IMAGE        Specify Docker image (default: ubuntu:22.04)"
  echo "  --help               Show this help message"
}

for arg in "$@"; do
  case $arg in
    --workflow=*)
      CI_WORKFLOW="${arg#*=}"
      ;;
    --image=*)
      DOCKER_IMAGE="${arg#*=}"
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

echo "🚀 Running CI workflow in Docker: $CI_WORKFLOW"
echo "📦 Using Docker image: $DOCKER_IMAGE"

# Make sure we're in the project root
cd "$(git rev-parse --show-toplevel)"

# Create a temporary Dockerfile
cat > Dockerfile.ci << EOF
FROM $DOCKER_IMAGE

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    git \
    gnupg \
    software-properties-common \
    bc \
    && rm -rf /var/lib/apt/lists/*

# Install Foundry
RUN curl -L https://foundry.paradigm.xyz | bash
ENV PATH="\$PATH:/root/.foundry/bin"
RUN foundryup

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
RUN apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*

# Create a workspace
WORKDIR /workspace

# Copy workflow scripts
COPY .github/workflows /workspace/.github/workflows
COPY scripts/run-ci-locally.sh /workspace/scripts/

# Make the script executable
RUN chmod +x /workspace/scripts/run-ci-locally.sh

# Set entrypoint
ENTRYPOINT ["/workspace/scripts/run-ci-locally.sh"]
CMD ["--workflow=$CI_WORKFLOW"]
EOF

# Build the CI image
echo "🔨 Building CI Docker image..."
docker build -t eth-unicity-anchor-ci -f Dockerfile.ci .

# Run the CI in Docker
echo "🐳 Running CI workflow in Docker container..."
docker run --rm -it \
  -v "$(pwd):/workspace" \
  eth-unicity-anchor-ci --workflow="$CI_WORKFLOW"

# Clean up
rm -f Dockerfile.ci

echo "✅ CI run completed!"