#!/bin/bash

# Start Hardhat node in a tmux session
echo "Starting Hardhat node in tmux session 'ethereum-node'..."
tmux new-session -d -s ethereum-node
tmux send-keys -t ethereum-node "cd /home/vrogojin/Projects/eth_unicity_anchor && npm run node" C-m
echo "Node running in tmux session. Connect with: tmux attach -t ethereum-node"

# Give the node some time to start
echo "Waiting for node to start..."
sleep 5

# Deploy the contract
echo "Deploying contract..."
npm run deploy:local

# Get the deployed contract address
CONTRACT_ADDRESS=$(grep -o "AggregatorBatches deployed to: 0x[a-fA-F0-9]\+" hardhat.log | cut -d' ' -f4)

if [ -z "$CONTRACT_ADDRESS" ]; then
  echo "Failed to extract contract address from deployment logs."
  exit 1
fi

echo "Contract deployed at: $CONTRACT_ADDRESS"
echo "You can now use the TypeScript client with this contract address."
echo "To use in your code, set the CONTRACT_ADDRESS environment variable:"
echo "export CONTRACT_ADDRESS=\"$CONTRACT_ADDRESS\""

# Export for current session
export CONTRACT_ADDRESS="$CONTRACT_ADDRESS"