#!/bin/bash

# Start Anvil node in a tmux session
echo "Starting Anvil node in tmux session 'ethereum-node'..."
tmux new-session -d -s ethereum-node
tmux send-keys -t ethereum-node "cd /home/vrogojin/Projects/eth_unicity_anchor && anvil" C-m
echo "Node running in tmux session. Connect with: tmux attach -t ethereum-node"

# Give the node some time to start
echo "Waiting for node to start..."
sleep 5

# Create a deployer script
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

# Deploy the contract
echo "Deploying contract..."
node deploy-script.js

# Get the deployed contract address
if [ ! -f "./contract-address.txt" ]; then
  echo "Failed to deploy contract."
  exit 1
fi

CONTRACT_ADDRESS=$(cat ./contract-address.txt)

echo "Contract deployed at: $CONTRACT_ADDRESS"
echo "You can now use the TypeScript client with this contract address."
echo "To use in your code, set the CONTRACT_ADDRESS environment variable:"
echo "export CONTRACT_ADDRESS=\"$CONTRACT_ADDRESS\""

# Export for current session
export CONTRACT_ADDRESS="$CONTRACT_ADDRESS"