#!/bin/bash
# Simple Integration Test Script for Ethereum Unicity Anchor
# Enable error handling, but not during cleanup
set +e  # Initially off to handle cleanup errors gracefully

echo "=== SIMPLE INTEGRATION TEST ==="
echo "This script will:"
echo "1. Cleanup any existing processes"
echo "2. Start Anvil blockchain node"
echo "3. Deploy the AggregatorBatches contract"
echo "4. Start gateway server with SMT implementation"
echo "5. Run test-gateway-cli.ts to test a single commitment"
echo "6. Trigger batch creation and processing"
echo "============================="

# Check for existing gateway and test processes and kill them
echo "Checking for existing gateway processes..."
EXISTING_GATEWAY_PIDS=$(pgrep -f "run-gateway-server.ts|start-gateway.js")
if [ -n "$EXISTING_GATEWAY_PIDS" ]; then
  echo "Found existing gateway processes. Terminating them..."
  for PID in $EXISTING_GATEWAY_PIDS; do
    echo "Killing process $PID..."
    kill $PID 2>/dev/null || true
    sleep 1
    # Force kill if still running
    if kill -0 $PID 2>/dev/null; then
      echo "Force killing process $PID..."
      kill -9 $PID 2>/dev/null || true
    fi
  done
  echo "All existing gateway processes terminated."
else
  echo "No existing gateway processes found."
fi

# Check if port 3000 is in use
if ss -ltn | grep ":3000 " > /dev/null; then
  echo "Port 3000 is already in use. Attempting to free it..."
  # Try to identify and kill the process using port 3000
  if command -v lsof &> /dev/null; then
    PORT_PID=$(lsof -ti:3000 2>/dev/null)
    if [ -n "$PORT_PID" ]; then
      echo "Killing process $PORT_PID using port 3000..."
      kill $PORT_PID 2>/dev/null || true
      sleep 1
      if kill -0 $PORT_PID 2>/dev/null; then
        echo "Force killing process $PORT_PID..."
        kill -9 $PORT_PID 2>/dev/null || true
      fi
    fi
  else
    echo "lsof not available. Using alternative method..."
    FUSER_PID=$(fuser 3000/tcp 2>/dev/null)
    if [ -n "$FUSER_PID" ]; then
      echo "Killing process $FUSER_PID using port 3000..."
      kill $FUSER_PID 2>/dev/null || true
      sleep 1
      if kill -0 $FUSER_PID 2>/dev/null; then
        echo "Force killing process $FUSER_PID..."
        kill -9 $FUSER_PID 2>/dev/null || true
      fi
    fi
  fi
  
  # Verify port is now free
  if ss -ltn | grep ":3000 " > /dev/null; then
    echo "WARNING: Port 3000 is still in use. The gateway server may fail to start."
  else
    echo "Port 3000 is now free."
  fi
else
  echo "Port 3000 is available."
fi

# Check for existing Anvil node
EXISTING_ANVIL_PIDS=$(pgrep anvil)
if [ -n "$EXISTING_ANVIL_PIDS" ]; then
  echo "Found existing Anvil processes. Terminating them..."
  for PID in $EXISTING_ANVIL_PIDS; do
    echo "Killing Anvil process $PID..."
    kill $PID 2>/dev/null || true
    sleep 1
    # Force kill if still running
    if kill -0 $PID 2>/dev/null; then
      echo "Force killing Anvil process $PID..."
      kill -9 $PID 2>/dev/null || true
    fi
  done
  echo "All existing Anvil processes terminated."
else
  echo "No existing Anvil processes found."
fi

# Now that cleanup is done, enable strict error handling
set -e
echo "Initial cleanup completed, proceeding with test setup..."

# Function to cleanup resources when script exits
cleanup() {
  echo "Cleaning up resources..."
  
  # Kill gateway server if running
  if [ -n "$GATEWAY_PID" ]; then
    echo "Stopping gateway server (PID: $GATEWAY_PID)..."
    kill $GATEWAY_PID 2>/dev/null || true
    sleep 1
    if kill -0 $GATEWAY_PID 2>/dev/null; then
      echo "Force killing gateway server..."
      kill -9 $GATEWAY_PID 2>/dev/null || true
    fi
  fi
  
  # Kill Anvil if running
  if [ -n "$ANVIL_PID" ]; then
    echo "Stopping Anvil node (PID: $ANVIL_PID)..."
    kill $ANVIL_PID 2>/dev/null || true
    sleep 1
    if kill -0 $ANVIL_PID 2>/dev/null; then
      echo "Force killing Anvil node..."
      kill -9 $ANVIL_PID 2>/dev/null || true
    fi
  fi
  
  echo "Cleanup complete"
}

# Register cleanup function to run on exit
trap cleanup EXIT

# Step 1: Start Anvil
echo "Starting Anvil node..."
anvil > anvil.log 2>&1 &
ANVIL_PID=$!

# Wait for Anvil to start
sleep 2
echo "Testing Anvil connection..."
if ! curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' http://localhost:8545 | grep -q "result"; then
  echo "ERROR: Failed to connect to Anvil node"
  cat anvil.log
  exit 1
fi
echo "Anvil node started successfully"

# Step 2: Build and deploy the contract
echo "Building contract..."
forge build --quiet || {
  echo "ERROR: Contract compilation failed"
  exit 1
}

echo "Deploying contract..."
node deploy-contract.js 2>&1 | tee deploy.log
if [ ! -f "./contract-address.txt" ]; then
  echo "ERROR: Failed to extract contract address from deployment"
  cat deploy.log
  exit 1
fi

# Get contract address
CONTRACT_ADDRESS=$(cat ./contract-address.txt)
echo "Contract deployed at: $CONTRACT_ADDRESS"

# Step 3: Start the gateway server
echo "Starting gateway server..."
export CONTRACT_ADDRESS=$CONTRACT_ADDRESS
export GATEWAY_PORT=3000
export FAST_TEST=true

echo "Using contract address: $CONTRACT_ADDRESS"
echo "Using gateway port: $GATEWAY_PORT"

cd ts-client
echo "Changed directory to ts-client"

# Start gateway server in background with reduced batch thresholds for faster testing
echo "Launching gateway server with npx ts-node..."
CONTRACT_ADDRESS=$CONTRACT_ADDRESS GATEWAY_PORT=$GATEWAY_PORT FAST_TEST=true npx ts-node src/run-gateway-server.ts > gateway.log 2>&1 &
GATEWAY_PID=$!
echo "Gateway server launched with PID: $GATEWAY_PID"

cd ..
echo "Changed back to root directory"

# Wait for gateway to start
sleep 3
echo "Checking if gateway server is running..."
if ! kill -0 $GATEWAY_PID 2>/dev/null; then
  echo "ERROR: Gateway server failed to start"
  cat ts-client/gateway.log
  exit 1
fi
echo "Gateway server started successfully on port $GATEWAY_PORT"

# Step 4: Set environment variable for the gateway to detect
echo "Setting FAST_TEST=true environment variable for the gateway..."
# The gateway is already started with FAST_TEST=true, so no need to make HTTP config request

# Step 5: Submit a commitment and trigger batch processing in parallel
echo "Running test-gateway-cli.ts in background while processing batches..."

# Start the test gateway CLI in the background
echo "Starting gateway-cli test in background..."
npm run test:gateway -- http://localhost:$GATEWAY_PORT 1 > gateway-cli-output.log 2>&1 &
TEST_CLI_PID=$!

# Immediately trigger batch creation and processing while test is running
echo "Waiting 2 seconds for commitment submission..."
sleep 2

# Step 5a: Trigger batch creation
echo "Triggering batch creation..."
BATCH_RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"create_batch","params":{},"id":1}' http://localhost:$GATEWAY_PORT)
echo "$BATCH_RESPONSE" | jq .

# Extract batch number from response
BATCH_NUMBER=$(echo "$BATCH_RESPONSE" | jq -r '.result.batchNumber // "1"')
echo "Created batch number: $BATCH_NUMBER"

echo "Waiting for batch to be created (2 seconds)..."
sleep 2

# Step 5b: Trigger batch processing
echo "Triggering batch processing..."
PROCESS_RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"process_batches","params":{},"id":1}' http://localhost:$GATEWAY_PORT)
echo "$PROCESS_RESPONSE" | jq .

# Wait for the CLI test to complete
echo "Waiting for gateway CLI test to complete..."
wait $TEST_CLI_PID
TEST_EXIT_CODE=$?
echo "Test gateway CLI exit code: $TEST_EXIT_CODE"

# Display the CLI test output
echo "=== Gateway CLI Test Output ==="
cat gateway-cli-output.log
echo "=== End of Gateway CLI Test Output ==="

# Check if the test found the inclusion proof
if grep -q "Proof found for request ID" gateway-cli-output.log; then
  echo "✅ Inclusion proof was found by the test!"
  PROOF_FOUND=0
else
  echo "❌ Inclusion proof was NOT found by the test"
  PROOF_FOUND=1
fi

# Extract processing results
PROCESSED_COUNT=$(echo "$PROCESS_RESPONSE" | jq -r '.result.processed // 0')
echo "Processed $PROCESSED_COUNT batches"

echo "Waiting for batch to be processed (3 seconds)..."
sleep 3

# Step 6: Checking gateway logs
echo "Retrieving last 100 lines from gateway server log for debugging..."
tail -n 100 ts-client/gateway.log > gateway-debug.log
echo "Latest gateway logs saved to gateway-debug.log"

echo "Checking smart contract directly for batch status..."
# Save the query script to a temporary file to avoid shell issues
cat > contract-query.js << 'EOL'
const { ethers } = require('ethers');
const fs = require('fs');

async function checkBatch() {
  const provider = new ethers.JsonRpcProvider('http://localhost:8545');
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const abi = JSON.parse(fs.readFileSync('./contract-abi.json', 'utf8'));
  const contract = new ethers.Contract(contractAddress, abi, provider);
  
  try {
    // Get the latest batch number to check
    const latestBatchNumber = await contract.getLatestBatchNumber();
    console.log('Latest batch number: ' + latestBatchNumber);
    
    // Check if any batch exists
    if (latestBatchNumber < 1) {
      console.log('No batches created yet on the contract!');
      process.exit(1);
    }
    
    // Get all batch numbers to check
    let anyBatchProcessed = false;
    
    for (let i = 1; i <= latestBatchNumber; i++) {
      try {
        // Query each batch
        const batch = await contract.getBatch(i);
        console.log(`Batch ${i} info:`);
        console.log(`- Processed: ${batch.processed}`);
        console.log(`- Hashroot: ${batch.hashroot || 'none'}`);
        console.log(`- Requests count: ${batch.requests.length}`);
        
        if (batch.processed) {
          anyBatchProcessed = true;
        }
      } catch (err) {
        console.log(`Error checking batch ${i}: ${err.message}`);
      }
    }
    
    // Return 0 for success (if any batch processed) or 1 for failure (if no batches processed)
    process.exit(anyBatchProcessed ? 0 : 1);
  } catch (error) {
    console.error('Error querying contract:', error.message);
    process.exit(1);
  }
}

checkBatch();
EOL

# Run the query
CONTRACT_ADDRESS=$CONTRACT_ADDRESS node contract-query.js
CONTRACT_STATUS=$?

# Determine overall test status
if grep -q "Successfully processed batch $BATCH_NUMBER" gateway-debug.log; then
  echo "✅ Batch $BATCH_NUMBER was successfully processed according to logs"
  BATCH_PROCESSED=0
else
  echo "⚠️ No confirmation found in logs that batch $BATCH_NUMBER was processed"
  BATCH_PROCESSED=1
fi

# Final test result - fail if either contract query failed or logs don't show success
if [ $CONTRACT_STATUS -eq 0 ] && [ $BATCH_PROCESSED -eq 0 ]; then
  echo "✅ Integration test PASSED"
  exit 0
else
  echo "❌ Integration test FAILED - Batch processing issues detected"
  echo "Please check gateway-debug.log for more details"
  exit 1
fi