#!/bin/bash
# Make test failures more obvious by ensuring error messages display
set -o pipefail
set -e

# -----------------------------------------------------------------------
# Ethereum Unicity Anchor Gateway End-to-End Test Script
#
# This script:
# 1. Starts a local Anvil Ethereum node
# 2. Compiles and deploys the AggregatorBatches contract
# 3. Runs the gateway test script to test commitments and verify proofs
# 4. Uses the gateway implementation from the codebase
# 5. Cleans up resources when done or if interrupted
# -----------------------------------------------------------------------

# Initialize the log file for test output
LOGFILE="gateway-e2e-test-output.log"
echo "============================================" > $LOGFILE
echo "Gateway End-to-End Test Run - $(date)" >> $LOGFILE
echo "============================================" >> $LOGFILE

# Function to log to both console and log file
log() {
  echo "$@" | tee -a $LOGFILE
}

# Process command line arguments
COMMITS_TO_TEST=${1:-5}  # Default to 5 commits if not specified
GATEWAY_PORT=${2:-0}     # Default to 0 (random port) if not specified

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
log "  Test Configuration:"
log "    Commits to test: $COMMITS_TO_TEST"
log "    Gateway port: $GATEWAY_PORT"
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

# Create file for storing PIDs for cleanup
PIDS_FILE=$(mktemp)

# Ensure we kill all processes when the script exits
cleanup() {
  log "Cleaning up processes..."
  
  # Kill all the processes we started
  if [ -f "$PIDS_FILE" ]; then
    while read pid; do
      if ps -p $pid > /dev/null; then
        log "Terminating process with PID: $pid"
        kill $pid 2>/dev/null || true
        sleep 1
        # Force kill if still running
        if ps -p $pid > /dev/null; then
          log "Force killing process with PID: $pid"
          kill -9 $pid 2>/dev/null || true
        fi
      fi
    done < "$PIDS_FILE"
    rm "$PIDS_FILE"
  fi
  
  log "Cleanup complete."
}
trap cleanup EXIT INT TERM

# Start Anvil in the background
log "Starting Anvil node..."
anvil > anvil.log 2>&1 &
ANVIL_PID=$!
echo $ANVIL_PID > $PIDS_FILE

# Verify Anvil started successfully
if ! ps -p $ANVIL_PID > /dev/null; then
  log "ERROR: Failed to start Anvil node. Check anvil.log for details."
  if [ -f anvil.log ]; then
    log "Anvil log content:"
    log "$(cat anvil.log)"
  fi
  exit 1
fi

# Function to test RPC connection
test_rpc_connection() {
  curl -s -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    http://localhost:8545 | grep -q "result"
}

# Wait for Anvil to start
log "Waiting for Anvil node to initialize..."
RETRY_COUNT=0
MAX_RETRIES=5

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if test_rpc_connection; then
    log "Connected to Anvil node successfully!"
    break
  else
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
      log "ERROR: Could not connect to Anvil node after $MAX_RETRIES attempts"
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

# Compile the contract
log "Compiling contract with Forge..."
if ! forge build --quiet; then
  log "ERROR: Contract compilation failed"
  exit 1
fi

# Create a deploy script for the contract
log "Creating deployment script..."
cat > ts-client/src/deploy-contract.ts << 'EOL'
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

async function main(): Promise<string> {
  // Connect to local Anvil node
  const provider = new ethers.JsonRpcProvider('http://localhost:8545');
  
  // Use the default Anvil private key
  const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const wallet = new ethers.Wallet(privateKey, provider);
  
  // Read contract JSON artifacts from Forge output
  const forgeOutputPath = path.resolve('../out/AggregatorBatches.sol/AggregatorBatches.json');
  const contractJson = JSON.parse(fs.readFileSync(forgeOutputPath, 'utf8'));
  const bytecode = contractJson.bytecode.object;
  const abi = contractJson.abi;
  
  // Deploy contract
  console.log('Deploying AggregatorBatches contract...');
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  
  // Deploy with constructor args: initial trusted aggregator is deployer, required votes is 1
  const contract = await factory.deploy([wallet.address], 1);
  await contract.waitForDeployment();
  
  // Get contract address
  const contractAddress = await contract.getAddress();
  console.log('Contract deployed to:', contractAddress);
  
  // Save contract address and ABI for later use
  fs.writeFileSync(path.resolve('../contract-address.txt'), contractAddress);
  fs.writeFileSync(path.resolve('../contract-abi.json'), JSON.stringify(abi, null, 2));
  
  return contractAddress;
}

// Run the main function
main()
  .then(contractAddress => {
    process.stdout.write(contractAddress);
    process.exit(0);
  })
  .catch(error => {
    console.error('Deployment error:', error);
    process.exit(1);
  });
EOL

# Build TypeScript client
log "Building TypeScript client..."
cd ts-client
npm run build
cd ..

# Deploy the contract
log "Deploying contract..."
cd ts-client
CONTRACT_ADDRESS=$(npx ts-node src/deploy-contract.ts)
cd ..
log "Contract deployed at: $CONTRACT_ADDRESS"

# Verify contract deployment
if [ -z "$CONTRACT_ADDRESS" ] || [ "$CONTRACT_ADDRESS" = "undefined" ]; then
  log "ERROR: Contract deployment failed or returned invalid address"
  exit 1
fi

# Run the gateway test with SMT processing, using the pattern from integration tests
log "Running gateway test with $COMMITS_TO_TEST commits on port $GATEWAY_PORT..."
cd ts-client
CONTRACT_ADDRESS=$CONTRACT_ADDRESS npx ts-node src/run-gateway-test.ts $GATEWAY_PORT $COMMITS_TO_TEST
GATEWAY_TEST_EXIT_CODE=$?
cd ..

# Report results
if [ -f gateway-port.txt ]; then
  ACTUAL_PORT=$(cat gateway-port.txt)
  log "Gateway was running on port: $ACTUAL_PORT"
  rm gateway-port.txt
fi

# Final summary
log "\n=== TEST SUMMARY ==="
log "Contract Address: $CONTRACT_ADDRESS"
log "Commits Tested: $COMMITS_TO_TEST"
log "Test Result: $([ $GATEWAY_TEST_EXIT_CODE -eq 0 ] && echo "PASS ✅" || echo "FAIL ❌")"

# Exit with the gateway test exit code
exit $GATEWAY_TEST_EXIT_CODE