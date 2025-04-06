# Testing the Ethereum Unicity Anchor System

This document describes how to test the Ethereum Unicity Anchor system, including both the Solidity smart contracts and the TypeScript client library.

## Prerequisites

- Node.js and npm
- Foundry (forge, anvil, cast)
- tmux (for running the Ethereum node in the background)

## Setting Up the Local Testing Environment

### 1. Install Dependencies

From the project root:

```bash
# Install root project dependencies
npm install

# Install TypeScript client dependencies
cd ts-client
npm install
cd ..
```

### 2. Compile the Smart Contracts

From the project root:

```bash
# Using Forge
npm run compile
# or directly
forge build
```

## Testing Options

### Option 1: Run Automated Integration Tests

The integration tests will:
1. Start a local Hardhat node
2. Deploy the contract
3. Run the TypeScript client tests against the deployed contract
4. Shut down the node when done

From the project root:

```bash
./scripts/run-integration-tests.sh
```

### Option 2: Start Node and Deploy for Manual Testing

This script will:
1. Start a local Hardhat node in a tmux session
2. Deploy the contract
3. Display the contract address
4. Export the contract address as an environment variable

From the project root:

```bash
./scripts/start-node-and-deploy.sh
```

You can then connect to the node using:

```bash
tmux attach -t ethereum-node
```

Use the exported `CONTRACT_ADDRESS` in your client code or tests.

### Option 3: Run Unit Tests

#### Smart Contract Tests

From the project root:

```bash
# Run all tests
npm test
# or directly
forge test

# Run a specific test
forge test --match-test testFunctionName

# Run tests with verbosity for debugging
forge test -vvv
```

#### TypeScript Client Unit Tests

From the ts-client directory:

```bash
# Run all TypeScript tests
npm test

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration
```

## Interacting with the Deployed Contract

Once you have the contract deployed on the local node, you can interact with it using the TypeScript client:

```typescript
import { EthUnicityClient } from './ts-client/src/client';
import { AggregatorGatewayClient } from './ts-client/src/aggregator-gateway';
import { ethers } from 'ethers';

// Setup client
const provider = new ethers.JsonRpcProvider('http://localhost:8545');
const signer = new ethers.Wallet(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // First Hardhat account
  provider
);

const gatewayClient = new AggregatorGatewayClient({
  contractAddress: process.env.CONTRACT_ADDRESS,
  provider: 'http://localhost:8545',
  signer
});

// Submit a commitment
const requestId = Date.now();
const payload = ethers.toUtf8Bytes('test payload');
const authenticator = ethers.toUtf8Bytes('test authenticator');

gatewayClient.submitCommitment(requestId, payload, authenticator)
  .then(tx => console.log('Transaction sent:', tx))
  .catch(err => console.error('Error:', err));
```

## Stopping the Local Node

If you used the manual start script, you can stop the node by:

1. Attaching to the tmux session: `tmux attach -t ethereum-node`
2. Pressing Ctrl+C to stop the node
3. Type `exit` to close the session

Alternatively, you can kill the session directly:
```bash
tmux kill-session -t ethereum-node
```