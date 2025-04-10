#!/bin/bash
# Make test failures more obvious by ensuring error messages display
set -o pipefail
set -e
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
  log "WARNING: A process is already listening on port 8545."
  
  # Try to find the PID of the process listening on port 8545
  if command -v lsof &> /dev/null; then
    EXISTING_PID=$(lsof -t -i:8545 2>/dev/null)
  elif command -v fuser &> /dev/null; then
    EXISTING_PID=$(fuser 8545/tcp 2>/dev/null)
  elif command -v netstat &> /dev/null; then
    EXISTING_PID=$(netstat -tlnp 2>/dev/null | grep ":8545 " | awk '{print $7}' | cut -d'/' -f1)
  fi
  
  # If we found the PID and it's an Anvil process, try to kill it
  if [ -n "$EXISTING_PID" ]; then
    log "Found process with PID $EXISTING_PID listening on port 8545."
    if ps -p "$EXISTING_PID" -o comm= | grep -q "anvil"; then
      log "Detected an existing Anvil node. Attempting to shut it down..."
      kill "$EXISTING_PID"
      sleep 2
      
      # Check if it's still running
      if kill -0 "$EXISTING_PID" 2>/dev/null; then
        log "Failed to terminate the existing Anvil node. Forcing termination..."
        kill -9 "$EXISTING_PID" 2>/dev/null
        sleep 2
      fi
      
      # Final check if the port is free
      if ss -tln | grep ":8545 " > /dev/null; then
        log "ERROR: Failed to free port 8545. Please manually stop the process and try again."
        exit 1
      else
        log "Successfully terminated the existing Anvil node."
      fi
    else
      log "ERROR: The process using port 8545 is not Anvil. Please free up port 8545 before running this script."
      log "Process info: $(ps -p "$EXISTING_PID" -o comm= 2>/dev/null || echo "Unknown")"
      exit 1
    fi
  else
    log "ERROR: Unable to identify the process using port 8545. Please manually stop it."
    exit 1
  fi
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

# Make sure TypeScript client is rebuilt before testing
log "Building TypeScript client..."
cd ts-client
npm run build --quiet || {
  log "ERROR: Failed to build TypeScript client"
  exit 1
}
cd ..
log "TypeScript client build completed"

# Create a simple deployer script
cat > deploy-script.js << 'EOL'
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Helper to ensure we have the complete ABI
function getCompleteABI() {
  try {
    // First try to get the TypeScript client ABI
    const tsClientAbiPath = path.resolve('./ts-client/src/abi.ts');
    const tsAbiContent = fs.readFileSync(tsClientAbiPath, 'utf8');
    
    // Extract the ABI array from the TypeScript file
    const tsAbiMatch = tsAbiContent.match(/export const ABI = \[([\s\S]*?)\];/);
    if (tsAbiMatch && tsAbiMatch[1]) {
      const abiString = `[${tsAbiMatch[1]}]`;
      // Replace single quotes with double quotes for JSON parsing
      const jsonAbiString = abiString.replace(/'/g, '"');
      return JSON.parse(jsonAbiString);
    }
  } catch (err) {
    console.log('Could not load TypeScript ABI, falling back to Forge ABI');
  }
  
  // Fallback to the Forge generated ABI
  const contractJson = JSON.parse(fs.readFileSync('./out/AggregatorBatches.sol/AggregatorBatches.json', 'utf8'));
  return contractJson.abi;
}

async function main() {
  // Connect to local Anvil node
  const provider = new ethers.JsonRpcProvider('http://localhost:8545');
  
  // Use the default private key from Anvil
  const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const wallet = new ethers.Wallet(privateKey, provider);
  
  // Read the contract bytecode from the Forge output JSON
  const contractJson = JSON.parse(fs.readFileSync('./out/AggregatorBatches.sol/AggregatorBatches.json', 'utf8'));
  const bytecode = contractJson.bytecode.object;
  
  // Get the complete ABI
  const abi = getCompleteABI();
  console.log('Using ABI with the following events:');
  abi.filter(item => item.type === 'event').forEach(event => console.log(`- ${event.name || event}`));
  
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
  
  // Also save the complete ABI to a file the tests can use
  fs.writeFileSync('./contract-abi.json', JSON.stringify(abi, null, 2));
  console.log('Saved complete ABI to contract-abi.json');
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
log "Starting integration tests with timeout of 120 seconds..."
# Temporarily disable set -e to prevent script from exiting when tests fail
set +e
CONTRACT_ADDRESS=$CONTRACT_ADDRESS FORCE_COLOR=0 npm run test:integration -- --verbose --forceExit --testTimeout=120000 > $INTEGRATION_LOG 2>&1
TEST_EXIT_CODE=$?
# Re-enable set -e
set -e

# Immediately display the test result to the console
echo -e "\n--------- TEST RESULTS (exit code: $TEST_EXIT_CODE) ---------"
if grep -q "FAIL" "$INTEGRATION_LOG"; then
  echo -e "\n❌ TEST FAILURES DETECTED!\n"
  grep -A10 "FAIL" "$INTEGRATION_LOG" | head -20
  echo -e "\n"
  grep -A5 "● End-to-End Integration Tests" "$INTEGRATION_LOG" | head -10
  echo -e "\nSee $INTEGRATION_LOG for full details"
  TEST_EXIT_CODE=1
elif grep -q "Test Suites: .* failed" "$INTEGRATION_LOG"; then
  echo -e "\n❌ TEST SUITES FAILED!\n"
  grep -A5 "Test Suites:" "$INTEGRATION_LOG"
  echo -e "\nSee $INTEGRATION_LOG for full details"
  TEST_EXIT_CODE=1
else
  echo -e "\n✅ ALL TESTS PASSED\n"
  grep -A3 "Test Suites:" "$INTEGRATION_LOG" || echo "No test summary found"
fi
echo -e "---------------------------------------------------\n"

# Check if anything was written to the log
if [ ! -s "$INTEGRATION_LOG" ]; then
  log "⚠️ Warning: Integration test output log is empty!"
  log "Current directory: $(pwd)"
  log "Integration test command exists: $(npm run | grep test:integration || echo 'NOT FOUND')"
  log "Checking Jest integration config..."
  cat jest.integration.config.js >> ../$LOGFILE
fi

# Check for test failures in logs
if grep -q "FAIL " "$INTEGRATION_LOG" || grep -q "Test Suites:.*[1-9][0-9]* failed" "$INTEGRATION_LOG" || grep -q "Tests:.*[1-9][0-9]* failed" "$INTEGRATION_LOG"; then
  # Output directly to console for visibility
  echo "❌ TEST FAILURES DETECTED! Full test log is being captured."
  
  # Add to log file
  log "❌ TEST FAILURES DETECTED! Full test log:"
  
  # Output summary to console
  echo "Test failure summary:"
  grep -A10 "FAIL " "$INTEGRATION_LOG" | head -10
  
  # Always output full log on failure
  cat "$INTEGRATION_LOG" >> ../$LOGFILE
  
  # Set exit code to fail
  TEST_EXIT_CODE=1
else
  # No failures detected in the logs, show summary
  log "Integration test output summary (see $INTEGRATION_LOG for details):"
  grep -E "(PASS|✓)" $INTEGRATION_LOG | tail -5 >> ../$LOGFILE
  grep -A3 "Test Suites:" "$INTEGRATION_LOG" >> ../$LOGFILE 2>/dev/null
  
  # If no match was found, show the last 20 lines
  if [ $? -ne 0 ]; then
    log "No test results found in log, showing last 20 lines:"
    tail -20 $INTEGRATION_LOG >> ../$LOGFILE
  fi
fi

# Set final exit code based on test output
if [ $TEST_EXIT_CODE -ne 0 ] || grep -q "FAIL" "$INTEGRATION_LOG" || grep -q "Test Suites:.*[1-9][0-9]* failed" "$INTEGRATION_LOG" || grep -q "Tests:.*[1-9][0-9]* failed" "$INTEGRATION_LOG"; then
  # Direct console output for better visibility
  echo -e "\n❌ TESTS FAILED! Check the logs for details."
  
  # Log to file
  log "❌ Integration tests failed!"
  
  # Extract the number of failed tests for better reporting
  FAILED_TESTS=$(grep -o "Tests:.*[1-9][0-9]* failed" "$INTEGRATION_LOG" | grep -o "[1-9][0-9]* failed" || echo "Unknown failures")
  
  # Write to both console and log
  echo "Test failures detected: $FAILED_TESTS"
  log "Test failures detected: $FAILED_TESTS"
  
  # Extract specific test failures for reporting and display to console
  echo -e "\nFailed test details:"
  grep -B1 -A5 "● .* ›" "$INTEGRATION_LOG" | grep -v "^--$" | tee -a ../$LOGFILE
  
  echo -e "\nNode.js and network diagnostics:"
  log "Node.js and network diagnostics:"
  echo "  - Node version: $(node --version)"
  echo "  - NPM version: $(npm --version)"
  
  # Set exit code but continue, so cleanup will run
  FINAL_EXIT_CODE=1
else
  # Direct console output
  echo -e "\n✅ ALL TESTS PASSED SUCCESSFULLY!"
  
  # Log to file
  log "✅ Integration tests completed successfully!"
  FINAL_EXIT_CODE=0
fi

# Return to root directory
cd ..

# Make sure the exit code is properly set and returned
if [ "$FINAL_EXIT_CODE" -ne 0 ]; then
  # Echo directly to console with more visibility
  echo -e "\n==========================================="
  echo -e "⚠️  TESTS FAILED with exit code: $FINAL_EXIT_CODE"
  echo -e "===========================================\n"
  echo -e "Check ts-client/integration-test.log for full details"
  # Also log to file
  log "⚠️ Script completed with errors. Exiting with code: $FINAL_EXIT_CODE"
else
  # Echo directly to console with more visibility
  echo -e "\n==========================================="
  echo -e "✅  ALL TESTS PASSED SUCCESSFULLY"
  echo -e "===========================================\n"
  # Also log to file
  log "✅ Script completed successfully. Exiting with code: $FINAL_EXIT_CODE"
fi

# This will be the actual exit code returned to the caller
exit $FINAL_EXIT_CODE