#!/bin/bash
# -----------------------------------------------------------------------
# Ethereum Unicity Anchor Integration Test Runner
#
# This script:
# 1. Starts a local Anvil Ethereum node
# 2. Compiles and deploys the AggregatorBatches contract
# 3. Runs the TypeScript client integration tests against the deployed contract
# 4. Cleans up resources when done or if interrupted
# -----------------------------------------------------------------------

# Ensure the script exits if any command fails
set -e

# Check if existing Ethereum nodes are running
if ss -tln | grep ":8545 " > /dev/null; then
  echo "ERROR: A process is already listening on port 8545. Make sure no other Ethereum node is running."
  echo "You can use 'lsof -i :8545' or 'fuser 8545/tcp' to identify the process."
  exit 1
fi

# Start Anvil in the background
echo "Starting Anvil node..."
anvil > anvil.log 2>&1 &
ANVIL_PID=$!

# Verify Anvil started successfully
if ! ps -p $ANVIL_PID > /dev/null; then
  echo "ERROR: Failed to start Anvil node. Check anvil.log for details."
  exit 1
fi

# Give the node some time to start
echo "Waiting 5 seconds for node to start..."
sleep 5

# Ensure we kill the node when the script exits
cleanup() {
  echo "Shutting down Anvil node (PID: $ANVIL_PID)..."
  kill $ANVIL_PID 2>/dev/null || true
  rm -f deploy-script.js contract-address.txt 2>/dev/null || true
  echo "Node shutdown complete."
}
trap cleanup EXIT INT TERM

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
forge build --quiet || { echo "ERROR: Contract compilation failed"; exit 1; }

# Run the deploy script
echo "Deploying contract..."
node deploy-script.js || { echo "ERROR: Contract deployment failed"; exit 1; }

# Check if the contract address file exists
if [ ! -f "./contract-address.txt" ]; then
  echo "ERROR: Failed to extract contract address from deployment."
  exit 1
fi

# Get the contract address
CONTRACT_ADDRESS=$(cat ./contract-address.txt)
echo "Contract deployed at: $CONTRACT_ADDRESS"

# Verify contract was deployed correctly
echo "Verifying contract deployment..."
curl -s -X POST -H "Content-Type: application/json" --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getCode\",\"params\":[\"$CONTRACT_ADDRESS\", \"latest\"],\"id\":1}" http://localhost:8545 | grep -q "0x" || { echo "ERROR: Contract not deployed correctly"; exit 1; }

# Run the integration tests with the contract address
echo "Running integration tests..."
cd ts-client
echo "Contract address for tests: $CONTRACT_ADDRESS"
CONTRACT_ADDRESS=$CONTRACT_ADDRESS npm run test:integration -- --verbose --forceExit --testTimeout=60000

TEST_EXIT_CODE=$?
if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo "✅ Integration tests completed successfully!"
else
  echo "❌ Integration tests failed with exit code $TEST_EXIT_CODE"
  # Don't exit with error code, as we want the cleanup to run
fi

# Return to root directory
cd ..