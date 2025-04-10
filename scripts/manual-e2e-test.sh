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

# Initialize the log file for test output
LOGFILE="e2e-test-output.log"
echo "============================================" > $LOGFILE
echo "Integration Test Run - $(date)" >> $LOGFILE
echo "============================================" >> $LOGFILE

# Function to log to both console and log file
log() {
  echo "$@" | tee -a $LOGFILE
}

# Verbose logging mode
VERBOSE=${VERBOSE:-false}
if [ "$VERBOSE" = "true" ]; then
  log "Running in verbose mode"
  # Redirect all commands output to log file as well
  exec > >(tee -a $LOGFILE) 2>&1
fi

# Log system information
log "System information:"
log "  OS: $(uname -a)"
log "  Node: $(node --version)"
log "  NPM: $(npm --version)"
log "  Foundry: $(forge --version)"
log ""

# Check if existing Ethereum nodes are running
if ss -tln | grep ":8545 " > /dev/null; then
  log "ERROR: A process is already listening on port 8545. Make sure no other Ethereum node is running."
  log "You can use 'lsof -i :8545' or 'fuser 8545/tcp' to identify the process."
  exit 1
fi

# Start Anvil in the background
log "Starting Anvil node..."
anvil > anvil.log 2>&1 &
ANVIL_PID=$!

# Verify Anvil started successfully
if ! ps -p $ANVIL_PID > /dev/null; then
  log "ERROR: Failed to start Anvil node. Check anvil.log for details."
  
  # Capture any error from anvil.log
  if [ -f anvil.log ]; then
    log "Anvil log content:"
    log "$(cat anvil.log)"
  fi
  
  exit 1
fi

# Give the node some time to start
log "Waiting 5 seconds for node to start..."
sleep 5

# Test connection to Anvil
log "Testing connection to Anvil..."
if ! curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' http://localhost:8545 | grep -q "result"; then
  log "ERROR: Could not connect to Anvil node at http://localhost:8545"
  
  # Capture any error from anvil.log
  if [ -f anvil.log ]; then
    log "Anvil log content:"
    log "$(cat anvil.log)"
  fi
  
  exit 1
fi
log "Connection successful!"

# Ensure we kill the node when the script exits
cleanup() {
  log "Shutting down Anvil node (PID: $ANVIL_PID)..."
  kill $ANVIL_PID 2>/dev/null || true
  
  # Keep logs for debugging
  log "Preserving deploy-script.js and contract-address.txt for debugging"
  
  log "Node shutdown complete."
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
log "Compiling contract with Forge..."
forge build --quiet || { 
  log "ERROR: Contract compilation failed"
  log "Forge build output:"
  forge build
  exit 1
}

# Run the deploy script
log "Deploying contract..."
node deploy-script.js 2>&1 | tee -a $LOGFILE || { 
  log "ERROR: Contract deployment failed"
  exit 1
}

# Check if the contract address file exists
if [ ! -f "./contract-address.txt" ]; then
  log "ERROR: Failed to extract contract address from deployment."
  exit 1
fi

# Get the contract address
CONTRACT_ADDRESS=$(cat ./contract-address.txt)
log "Contract deployed at: $CONTRACT_ADDRESS"

# Verify contract was deployed correctly
log "Verifying contract deployment..."
CONTRACT_CODE=$(curl -s -X POST -H "Content-Type: application/json" --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getCode\",\"params\":[\"$CONTRACT_ADDRESS\", \"latest\"],\"id\":1}" http://localhost:8545)

log "Contract code response: $CONTRACT_CODE"

if ! echo "$CONTRACT_CODE" | grep -q "0x"; then
  log "ERROR: Contract not deployed correctly. Empty bytecode."
  exit 1
fi

# Run the integration tests with the contract address
log "Running integration tests..."
cd ts-client
log "Contract address for tests: $CONTRACT_ADDRESS"

# Create integration test log file
INTEGRATION_LOG="integration-test.log"
log "Integration test output will be written to $INTEGRATION_LOG"

# Run tests with additional logging
CONTRACT_ADDRESS=$CONTRACT_ADDRESS FORCE_COLOR=0 npm run test:integration -- --verbose --forceExit --testTimeout=60000 > $INTEGRATION_LOG 2>&1
TEST_EXIT_CODE=$?

# Show test output in main log
if [ "$VERBOSE" = "true" ]; then
  log "Integration test output:"
  cat $INTEGRATION_LOG >> ../$LOGFILE
else
  log "Integration test output summary (see $INTEGRATION_LOG for details):"
  grep -E "(PASS|FAIL|ERROR|✓|✗)" $INTEGRATION_LOG | tail -20 >> ../$LOGFILE
fi

if [ $TEST_EXIT_CODE -eq 0 ]; then
  log "✅ Integration tests completed successfully!"
else
  log "❌ Integration tests failed with exit code $TEST_EXIT_CODE"
  # Don't exit with error code, as we want the cleanup to run
fi

# Return to root directory
cd ..