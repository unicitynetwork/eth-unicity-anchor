# Ethereum Unicity Anchor Client

A TypeScript client library for interacting with the Ethereum Unicity Anchor smart contract. This library provides functionality for both aggregator gateways and aggregator nodes to submit commitments, create batches, process batches, and submit hashroots.

## Installation

```bash
npm install eth-unicity-anchor-client
```

## Features

- **Aggregator Gateway Client**: Submit commitments and create batches
- **Enhanced Aggregator Gateway**: Compatible with aggregators_net interface with added features
- **Aggregator Node Client**: Process batches and submit hashroots
- **Sparse Merkle Tree Integration**: Build and verify SMT data structures
- **Event Handling**: Listen for contract events
- **Automatic Processing**: Optional automatic batch creation and processing
- **Merkle Proof Generation**: Generate and verify proofs for commitments
- **Authentication**: Support for API keys, JWT tokens, and Ethereum signatures
- **Batch Operations**: Submit multiple commitments or entire batches in a single call

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

### Enhanced Aggregator Gateway with Authentication

```typescript
import { 
  AggregatorGateway, 
  AuthMethod, 
  SubmitCommitmentStatus,
  BatchSubmissionDto
} from 'eth-unicity-anchor-client';
import { ethers } from 'ethers';

// Create enhanced gateway with API key authentication
const gateway = new AggregatorGateway({
  providerUrl: 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY',
  contractAddress: '0x1234567890123456789012345678901234567890',
  privateKey: 'YOUR_PRIVATE_KEY',
  gatewayAddress: '0xYOUR_GATEWAY_ADDRESS',
  autoCreateBatches: true,
  // Authentication configuration
  authMethod: AuthMethod.API_KEY,
  apiKeys: {
    'testkey123': {
      name: 'Test API Key',
      role: 'submitter',
      permissions: ['batch:submit', 'batch:read']
    }
  },
  // Optional: configure other auth methods
  jwtSecret: 'your-jwt-secret-key',
  trustedSigners: ['0xYourTrustedSignerAddress']
});

// Submit a single commitment (compatible with aggregators_net interface)
async function submitSingleCommitment() {
  const result = await gateway.submitCommitment({
    requestId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    authenticator: {
      publicKey: '0x1111111111111111111111111111111111111111111111111111111111111111',
      stateHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
      signature: '0x3333333333333333333333333333333333333333333333333333333333333333'
    }
  });
  
  console.log(`Commitment status: ${result.status}`);
}

// Submit multiple commitments in one call
async function submitMultipleCommitments() {
  const multipleCommitments = [
    {
      requestId: '0xaaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111',
      transactionHash: '0xbbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222',
      authenticator: {
        publicKey: '0x1111111111111111111111111111111111111111111111111111111111111111',
        stateHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
        signature: '0x3333333333333333333333333333333333333333333333333333333333333333'
      }
    },
    // Additional commitments...
  ];

  const result = await gateway.submitMultipleCommitments(
    multipleCommitments,
    { apiKey: 'testkey123' }
  );
  
  console.log(`Processed ${result.processedCount} commitments`);
  if (result.batchCreated) {
    console.log(`Created batch #${result.batchNumber}`);
  }
}

// Submit an entire batch with Ethereum signature authentication
async function submitBatchWithSignature() {
  const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY');
  const message = `Submit batch to aggregator. Timestamp: ${Date.now()}`;
  const signature = await wallet.signMessage(message);
  
  const batch: BatchSubmissionDto = {
    commitments: [
      {
        requestID: '0xeeee3333eeee3333eeee3333eeee3333eeee3333eeee3333eeee3333eeee3333',
        payload: '0xffff4444ffff4444ffff4444ffff4444ffff4444ffff4444ffff4444ffff4444',
        authenticator: '0x111111111111111111111111111111111111111111111111111111111111111122222222222222222222222222222222222222222222222222222222222222223333333333333333333333333333333333333333333333333333333333333333'
      },
      // Additional commitments...
    ]
  };
  
  const result = await gateway.submitBatch(
    batch,
    { 
      signature: {
        message,
        signature,
        signer: wallet.address
      } 
    }
  );
  
  if (result.success) {
    console.log(`Created batch #${result.batchNumber} with ${result.successCount} commitments`);
  }
}

// Get inclusion proof for a commitment
async function getInclusionProof() {
  const proof = await gateway.getInclusionProof(
    '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
  );
  
  if (proof) {
    console.log('Proof obtained:', proof);
  } else {
    console.log('Proof not found');
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

### `AggregatorGateway`

Enhanced client implementing the aggregators_net interface with additional features.

#### Constructor

```typescript
new AggregatorGateway(config: AuthenticatedGatewayConfig)
```

#### Methods

- `submitCommitment(request, authToken?)`: Submit a single commitment (compatible with aggregators_net)
- `submitMultipleCommitments(requests, authData)`: Submit multiple commitments in one call
- `submitBatch(batch, authData)`: Submit an entire batch directly
- `getInclusionProof(requestId)`: Get inclusion proof for a request
- `getNoDeleteProof()`: Get no deletion proof
- `startAutoBatchCreation()`: Start automatic batch creation
- `stopAutoBatchCreation()`: Stop automatic batch creation
- `submitCommitmentLegacy(requestID, payload, authenticator)`: Legacy method for backward compatibility

#### Authentication Methods

- API Key: Simple key-based authentication with permission checking
- JWT Token: JSON Web Token validation with permission checking
- Ethereum Signature: Validation of signed messages against trusted addresses

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

Run all tests:

```bash
npm run test:all
```

Run only unit tests:

```bash
npm run test:unit
```

Run only integration tests:

```bash
npm run test:integration
```

Run a specific test file:

```bash
npm test -- -t "AggregatorGateway"
```

### Test Coverage

The library includes comprehensive test suites for all components:

- **Unit Tests**: Test individual methods and classes in isolation
- **Integration Tests**: Test interactions between components
- **Mock Tests**: Test with mocked HTTP clients and contract interactions
- **SMT Integration Tests**: Test the Sparse Merkle Tree implementation

The AggregatorGateway component has dedicated tests that verify:

- Commitment submission with various authentication methods
- Batch operations and multiple commitment submission
- Hashroot generation and submission
- Inclusion proof generation and verification
- Error handling and edge cases

### Linting

```bash
npm run lint
```

### Formatting

```bash
npm run format
```

## License

MIT