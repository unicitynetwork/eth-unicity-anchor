# Ethereum Unicity Anchor Client

A TypeScript client library for interacting with the Ethereum Unicity Anchor smart contract. This library provides functionality for both aggregator gateways and aggregator nodes to submit commitments, create batches, process batches, and submit hashroots.

## Installation

```bash
npm install eth-unicity-anchor-client
```

## Features

- **Aggregator Gateway Client**: Submit commitments and create batches
- **Aggregator Node Client**: Process batches and submit hashroots
- **Sparse Merkle Tree Integration**: Build and verify SMT data structures
- **Event Handling**: Listen for contract events
- **Automatic Processing**: Optional automatic batch creation and processing
- **Merkle Proof Generation**: Generate and verify proofs for commitments

## Usage

### Aggregator Gateway Client

```typescript
import { AggregatorGatewayClient, generateRandomRequestId } from 'eth-unicity-anchor-client';

// Create a gateway client
const gateway = new AggregatorGatewayClient({
  providerUrl: 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY',
  contractAddress: '0x1234567890123456789012345678901234567890',
  privateKey: 'YOUR_PRIVATE_KEY',
  gatewayAddress: '0xYOUR_GATEWAY_ADDRESS',
  autoCreateBatches: true,
  batchCreationThreshold: 50,
  batchCreationInterval: 300000 // 5 minutes
});

// Submit a commitment
async function submitCommitment() {
  const requestId = generateRandomRequestId();
  const payload = new TextEncoder().encode('Example payload');
  const authenticator = new TextEncoder().encode('Example authenticator');
  
  const result = await gateway.submitCommitment(
    requestId,
    payload,
    authenticator
  );
  
  console.log(`Submitted commitment ${requestId}: ${result.success}`);
  if (result.success) {
    console.log(`Transaction hash: ${result.transactionHash}`);
  }
}

// Create a batch manually
async function createBatch() {
  const { batchNumber, result } = await gateway.createBatch();
  
  if (result.success) {
    console.log(`Created batch #${batchNumber}`);
  }
}

// Create a batch with specific request IDs
async function createBatchForRequests(requestIds) {
  const { batchNumber, result } = await gateway.createBatchForRequests(requestIds);
  
  if (result.success) {
    console.log(`Created batch #${batchNumber} with specific requests`);
  }
}
```

### Aggregator Node Client

```typescript
import { AggregatorNodeClient } from 'eth-unicity-anchor-client';

// Create an aggregator node client
const aggregator = new AggregatorNodeClient({
  providerUrl: 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY',
  contractAddress: '0x1234567890123456789012345678901234567890',
  privateKey: 'YOUR_PRIVATE_KEY',
  aggregatorAddress: '0xYOUR_AGGREGATOR_ADDRESS',
  smtDepth: 32,
  autoProcessBatches: true,
  batchProcessingInterval: 300000 // 5 minutes
});

// Process a batch manually
async function processBatch(batchNumber) {
  const result = await aggregator.processBatch(batchNumber);
  
  if (result.success) {
    console.log(`Processed batch #${batchNumber}`);
  } else {
    console.error(`Failed to process batch: ${result.error?.message}`);
  }
}

// Check for batches to process
async function checkBatches() {
  const nextBatch = await aggregator.getNextBatchToProcess();
  
  if (nextBatch !== null) {
    console.log(`Next batch to process: ${nextBatch}`);
    await processBatch(nextBatch);
  } else {
    console.log('No batches to process');
  }
}

// Generate a Merkle proof for a commitment
async function generateProof(batchNumber, requestId) {
  const proof = await aggregator.generateMerkleProof(batchNumber, requestId);
  
  if (proof) {
    console.log('Merkle proof:', proof);
  } else {
    console.log('Could not generate proof');
  }
}
```

### Event Handling

```typescript
import { EventType } from 'eth-unicity-anchor-client';

// Listen for events
client.on(EventType.RequestSubmitted, (eventType, data) => {
  console.log(`New request submitted: ${data.requestID}`);
});

client.on(EventType.BatchCreated, (eventType, data) => {
  console.log(`New batch created: ${data.batchNumber} with ${data.requestCount} requests`);
});

client.on(EventType.BatchProcessed, (eventType, data) => {
  console.log(`Batch ${data.batchNumber} processed with hashroot: ${data.hashroot}`);
});

client.on(EventType.HashrootSubmitted, (eventType, data) => {
  console.log(`Aggregator ${data.aggregator} submitted hashroot for batch ${data.batchNumber}`);
});
```

## API Reference

### `AggregatorGatewayClient`

Client for aggregator gateway operations, handling commitment collection and batch creation.

#### Constructor

```typescript
new AggregatorGatewayClient(config: GatewayConfig)
```

#### Methods

- `submitCommitment(requestID, payload, authenticator)`: Submit a commitment to the contract
- `createBatch()`: Create a new batch with all unprocessed commitments
- `createBatchForRequests(requestIDs)`: Create a batch with specific commitments
- `startAutoBatchCreation()`: Start automatic batch creation
- `stopAutoBatchCreation()`: Stop automatic batch creation
- `validateCommitment(request)`: Validate a commitment request
- `submitMultipleCommitments(requests)`: Submit multiple commitments in sequence

### `AggregatorNodeClient`

Client for aggregator node operations, handling batch processing and hashroot submissions.

#### Constructor

```typescript
new AggregatorNodeClient(config: AggregatorConfig)
```

#### Methods

- `submitHashroot(batchNumber, hashroot)`: Submit a hashroot for a batch
- `processBatch(batchNumber)`: Process a batch by computing its hashroot
- `startAutoBatchProcessing()`: Start automatic batch processing
- `stopAutoBatchProcessing()`: Stop automatic batch processing
- `canProcessNextBatch()`: Check if next batch can be processed
- `getNextBatchToProcess()`: Get the next batch number to process
- `generateMerkleProof(batchNumber, requestID)`: Generate a Merkle proof

### Utility Functions

- `generateRandomRequestId()`: Generate a random request ID
- `bytesToHex(bytes)`: Convert bytes to hex string
- `hexToBytes(hex)`: Convert hex string to bytes
- `keccak256(data)`: Compute Keccak256 hash

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm run test
```

### Linting

```bash
npm run lint
```

## License

MIT