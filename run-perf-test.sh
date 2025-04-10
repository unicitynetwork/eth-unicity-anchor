#!/bin/bash
# Enhanced performance tests for the batch commitment features
#
# This script focuses specifically on running the performance comparison tests
# to demonstrate the gas savings achieved by batch operations compared to
# individual submissions using the fixed TypeScript client.

set -e

# Build the contract
echo "Building contract..."
forge build --quiet

# Start Anvil in the background
echo "Starting Anvil..."
anvil > /dev/null 2>&1 &
ANVIL_PID=$!
echo "Anvil started with PID: $ANVIL_PID"
sleep 2

# Deploy the contract
echo "Deploying contract..."
node << 'EOL' > ts-client/deploy-output.txt
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
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
EOL

# Extract contract address
CONTRACT_ADDRESS=$(grep -oP 'Contract deployed to: \K[^\s]+' ts-client/deploy-output.txt)
echo "Contract deployed at: $CONTRACT_ADDRESS"

# Run the performance test
echo "Running performance test..."
cd ts-client
CONTRACT_ADDRESS=$CONTRACT_ADDRESS npm test -- -t "should demonstrate performance improvements with batch operations" --testTimeout=90000 > perf-test-output.txt 2>&1
TEST_EXIT_CODE=$?

# Display the performance comparison
echo "Performance test completed with exit code: $TEST_EXIT_CODE"
if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo "✅ Performance test passed!"
  echo "Performance comparison:"
  grep -A 20 "===== PERFORMANCE COMPARISON SUMMARY =====" perf-test-output.txt | head -10
  
  # Extract the gas savings percentages
  BATCH_SAVINGS=$(grep -oP "Batch submission gas savings: \K[0-9]+\.[0-9]+" perf-test-output.txt)
  COMBINED_SAVINGS=$(grep -oP "Combined operation gas savings: \K[0-9]+\.[0-9]+" perf-test-output.txt)
  
  echo ""
  echo "Gas savings summary:"
  echo "🔹 Batch submission: $BATCH_SAVINGS% gas savings compared to individual transactions"
  echo "🔸 Combined operation: $COMBINED_SAVINGS% gas savings compared to individual transactions"
else
  echo "❌ Performance test failed"
  echo "Test output:"
  grep -E "(FAIL|ERROR)" perf-test-output.txt
fi

# Cleanup
echo "Stopping Anvil..."
kill $ANVIL_PID
wait $ANVIL_PID 2>/dev/null || true

exit $TEST_EXIT_CODE