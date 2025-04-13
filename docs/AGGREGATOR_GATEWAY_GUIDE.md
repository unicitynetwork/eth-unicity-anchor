# Ethereum Unicity Anchor Aggregator Gateway Documentation

## Overview

The Ethereum Unicity Anchor provides a secure mechanism for anchoring data commitments on the blockchain. The Aggregator Gateway is a key component that manages commitment submission, batch creation, and processing. This document explains how to configure, instantiate, and operate an Aggregator Gateway, covering both basic and advanced usage patterns.

## Components

The system consists of three main components:

1. **UniCityAnchorClient**: Base client for interacting with the smart contract
2. **AggregatorGatewayClient**: Handles commitment submissions and batch creation
3. **AggregatorNodeClient**: Processes batches and submits hashroots to the blockchain

## Installation

```bash
npm install eth-unicity-anchor-client
```

## Basic Usage

### 1. Initializing the Gateway Client

```typescript
import { AggregatorGatewayClient } from 'eth-unicity-anchor-client';
import { ethers } from 'ethers';

// Connect to an Ethereum provider
const provider = new ethers.JsonRpcProvider('https://ethereum-rpc-url');
const wallet = new ethers.Wallet('your-private-key', provider);

// Initialize the gateway client
const gatewayClient = new AggregatorGatewayClient({
  contractAddress: '0xYourContractAddress',
  provider: provider,
  signer: wallet,
  gatewayAddress: wallet.address,
  // Optional: Enable automatic batch creation
  autoProcessing: 300 // Process batches every 300 seconds (5 minutes)
});
```

### 2. Submitting a Single Commitment

```typescript
// Generate a unique request ID
const requestId = BigInt(Date.now());

// Create payload and authenticator (typically cryptographic elements)
const payload = ethers.toUtf8Bytes('transaction-hash-or-data');
const authenticator = ethers.toUtf8Bytes('authentication-signature');

// Submit the commitment
const result = await gatewayClient.submitCommitment(
  requestId,
  payload,
  authenticator
);

if (result.success) {
  console.log(`Commitment submitted successfully: ${result.transactionHash}`);
} else {
  console.error(`Submission failed: ${result.error?.message}`);
}
```

### 3. Creating a Batch

```typescript
// Create a batch from submitted commitments
const { batchNumber, result } = await gatewayClient.createBatch();

if (result.success) {
  console.log(`Batch #${batchNumber} created successfully`);
} else {
  console.error(`Batch creation failed: ${result.error?.message}`);
}
```

### 4. Submitting Multiple Commitments in One Transaction

```typescript
// Create multiple commitments
const commitments = [
  {
    requestID: BigInt(Date.now()),
    payload: ethers.toUtf8Bytes('data-1'),
    authenticator: ethers.toUtf8Bytes('auth-1')
  },
  {
    requestID: BigInt(Date.now() + 1),
    payload: ethers.toUtf8Bytes('data-2'),
    authenticator: ethers.toUtf8Bytes('auth-2')
  }
];

// Submit all commitments in a single transaction
const { successCount, result } = await gatewayClient.submitCommitments(commitments);

console.log(`Successfully submitted ${successCount} out of ${commitments.length} commitments`);
```

### 5. Combined Submission and Batch Creation

```typescript
// Submit commitments and create a batch in one transaction
const { batchNumber, successCount, result } = await gatewayClient.submitAndCreateBatch(commitments);

if (result.success) {
  console.log(`Batch #${batchNumber} created with ${successCount} commitments`);
} else {
  console.error(`Operation failed: ${result.error?.message}`);
}
```

## 6. Creating Batches with Explicit Batch Numbers

In some scenarios, you may want to create batches with explicit batch numbers, rather than relying on the auto-numbering feature. This can be useful for:

- Implementing custom batch numbering schemes
- Creating batches with specific numbers for identification
- Creating batches in a distributed system with pre-allocated batch numbers

```typescript
// Create a batch with an explicit batch number
const explicitBatchNumber = 42n; // Any positive number
const requestIDs = [1001n, 1002n, 1003n];

const { batchNumber, result } = await gatewayClient.createBatchForRequestsWithNumber(
  requestIDs,
  explicitBatchNumber
);

if (result.success) {
  console.log(`Batch #${batchNumber} created with explicit number`);
} else {
  console.error(`Explicit batch creation failed: ${result.error?.message}`);
}
```

You can also submit commitments and create a batch with an explicit number in a single transaction:

```typescript
// Submit commitments and create a batch with explicit number
const explicitBatchNumber = 100n;

const { batchNumber, successCount, result } = await gatewayClient.submitAndCreateBatchWithNumber(
  commitments,
  explicitBatchNumber
);

if (result.success) {
  console.log(`Batch #${batchNumber} created with ${successCount} commitments`);
} else {
  console.error(`Operation failed: ${result.error?.message}`);
}
```

**Important considerations when using explicit batch numbers:**

1. **Sequential Processing Requirement**: Batches must still be processed in sequential order. Creating a batch with a higher number doesn't allow it to be processed before lower-numbered batches.

2. **Filling Gaps**: When using explicit batch numbers, you may create gaps in the batch sequence. The system supports filling these gaps with auto-numbered batches.

3. **Gap Detection**: The contract maintains a `firstGapIndex` that points to the first gap in the batch sequence. Auto-numbered batches will fill from this index.

4. **Highest Batch Number**: Creating batches with explicit numbers updates the contract's `highestBatchNumber` if the explicit number is higher than the current highest.

## Advanced Configuration

### Automatic Batch Creation

```typescript
// Configuration with automatic batch creation
const gatewayClient = new AggregatorGatewayClient({
  contractAddress: '0xYourContractAddress',
  provider: provider,
  signer: wallet,
  gatewayAddress: wallet.address,
  
  // Auto-creation settings (three options)
  
  // Option 1: Simple flag (uses default interval of 5 minutes)
  autoCreateBatches: true,
  
  // Option 2: Set custom interval (in milliseconds)
  batchCreationInterval: 10 * 60 * 1000, // 10 minutes
  
  // Option 3: Set threshold (create batch when this many commitments are pending)
  batchCreationThreshold: 100
});

// Start automatic batch creation if not enabled in constructor
gatewayClient.startAutoBatchCreation();

// Stop automatic batch creation
gatewayClient.stopAutoBatchCreation();
```

### Event Handling

```typescript
import { EventType } from 'eth-unicity-anchor-client';

// Listen for batch created events
gatewayClient.on(EventType.BatchCreated, (eventType, data) => {
  console.log(`New batch created: #${data.batchNumber}`);
});

// Listen for request submitted events
gatewayClient.on(EventType.RequestSubmitted, (eventType, data) => {
  console.log(`New request submitted: ${data.requestId}`);
});
```

### Batch Processing with AggregatorNodeClient

```typescript
import { AggregatorNodeClient } from 'eth-unicity-anchor-client';

// Initialize the node client
const nodeClient = new AggregatorNodeClient({
  contractAddress: '0xYourContractAddress',
  provider: provider,
  signer: aggregatorWallet, // Must be a registered aggregator
  aggregatorAddress: aggregatorWallet.address,
  smtDepth: 32, // Sparse Merkle Tree depth
  autoProcessing: 300 // Process batches every 5 minutes (300 seconds)
});

// Process a specific batch
const batchNumber = 123n;
const processResult = await nodeClient.processBatch(batchNumber);

if (processResult.success) {
  console.log(`Batch #${batchNumber} processed successfully`);
} else if (processResult.skipped) {
  console.log(`Batch #${batchNumber} was already processed`);
} else if (processResult.verified) {
  console.log(`Batch #${batchNumber} was verified against on-chain state`);
} else {
  console.error(`Processing failed: ${processResult.error?.message}`);
}

// Process all unprocessed batches
const results = await nodeClient.processAllUnprocessedBatches();
console.log(`Processed ${results.length} batches`);

// Start automatic batch processing
nodeClient.startAutoBatchProcessing();

// Stop automatic batch processing
nodeClient.stopAutoBatchProcessing();
```

### Using SMT-Based Node Client

```typescript
import { SMTAggregatorNodeClient } from 'eth-unicity-anchor-client';

// Initialize SMT-based node client
const smtNodeClient = new SMTAggregatorNodeClient({
  contractAddress: '0xYourContractAddress',
  provider: provider,
  signer: aggregatorWallet,
  aggregatorAddress: aggregatorWallet.address,
  smtDepth: 32
});

// Process a batch using Sparse Merkle Tree implementation
const processResult = await smtNodeClient.processBatch(batchNumber);
```

## State Synchronization

The gateway automatically synchronizes with the on-chain state when initialized with `autoProcessing` enabled:

```typescript
// Initialize with auto-sync
const nodeClient = new AggregatorNodeClient({
  // ... other options
  autoProcessing: 60 // Process every minute and sync on startup
});

// Manual synchronization if needed
await nodeClient.syncWithOnChainState();
```

During synchronization, the client:

1. Queries all processed batches from the blockchain
2. Calculates local hashroots for each batch
3. Verifies local hashroots against on-chain values
4. Tracks which batches are processed to avoid duplicate processing

## Generating Inclusion Proofs

```typescript
// Generate a Merkle proof for a specific commitment in a processed batch
const batchNumber = 123n;
const requestId = "0xabcdef1234567890"; // The request ID to generate proof for

const proof = await nodeClient.generateMerkleProof(batchNumber, requestId);

if (proof) {
  console.log("Merkle proof:", proof.proof);
  console.log("Value:", proof.value);
} else {
  console.log("Proof could not be generated. Check if batch is processed.");
}
```

## HTTP Gateway Integration

For REST API implementations:

```typescript
// Initialize HTTP server with gateway client
import http from 'http';

function createHttpGateway(gatewayClient, options = {}) {
  const { apiKey, jwtSecret } = options;
  
  return http.createServer(async (req, res) => {
    // Parse request
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;
    
    // Handle API endpoints
    if (path === '/submitCommitment' && req.method === 'POST') {
      // Validate request and authentication
      // Process with gatewayClient.submitCommitment()
    }
    else if (path === '/submitBatch' && req.method === 'POST') {
      // Process with gatewayClient.submitAndCreateBatch()
    }
    // Additional endpoints...
  });
}

// Start server
const server = createHttpGateway(gatewayClient, { 
  apiKey: 'your-api-key',
  jwtSecret: 'your-jwt-secret'
});
server.listen(3000);
```

## Performance Considerations

- **Batch Size**: Larger batches are more gas-efficient but take longer to process
- **Processing Frequency**: Set `autoProcessing` based on your needs (lower values for quicker anchoring, higher values for gas efficiency)
- **Concurrency**: Multiple gateways can safely operate concurrently due to on-chain synchronization
- **Gas Costs**: Batch operations significantly reduce gas costs compared to individual submissions

## Error Handling & Recovery

The client implements several error recovery mechanisms:

```typescript
// Custom gas and retry settings
const nodeClient = new AggregatorNodeClient({
  // ... other options
  maxRetries: 5,             // Retry failed transactions 5 times
  retryDelay: 2000,          // Wait 2 seconds between retries
  gasLimitMultiplier: 1.5,   // Increase gas limit by 50%
  timeoutMs: 60000           // 1 minute transaction timeout
});
```

In case of unexpected shutdowns, the gateway recovers state by:

1. Tracking processed batches in memory
2. Synchronizing with on-chain state on startup
3. Detecting and handling hashroot mismatches

## Security Best Practices

1. **Private Key Protection**: Never hardcode private keys in your application
2. **Authenticator Validation**: Always validate authenticators before submission
3. **Request ID Verification**: Ensure request IDs are unique and cryptographically bound to their authenticators
4. **Multiple Aggregators**: Deploy multiple aggregator nodes for redundancy
5. **Regular Monitoring**: Monitor batch processing for failures or delays

## Debugging

Enable verbose logging by using a custom logger:

```typescript
const gatewayClient = new AggregatorGatewayClient({
  // ... other options
  logger: {
    debug: (msg) => console.debug(`[Gateway] ${msg}`),
    info: (msg) => console.info(`[Gateway] ${msg}`),
    warn: (msg) => console.warn(`[Gateway] ${msg}`),
    error: (msg) => console.error(`[Gateway] ${msg}`)
  }
});
```

## Conclusion

The Ethereum Unicity Anchor Aggregator Gateway provides a robust, scalable solution for anchoring data commitments on the blockchain. By batching commitments and using Sparse Merkle Trees for verification, it offers an efficient way to provide cryptographic proof of data integrity with on-chain verifiability.

For more details, refer to the full API documentation or the TypeScript definitions in the source code.