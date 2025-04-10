#!/bin/bash
# Script to test batch commitment functionality with improved event extraction
# 
# This script specifically tests the fixed batch commitment functionality
# where transaction return values are properly extracted from emitted events.
# The client now correctly extracts:
# - successCount from RequestsSubmitted event
# - batchNumber from BatchCreated event
# 
# These fixes enable tests to properly verify batch operations.

# Start Anvil in the background
echo "Starting Anvil..."
anvil > /dev/null 2>&1 &
ANVIL_PID=$!
echo "Anvil started with PID: $ANVIL_PID"
sleep 2

# Build and deploy contract
echo "Building contract..."
forge build --quiet

echo "Deploying contract..."
node << 'EOL' > deploy-output.txt
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
CONTRACT_ADDRESS=$(grep -oP 'Contract deployed to: \K[^\s]+' deploy-output.txt)
echo "Contract deployed at: $CONTRACT_ADDRESS"

# Run all batch commitment tests
echo "Running batch commitment tests..."
cd ts-client
echo "Test 1: Submitting multiple commitments in a single transaction"
CONTRACT_ADDRESS=$CONTRACT_ADDRESS npm test -- -t "should submit multiple commitments in a single transaction" --testTimeout=60000 > batch-test-output.txt 2>&1
TEST1_EXIT_CODE=$?

echo "Test 2: Submitting commitments and creating batch in a single transaction"
CONTRACT_ADDRESS=$CONTRACT_ADDRESS npm test -- -t "should submit commitments and create batch in a single transaction" --testTimeout=60000 >> batch-test-output.txt 2>&1
TEST2_EXIT_CODE=$?

echo "Test 3: Performance comparison"
CONTRACT_ADDRESS=$CONTRACT_ADDRESS npm test -- -t "should demonstrate performance improvements with batch operations" --testTimeout=60000 >> batch-test-output.txt 2>&1
TEST3_EXIT_CODE=$?

# Show test results
echo "Tests completed with exit codes: $TEST1_EXIT_CODE, $TEST2_EXIT_CODE, $TEST3_EXIT_CODE"
echo "Test output summary:"
grep -E "(PASS|FAIL|ERROR|✓|✗|===)" batch-test-output.txt
echo "Performance comparison:"
grep -A 10 "PERFORMANCE COMPARISON SUMMARY" batch-test-output.txt | head -10

# Check overall success
if [ $TEST1_EXIT_CODE -eq 0 ] && [ $TEST2_EXIT_CODE -eq 0 ] && [ $TEST3_EXIT_CODE -eq 0 ]; then
    echo "✅ All tests passed successfully!"
    TEST_EXIT_CODE=0
else 
    echo "❌ Some tests failed"
    TEST_EXIT_CODE=1
fi

# Clean up
echo "Stopping Anvil..."
kill $ANVIL_PID
wait $ANVIL_PID 2>/dev/null || true