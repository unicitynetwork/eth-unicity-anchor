#!/bin/bash

# Ensure the script exits if any command fails
set -e

# Check if existing Ethereum nodes are running
if ss -tln | grep ":8545 " > /dev/null; then
  echo "A process is already listening on port 8545. Make sure no other Ethereum node is running."
  exit 1
fi

# Start Anvil in the background
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

# Create a simple deployer script
cat > deploy-script.js << 'EOL'
const { ethers } = require('ethers');
const fs = require('fs');

async function main() {
  // Connect to local Anvil node
  const provider = new ethers.JsonRpcProvider('http://localhost:8545');
  
  // Use the default private key from Anvil
  const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const wallet = new ethers.Wallet(privateKey, provider);
  
  // Read the contract ABI and bytecode from the Forge output JSON
  const contractJson = JSON.parse(fs.readFileSync('./out/AggregatorBatches.sol/AggregatorBatches.json', 'utf8'));
  const bytecode = contractJson.bytecode.object;
  const abi = contractJson.abi;
  
  // Create contract factory
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  
  // Deploy contract with constructor arguments
  // Initial trusted aggregator is the deployer address, required votes is 1
  const deployerAddress = wallet.address;
  const contract = await factory.deploy([deployerAddress], 1);
  
  // Wait for deployment to be mined
  await contract.waitForDeployment();
  
  // Get contract address
  const contractAddress = await contract.getAddress();
  console.log('Contract deployed to:', contractAddress);
  
  // Write contract address to file for use in tests
  fs.writeFileSync('./contract-address.txt', contractAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
EOL

# Make sure we have the contract compiled with Foundry
echo "Compiling contract with Forge..."
forge build

# Run the deploy script
echo "Deploying contract..."
node deploy-script.js

# Check if the contract address file exists
if [ ! -f "./contract-address.txt" ]; then
  echo "Failed to deploy contract."
  exit 1
fi

# Get the contract address
CONTRACT_ADDRESS=$(cat ./contract-address.txt)
echo "Contract deployed at: $CONTRACT_ADDRESS"

# Run the integration tests with the contract address
echo "Running integration tests..."
cd ts-client
echo "Contract address for tests: $CONTRACT_ADDRESS"
CONTRACT_ADDRESS=$CONTRACT_ADDRESS npm run test:integration -- --verbose

echo "Integration tests completed!"