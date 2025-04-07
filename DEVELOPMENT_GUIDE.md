# Ethereum Unicity Anchor Development Guide

This guide provides comprehensive instructions for setting up a development environment, running tests, and contributing to the Ethereum Unicity Anchor project.

## Table of Contents

1. [Project Overview](#project-overview)
2. [System Requirements](#system-requirements)
3. [Development Environment Setup](#development-environment-setup)
4. [Smart Contract Development](#smart-contract-development)
5. [TypeScript Client Development](#typescript-client-development)
6. [Testing](#testing)
7. [Deployment](#deployment)
8. [Troubleshooting](#troubleshooting)

## Project Overview

The Ethereum Unicity Anchor is a system for managing commitments on the Ethereum blockchain with a batch processing mechanism and aggregator voting.

Key components:
- **Smart Contracts**: Solidity contracts for on-chain logic
- **TypeScript Client**: Library for interacting with the contracts

## System Requirements

- **Node.js**: v16.x or higher
- **Foundry**: Latest version (for smart contract development)
- **Git**: For version control

## Development Environment Setup

### 1. Clone the Repository

```bash
git clone https://github.com/unicitynetwork/eth-unicity-anchor.git
cd eth-unicity-anchor
```

### 2. Install Foundry

If you don't have Foundry installed:

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### 3. Install Project Dependencies

```bash
# Install root project dependencies
npm install

# Install TypeScript client dependencies
cd ts-client
npm install
cd ..
```

### 4. Setup Environment

```bash
# Build the smart contracts
forge build

# Build the TypeScript client
cd ts-client
npm run build
cd ..
```

## Smart Contract Development

The smart contracts are located in the `src/` directory. The main contract is `AggregatorBatches.sol`.

### Key Files

- `src/IAggregatorBatches.sol`: Interface for the aggregator batches system
- `src/AggregatorBatches.sol`: Implementation of the interface

### Development Workflow

1. **Edit Smart Contracts**: Modify the contracts in the `src/` directory
2. **Compile**: Run `forge build` to compile the contracts
3. **Test**: Run `forge test` to run the test suite
4. **Analyze**: Run `forge coverage` to generate a coverage report

### Build Commands

```bash
# Compile contracts
forge build

# Watch for changes and recompile
forge build --watch
```

## TypeScript Client Development

The TypeScript client is located in the `ts-client/` directory.

### Key Files

- `src/client.ts`: Base client for contract interactions
- `src/aggregator-gateway.ts`: Client for commitment submission
- `src/aggregator-node.ts`: Client for batch processing
- `src/utils.ts`: Utility functions
- `src/types.ts`: TypeScript type definitions

### Development Workflow

1. **Edit TypeScript Files**: Modify the client code in `ts-client/src/`
2. **Build**: Run `npm run build` from the `ts-client/` directory
3. **Test**: Run `npm test` to run the unit tests

### Build Commands

```bash
cd ts-client

# Build the client
npm run build

# Lint the code
npm run lint

# Format the code
npm run format
```

## Testing

This project includes both unit tests and integration tests.

### Smart Contract Unit Tests

Smart contract tests are located in the `test/` directory and use Foundry's testing framework.

```bash
# Run all smart contract tests
forge test

# Run tests with verbosity
forge test -vvv

# Run specific test
forge test --match-test testFunctionName

# Generate coverage report
forge coverage
```

### TypeScript Client Unit Tests

TypeScript unit tests are located in the `ts-client/tests/` directory and use Jest.

```bash
cd ts-client

# Run all TypeScript tests
npm test

# Run only unit tests
npm run test:unit
```

### Integration Tests

Integration tests verify that the TypeScript client works correctly with the smart contracts deployed on a local blockchain.

#### Prerequisites for Integration Tests

- Anvil (part of Foundry) for the local Ethereum node
- All project dependencies installed

#### Running Integration Tests

```bash
# Run the automated integration test script
./scripts/manual-e2e-test.sh
```

This script will:
1. Start a local Anvil blockchain
2. Compile and deploy the smart contracts
3. Run integration tests against the deployed contracts
4. Clean up resources when done

#### Manual Integration Testing

For manual testing:

```bash
# Start a local node and deploy the contracts
./scripts/start-node-and-deploy.sh

# In a new terminal, run specific integration tests
cd ts-client
CONTRACT_ADDRESS=<address_from_previous_step> npm run test:integration
```

## Deployment

### Preparing for Deployment

1. Ensure all tests pass
2. Update version numbers if needed
3. Clean the build artifacts: `forge clean`

### Deploying Smart Contracts

```bash
# Deploy to a testnet (e.g., Sepolia)
forge script script/Deploy.s.sol --rpc-url <RPC_URL> --private-key <KEY> --broadcast

# Verify the contract on Etherscan
forge verify-contract <DEPLOYED_ADDRESS> src/AggregatorBatches.sol:AggregatorBatches \
  --chain <CHAIN_ID> \
  --constructor-args $(cast abi-encode "constructor(address[],uint256)" "[$TRUSTED_AGGREGATOR]" 1)
```

### Publishing the TypeScript Client

```bash
cd ts-client
npm publish
```

## Troubleshooting

### Common Issues

#### Compilation Errors

- **Issue**: Solidity version mismatch
- **Solution**: Check the version in `foundry.toml` and ensure you have the correct Solidity compiler installed

#### Test Failures

- **Issue**: Integration tests fail with "No signer available"
- **Solution**: Ensure the provider and signer are correctly configured in the test

#### Anvil Connection Issues

- **Issue**: Cannot connect to local Anvil node
- **Solution**: Check if Anvil is running with `lsof -i :8545` or start a new instance with `anvil`

### Getting Help

- Open an issue in the GitHub repository
- Check the documentation in the `docs/` directory
- Refer to the Foundry documentation for smart contract development questions