# Ethereum Unicity Anchor Testing Guide

This guide provides detailed instructions for testing the Ethereum Unicity Anchor project, including smart contract unit tests and TypeScript client integration tests.

## Table of Contents

1. [Testing Overview](#testing-overview)
2. [Prerequisites](#prerequisites)
3. [Smart Contract Unit Testing](#smart-contract-unit-testing)
4. [TypeScript Client Unit Testing](#typescript-client-unit-testing)
5. [Integration Testing](#integration-testing)
6. [Test Coverage](#test-coverage)
7. [Continuous Integration](#continuous-integration)
8. [Best Practices](#best-practices)

## Testing Overview

The testing strategy for this project includes:

1. **Smart Contract Unit Tests**: Verify the Solidity contract logic in isolation
2. **TypeScript Client Unit Tests**: Test the client library with mocked contract interactions
3. **Integration Tests**: Verify the TypeScript client works with actual deployed contracts

## Prerequisites

Ensure you have the following tools installed:

- **Node.js** (v16.x or higher)
- **Foundry** (forge, anvil, cast)
- **Git**

Clone the repository and install dependencies:

```bash
git clone https://github.com/unicitynetwork/eth-unicity-anchor.git
cd eth-unicity-anchor
npm install

cd ts-client
npm install
cd ..
```

## Smart Contract Unit Testing

The smart contract tests are written using Foundry's testing framework.

### Running Smart Contract Tests

```bash
# Run all smart contract tests
forge test

# Run with verbosity for more details
forge test -vvv

# Run a specific test
forge test --match-test testFunctionName

# Run with gas report
forge test --gas-report
```

### Test Structure

Smart contract tests are located in the `test/` directory. Each test file follows the naming convention `*.t.sol`.

Key testing files:
- `test/AggregatorBatches.t.sol`: Tests for the main contract

### Writing Smart Contract Tests

Example of a test:

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../src/AggregatorBatches.sol";

contract AggregatorBatchesTest is Test {
    AggregatorBatches aggregator;
    address owner = address(this);
    address[] trustedAggregators;
    
    function setUp() public {
        // Setup code - runs before each test
        trustedAggregators = new address[](1);
        trustedAggregators[0] = owner;
        aggregator = new AggregatorBatches(trustedAggregators, 1);
    }
    
    function testSubmitCommitment() public {
        // Test submitting a commitment
        aggregator.submitCommitment(1, bytes("payload"), bytes("authenticator"));
        
        // Verify the commitment was stored correctly
        IAggregatorBatches.CommitmentRequest memory request = aggregator.getCommitment(1);
        assertEq(request.requestID, 1);
        assertEq(request.payload, bytes("payload"));
        assertEq(request.authenticator, bytes("authenticator"));
    }
}
```

## TypeScript Client Unit Testing

The TypeScript client tests are written using Jest.

### Running TypeScript Unit Tests

```bash
cd ts-client

# Run all tests
npm test

# Run with coverage report
npm test -- --coverage

# Run specific test file
npm test -- tests/client.test.ts
```

### Test Structure

TypeScript tests are located in the `ts-client/tests/` directory:

- `tests/utils.test.ts`: Tests for utility functions
- `tests/client.test.ts`: Tests for the base client
- `tests/aggregator-gateway.test.ts`: Tests for the gateway client
- `tests/aggregator-node.test.ts`: Tests for the node client

### Writing TypeScript Unit Tests

Example of a test:

```typescript
import { UniCityAnchorClient } from '../src/client';
import { ethers } from 'ethers';

// Mock the ethers.Contract class
jest.mock('ethers', () => {
  const originalModule = jest.requireActual('ethers');
  return {
    ...originalModule,
    Contract: jest.fn().mockImplementation(() => ({
      getCommitment: jest.fn().mockResolvedValue({
        requestID: 1n,
        payload: new Uint8Array([1, 2, 3]),
        authenticator: new Uint8Array([4, 5, 6])
      })
    }))
  };
});

describe('UniCityAnchorClient', () => {
  let client: UniCityAnchorClient;
  
  beforeEach(() => {
    client = new UniCityAnchorClient({
      contractAddress: '0x1234567890123456789012345678901234567890',
      provider: 'http://localhost:8545'
    });
  });
  
  test('getCommitment should return a commitment request', async () => {
    const commitment = await client.getCommitment(1n);
    expect(commitment.requestID).toBe('1');
    expect(commitment.payload).toBe('0x010203');
    expect(commitment.authenticator).toBe('0x040506');
  });
});
```

## Integration Testing

Integration tests verify that the TypeScript client works correctly with actual smart contracts deployed on a local blockchain.

### Prerequisites for Integration Testing

- Anvil (part of Foundry) for the local Ethereum node
- All project dependencies installed

### Automated Integration Testing

Run the complete integration test suite:

```bash
./scripts/manual-e2e-test.sh
```

This script will:
1. Start a local Anvil blockchain
2. Deploy the contracts
3. Run integration tests
4. Clean up resources

### Manual Integration Testing

For more control over the testing process:

```bash
# Start a local node and deploy the contracts
./scripts/start-node-and-deploy.sh

# The script will output the contract address. In a new terminal:
cd ts-client
CONTRACT_ADDRESS=<address_from_previous_step> npm run test:integration
```

### Integration Test Structure

Integration tests are in `ts-client/tests/integration/`:

- `tests/integration/e2e.test.ts`: End-to-end tests with real contract interactions

### Key Integration Test Scenarios

The integration tests verify:

1. **Adding an aggregator**: Adding a new trusted aggregator
2. **Submitting commitments**: Creating and submitting commitment requests
3. **Creating batches**: Grouping commitments into batches
4. **Processing batches**: Submitting and verifying hashrooots for batches

### Example Integration Test Code

```typescript
it('should submit a commitment and create a batch', async () => {
  // Add an aggregator
  const result = await baseClient.addAggregator(aggregatorWallet.address);
  expect(result.success).toBe(true);
  
  // Submit a commitment
  const requestId = Date.now();
  const payload = ethers.toUtf8Bytes('test payload');
  const authenticator = ethers.toUtf8Bytes('test authenticator');
  
  await gatewayClient.submitCommitment(requestId, payload, authenticator);
  
  // Create a batch
  const { batchNumber } = await gatewayClient.createBatch();
  
  // Get batch info
  const batchInfo = await nodeClient.getBatch(batchNumber);
  expect(batchInfo.requests.length).toBeGreaterThan(0);
  
  // Submit a hashroot
  const hashroot = ethers.toUtf8Bytes('test hashroot');
  await nodeClient.submitHashroot(batchNumber, hashroot);
  
  // Verify the batch is processed
  const updatedBatch = await nodeClient.getBatch(batchNumber);
  expect(updatedBatch.processed).toBe(true);
});
```

## Test Coverage

### Smart Contract Coverage

Generate a coverage report for smart contracts:

```bash
forge coverage --report lcov
```

### TypeScript Coverage

Generate a coverage report for TypeScript code:

```bash
cd ts-client
npm test -- --coverage
```

### Interpreting Coverage Reports

- **Line Coverage**: Percentage of code lines executed
- **Branch Coverage**: Percentage of code branches executed
- **Function Coverage**: Percentage of functions called

Aim for high coverage (>80%) in critical components.

## Continuous Integration

This project uses GitHub Actions for CI/CD. The workflow includes:

1. Building the project
2. Running smart contract tests
3. Running TypeScript unit tests
4. Running integration tests against a local blockchain

## Best Practices

### Smart Contract Testing

- Test all contract functions, including edge cases and failure modes
- Verify access control logic thoroughly
- Test external function interactions with forge's mocking capabilities
- Use fuzzing to test with random inputs

### TypeScript Testing

- Mock external dependencies
- Test edge cases and error handling
- Separate unit tests from integration tests
- Use test coverage to identify untested code

### Integration Testing

- Test full workflows, not just individual functions
- Ensure proper cleanup of test resources
- Use deterministic inputs for repeatability
- Log transaction details for debugging