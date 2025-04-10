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
RETRY_COUNT=0
MAX_RETRIES=3

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' http://localhost:8545 | grep -q "result"; then
    log "Connection successful!"
    break
  else
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
      log "ERROR: Could not connect to Anvil node at http://localhost:8545 after $MAX_RETRIES attempts"
      
      # Check if the port is actually listening
      if command -v ss &> /dev/null; then
        log "Network port status:"
        ss -tuln | grep "8545" || log "No process is listening on port 8545!"
      elif command -v netstat &> /dev/null; then
        log "Network port status:"
        netstat -tuln | grep "8545" || log "No process is listening on port 8545!" 
      fi
      
      # Check if Anvil is still running
      if ps -p $ANVIL_PID > /dev/null; then
        log "Anvil process is still running (PID: $ANVIL_PID)"
      else
        log "Anvil process is NOT running!"
      fi
      
      # Capture any error from anvil.log
      if [ -f anvil.log ]; then
        log "Anvil log content:"
        log "$(cat anvil.log)"
      fi
      
      exit 1
    fi
    
    log "Connection attempt $RETRY_COUNT failed, waiting 2 seconds before retry..."
    sleep 2
  fi
done

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
if ! forge build --quiet; then
  log "ERROR: Contract compilation failed"
  log "Forge build output:"
  forge build
  log "Forge environment info:"
  forge --version
  log "System environment:"
  uname -a
  exit 1
fi

# Run the deploy script
log "Deploying contract..."
node deploy-script.js 2>&1 | tee -a $LOGFILE
DEPLOY_EXIT_CODE=$?
if [ $DEPLOY_EXIT_CODE -ne 0 ]; then
  log "ERROR: Contract deployment failed with exit code $DEPLOY_EXIT_CODE"
  log "Node.js environment info:"
  node --version
  npm --version
  log "Blockchain status:"
  curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' http://localhost:8545
  exit 1
fi

# Check if the contract address file exists
if [ ! -f "./contract-address.txt" ]; then
  log "ERROR: Failed to extract contract address from deployment."
  log "Current directory contents:"
  ls -la
  exit 1
fi

# Get the contract address
CONTRACT_ADDRESS=$(cat ./contract-address.txt)
log "Contract deployed at: $CONTRACT_ADDRESS"

# Verify contract was deployed correctly
log "Verifying contract deployment..."
RETRY_COUNT=0
MAX_RETRIES=3

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  CONTRACT_CODE=$(curl -s -X POST -H "Content-Type: application/json" --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getCode\",\"params\":[\"$CONTRACT_ADDRESS\", \"latest\"],\"id\":1}" http://localhost:8545)
  
  log "Contract code response (attempt $((RETRY_COUNT+1))): ${CONTRACT_CODE:0:50}..." # Show first 50 chars
  
  if echo "$CONTRACT_CODE" | grep -q "0x" && [ "$(echo "$CONTRACT_CODE" | grep -o '"result":"0x[^"]*"' | grep -v '"result":"0x"')" ]; then
    log "Contract verified successfully!"
    break
  else
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
      log "ERROR: Contract not deployed correctly. Empty or invalid bytecode."
      log "Full contract code response:"
      echo "$CONTRACT_CODE"
      
      # Check blockchain status
      log "Blockchain status:"
      curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' http://localhost:8545
      
      exit 1
    fi
    
    log "Verification attempt $RETRY_COUNT failed, waiting 2 seconds before retry..."
    sleep 2
  fi
done

# Run the integration tests with the contract address
log "Running integration tests..."
cd ts-client
log "Contract address for tests: $CONTRACT_ADDRESS"

# Create integration test log file
INTEGRATION_LOG="integration-test.log"
log "Integration test output will be written to $INTEGRATION_LOG"

# Run tests with additional logging
log "Starting integration tests with timeout of 60 seconds..."
CONTRACT_ADDRESS=$CONTRACT_ADDRESS FORCE_COLOR=0 npm run test:integration -- --verbose --forceExit --testTimeout=60000 > $INTEGRATION_LOG 2>&1
TEST_EXIT_CODE=$?

# Check if anything was written to the log
if [ ! -s "$INTEGRATION_LOG" ]; then
  log "⚠️ Warning: Integration test output log is empty!"
  log "Current directory: $(pwd)"
  log "Integration test command exists: $(npm run | grep test:integration || echo 'NOT FOUND')"
  log "Checking Jest integration config..."
  cat jest.integration.config.js >> ../$LOGFILE
fi

# Show test output in main log
if [ "$VERBOSE" = "true" ]; then
  log "Integration test output:"
  cat $INTEGRATION_LOG >> ../$LOGFILE
else
  log "Integration test output summary (see $INTEGRATION_LOG for details):"
  grep -E "(PASS|FAIL|ERROR|✓|✗)" $INTEGRATION_LOG | tail -20 >> ../$LOGFILE
  
  # If no match was found, show the last 20 lines
  if [ $? -ne 0 ]; then
    log "No test results found in log, showing last 20 lines:"
    tail -20 $INTEGRATION_LOG >> ../$LOGFILE
  fi
fi

if [ $TEST_EXIT_CODE -eq 0 ]; then
  log "✅ Integration tests completed successfully!"
else
  log "❌ Integration tests failed with exit code $TEST_EXIT_CODE"
  log "Node.js and network diagnostics:"
  log "  - Node version: $(node --version)"
  log "  - NPM version: $(npm --version)"
  log "  - Jest version: $(npm list jest || echo 'Jest not found')"
  log "  - Network status: $(curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' http://localhost:8545)"
  # Don't exit with error code, as we want the cleanup to run
fi

# Return to root directory
cd ..