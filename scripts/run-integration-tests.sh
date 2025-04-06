#!/bin/bash

# Ensure the script exits if any command fails
set -e

# Check if existing Hardhat node is running
if nc -z localhost 8545 2>/dev/null; then
  echo "A process is already listening on port 8545. Make sure no other Ethereum node is running."
  exit 1
fi

# Start Hardhat node in the background
echo "Starting Hardhat node..."
npm run node &
HARDHAT_PID=$!

# Give the node some time to start
sleep 5

# Ensure we kill the node when the script exits
cleanup() {
  echo "Shutting down Hardhat node..."
  kill $HARDHAT_PID 2>/dev/null || true
}
trap cleanup EXIT

# Deploy the contract
echo "Deploying contract..."
npm run deploy:local

# Get the deployed contract address
CONTRACT_ADDRESS=$(grep -o "AggregatorBatches deployed to: 0x[a-fA-F0-9]\+" hardhat.log | cut -d' ' -f4)

if [ -z "$CONTRACT_ADDRESS" ]; then
  echo "Failed to extract contract address from deployment logs."
  exit 1
fi

echo "Contract deployed at: $CONTRACT_ADDRESS"

# Run the integration tests with the contract address
echo "Running integration tests..."
cd ts-client
CONTRACT_ADDRESS=$CONTRACT_ADDRESS npm run test:integration

echo "Integration tests completed!"