#!/bin/bash

# Ensure the script exits if any command fails
set -e

# Check if existing Hardhat node is running
if ss -tln | grep ":8545 " > /dev/null; then
  echo "A process is already listening on port 8545. Make sure no other Ethereum node is running."
  exit 1
fi

# Start Anvil (Foundry's local Ethereum node) in the background
echo "Starting Anvil node..."
anvil > anvil.log 2>&1 &
ANVIL_PID=$!

# Give the node some time to start
echo "Waiting 5 seconds for node to start..."
sleep 5

# Ensure we kill the node when the script exits
cleanup() {
  echo "Shutting down Anvil node (PID: $ANVIL_PID)..."
  kill $ANVIL_PID 2>/dev/null || true
  echo "Node shutdown complete."
}
trap cleanup EXIT

# Deploy the contract using forge
echo "Deploying contract..."
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Get the default account address (first Anvil account)
DEFAULT_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

# Create a temporary file with constructor arguments (the default account and 1 required vote)
echo "[$DEFAULT_ADDRESS] 1" > constructor-args.txt

# Deploy with constructor arguments
forge create --rpc-url http://localhost:8545 --private-key $PRIVATE_KEY src/AggregatorBatches.sol:AggregatorBatches --constructor-args "[$DEFAULT_ADDRESS]" 1 --broadcast 2>&1 | tee deploy.log

# Get the deployed contract address
CONTRACT_ADDRESS=$(grep -o "Deployed to:.*0x[a-fA-F0-9]\+" deploy.log | grep -o "0x[a-fA-F0-9]\+")

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