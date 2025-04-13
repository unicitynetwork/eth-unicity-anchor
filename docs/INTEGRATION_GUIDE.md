# Ethereum Unicity Anchor: Integration Guide

This guide provides comprehensive integration instructions for development and QA teams working with the Ethereum Unicity Anchor system. It focuses on how to integrate production aggregator gateways and aggregator instances with the system for processing commitment submissions, batch management, and hashroot verification.

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Aggregator Gateway Integration](#2-aggregator-gateway-integration)
3. [Aggregator Node Integration](#3-aggregator-node-integration)
4. [Smart Contract Interaction](#4-smart-contract-interaction)
5. [Configuration Best Practices](#5-configuration-best-practices)
6. [Authentication and Security](#6-authentication-and-security)
7. [Testing and Validation](#7-testing-and-validation)
8. [Monitoring and Maintenance](#8-monitoring-and-maintenance)
9. [Troubleshooting](#9-troubleshooting)
10. [API Reference](#10-api-reference)

## 1. System Architecture Overview

The Ethereum Unicity Anchor system consists of three main components:

1. **Smart Contract**: The on-chain component that stores commitments, manages batches, and validates hashroots
2. **Aggregator Gateways**: Services that accept user commitment requests and forward them to the smart contract
3. **Aggregator Nodes**: Services that process batches, compute hashroots using SMT (Sparse Merkle Tree), and submit them to the smart contract

### Workflow

![Unicity Anchor Workflow](https://example.com/workflow-diagram.png)

1. Users submit commitment requests to Aggregator Gateways
2. Gateways validate commitments and submit them to the smart contract
3. Gateways trigger batch creation when sufficient requests accumulate
4. Aggregator Nodes retrieve unprocessed batches
5. Nodes compute SMT hashroots for the batches
6. Nodes submit hashroots to the smart contract
7. When sufficient nodes agree on a hashroot, the batch is marked as processed

### Key Technical Concepts

- **Commitment Requests**: Contains requestID, payload, and authenticator
- **Batches**: Groups of commitment requests with sequential batch numbers
- **Sparse Merkle Trees (SMT)**: Data structure used for efficient verification
- **Hashroots**: The root hash of the SMT representing a processed batch
- **Consensus Mechanism**: Multiple aggregators must agree on hashroots

## 2. Aggregator Gateway Integration

Aggregator Gateways are the entry point for users to submit commitment requests. They handle commitment validation, submission to the smart contract, and batch creation.

### Setting Up an Aggregator Gateway

1. **Prerequisites**:
   - Node.js v16+ environment
   - Access to Ethereum node (via RPC)
   - Gateway private key with gas funds
   - Trusted aggregator status on the contract

2. **Installation**:
   ```bash
   npm install @unicity-anchor/ts-client ethers@6.x.x @openzeppelin/merkle-tree
   ```

3. **Basic Gateway Implementation**:
   ```typescript
   import { AggregatorGatewayClient } from '@unicity-anchor/ts-client';

   const gateway = new AggregatorGatewayClient({
     providerUrl: 'https://eth-mainnet.provider.com',
     contractAddress: '0x1234567890123456789012345678901234567890',
     privateKey: process.env.GATEWAY_PRIVATE_KEY,
     gatewayAddress: '0xGATEWAY_ADDRESS',
     batchCreationThreshold: 50,
     batchCreationInterval: 300000, // 5 minutes
     autoCreateBatches: true,
     maxRetries: 3,
     gasLimitMultiplier: 1.2
   });

   // Start listening for commitment requests
   startApiServer(gateway);
   ```

### Handling Commitment Submissions

1. **Validating Commitments**:
   ```typescript
   function validateCommitment(req, gateway) {
     const { requestID, payload, authenticator } = req.body;
     
     // Custom validation logic
     if (!requestID || !payload || !authenticator) {
       return false;
     }
     
     // Check if request ID is valid
     if (BigInt(requestID) <= 0) {
       return false;
     }
     
     // Additional application-specific validation
     // ...
     
     return true;
   }
   ```

2. **Submitting Individual Commitments**:
   ```typescript
   app.post('/api/commitments', async (req, res) => {
     try {
       const { requestID, payload, authenticator } = req.body;
       
       // Validate request
       if (!validateCommitment(req, gateway)) {
         return res.status(400).json({ error: 'Invalid commitment request' });
       }
       
       // Submit to contract
       const result = await gateway.submitCommitment(
         requestID,
         payload,
         authenticator
       );
       
       if (result.success) {
         return res.status(200).json({
           success: true,
           transactionHash: result.transactionHash
         });
       } else {
         return res.status(500).json({
           success: false,
           error: result.error?.message
         });
       }
     } catch (error) {
       console.error('Error submitting commitment:', error);
       return res.status(500).json({ error: 'Internal server error' });
     }
   });
   ```

3. **Submitting Multiple Commitments in a Single Transaction**:
   ```typescript
   app.post('/api/commitments/bulk', async (req, res) => {
     try {
       const { commitments } = req.body;
       
       if (!Array.isArray(commitments) || commitments.length === 0) {
         return res.status(400).json({ error: 'Invalid commitments array' });
       }
       
       // Submit multiple commitments in a single transaction
       const { successCount, result } = await gateway.submitCommitments(commitments);
       
       if (result.success) {
         return res.status(200).json({
           success: true,
           successCount: successCount.toString(),
           transactionHash: result.transactionHash
         });
       } else {
         return res.status(500).json({
           success: false,
           error: result.error?.message
         });
       }
     } catch (error) {
       console.error('Error submitting bulk commitments:', error);
       return res.status(500).json({ error: 'Internal server error' });
     }
   });
   ```

4. **Submitting and Creating Batch in a Single Transaction**:
   ```typescript
   app.post('/api/commitments/batch', async (req, res) => {
     try {
       const { commitments } = req.body;
       
       if (!Array.isArray(commitments) || commitments.length === 0) {
         return res.status(400).json({ error: 'Invalid commitments array' });
       }
       
       // Submit commitments and create batch in one transaction
       const { batchNumber, successCount, result } = await gateway.submitAndCreateBatch(commitments);
       
       if (result.success) {
         return res.status(200).json({
           success: true,
           batchNumber: batchNumber.toString(),
           successCount: successCount.toString(),
           transactionHash: result.transactionHash
         });
       } else {
         return res.status(500).json({
           success: false,
           error: result.error?.message
         });
       }
     } catch (error) {
       console.error('Error in submission and batch creation:', error);
       return res.status(500).json({ error: 'Internal server error' });
     }
   });
   ```

### Managing Batch Creation

1. **Manual Batch Creation**:
   ```typescript
   app.post('/api/batches', async (req, res) => {
     try {
       const { batchNumber, result } = await gateway.createBatch();
       
       if (result.success) {
         return res.status(200).json({
           success: true,
           batchNumber: batchNumber.toString(),
           transactionHash: result.transactionHash
         });
       } else {
         return res.status(500).json({
           success: false,
           error: result.error?.message
         });
       }
     } catch (error) {
       console.error('Error creating batch:', error);
       return res.status(500).json({ error: 'Internal server error' });
     }
   });
   ```

2. **Automatic Batch Creation**:
   ```typescript
   // Configure automatic batch creation
   gateway.startAutoBatchCreation();

   // Later, if needed:
   gateway.stopAutoBatchCreation();
   ```

3. **Creating Batches with Specific Request IDs**:
   ```typescript
   app.post('/api/batches/specific', async (req, res) => {
     try {
       const { requestIDs } = req.body;
       
       if (!Array.isArray(requestIDs) || requestIDs.length === 0) {
         return res.status(400).json({ error: 'Request IDs array required' });
       }
       
       const { batchNumber, result } = await gateway.createBatchForRequests(requestIDs);
       
       if (result.success) {
         return res.status(200).json({
           success: true,
           batchNumber: batchNumber.toString(),
           transactionHash: result.transactionHash
         });
       } else {
         return res.status(500).json({
           success: false,
           error: result.error?.message
         });
       }
     } catch (error) {
       console.error('Error creating batch for requests:', error);
       return res.status(500).json({ error: 'Internal server error' });
     }
   });
   ```

### Event Handling

```typescript
import { EventType } from '@unicity-anchor/ts-client';

// Listen for events
gateway.on(EventType.RequestSubmitted, (_, data) => {
  console.log(`New request submitted: ${data.requestID}`);
});

gateway.on(EventType.BatchCreated, (_, data) => {
  console.log(`New batch created: ${data.batchNumber} with ${data.requestCount} requests`);
});
```

## 3. Aggregator Node Integration

Aggregator Nodes process batches of commitments by computing SMT hashroots and submitting them to the smart contract. Multiple nodes work in parallel to achieve consensus.

### Setting Up an Aggregator Node

1. **Prerequisites**:
   - Node.js v16+ environment
   - Access to Ethereum node (via RPC)
   - Node private key with gas funds
   - Trusted aggregator status on the contract

2. **Installation**:
   ```bash
   npm install @unicity-anchor/ts-client ethers@6.x.x @openzeppelin/merkle-tree
   ```

3. **Basic Node Implementation**:
   ```typescript
   import { AggregatorNodeClient } from '@unicity-anchor/ts-client';

   const node = new AggregatorNodeClient({
     providerUrl: 'https://eth-mainnet.provider.com',
     contractAddress: '0x1234567890123456789012345678901234567890',
     privateKey: process.env.NODE_PRIVATE_KEY,
     aggregatorAddress: '0xNODE_ADDRESS',
     smtDepth: 32,
     batchProcessingInterval: 300000, // 5 minutes
     autoProcessBatches: true,
     maxRetries: 3,
     gasLimitMultiplier: 1.2
   });
   ```

### Processing Batches and Computing Hashroots

1. **Manual Batch Processing**:
   ```typescript
   app.post('/api/process-batch/:batchNumber', async (req, res) => {
     try {
       const { batchNumber } = req.params;
       
       // Process the batch
       const result = await node.processBatch(batchNumber);
       
       if (result.success) {
         return res.status(200).json({
           success: true,
           batchNumber,
           transactionHash: result.transactionHash
         });
       } else {
         return res.status(500).json({
           success: false,
           error: result.error?.message
         });
       }
     } catch (error) {
       console.error('Error processing batch:', error);
       return res.status(500).json({ error: 'Internal server error' });
     }
   });
   ```

2. **Automatic Batch Processing**:
   ```typescript
   // Configure automatic batch processing
   node.startAutoBatchProcessing();

   // Later, if needed:
   node.stopAutoBatchProcessing();
   ```

3. **Custom Hashroot Computation** (if needed, instead of default implementation):
   ```typescript
   import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
   import { hexToBytes, bytesToHex } from '@unicity-anchor/ts-client';
   import { ethers } from 'ethers';

   async function computeCustomHashroot(batchNumber, requests) {
     // Create leaf nodes for the Merkle Tree
     const leaves = requests.map(req => {
       const key = req.requestID;
       const value = bytesToHex(
         ethers.concat([
           hexToBytes(req.payload), 
           hexToBytes(req.authenticator)
         ])
       );
       return [key, value];
     });
     
     // Create Merkle Tree
     const tree = StandardMerkleTree.of(leaves, ['string', 'string']);
     
     // Get root
     const root = tree.root;
     const rootBytes = hexToBytes(root);
     
     return rootBytes;
   }
   ```

### Proof Generation and Verification

```typescript
app.get('/api/proof/:batchNumber/:requestID', async (req, res) => {
  try {
    const { batchNumber, requestID } = req.params;
    
    const proof = await node.generateMerkleProof(batchNumber, requestID);
    
    if (proof) {
      return res.status(200).json({
        success: true,
        proof: proof.proof,
        value: proof.value
      });
    } else {
      return res.status(404).json({
        success: false,
        error: 'Proof not found or batch not processed'
      });
    }
  } catch (error) {
    console.error('Error generating proof:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
```

### Event Handling

```typescript
import { EventType } from '@unicity-anchor/ts-client';

// Listen for events
node.on(EventType.BatchCreated, (_, data) => {
  console.log(`New batch created: ${data.batchNumber}`);
  // Optionally trigger immediate processing
  node.processBatch(data.batchNumber).catch(console.error);
});

node.on(EventType.HashrootSubmitted, (_, data) => {
  console.log(`Hashroot submitted for batch ${data.batchNumber} by ${data.aggregator}`);
});

node.on(EventType.BatchProcessed, (_, data) => {
  console.log(`Batch ${data.batchNumber} processed with hashroot ${data.hashroot}`);
});
```

## 4. Smart Contract Interaction

For direct interaction with the smart contract (beyond what the gateway and node clients provide), you can use the base client.

### Direct Contract Access

```typescript
import { UniCityAnchorClient } from '@unicity-anchor/ts-client';

const client = new UniCityAnchorClient({
  providerUrl: 'https://eth-mainnet.provider.com',
  contractAddress: '0x1234567890123456789012345678901234567890',
  privateKey: process.env.PRIVATE_KEY
});

// Check contract status
const isAvailable = await client.isContractAvailable();
if (!isAvailable) {
  console.error('Contract not available at the specified address');
  process.exit(1);
}

// Get latest batch information
const latestBatchNumber = await client.getLatestBatchNumber();
const latestProcessedBatchNumber = await client.getLatestProcessedBatchNumber();
console.log(`Latest batch: ${latestBatchNumber}, Latest processed: ${latestProcessedBatchNumber}`);
```

### Administrative Functions

```typescript
// Add a new trusted aggregator (only callable by owner)
const addResult = await client.addAggregator('0xNEW_AGGREGATOR_ADDRESS');
if (addResult.success) {
  console.log(`Added new aggregator, tx: ${addResult.transactionHash}`);
}

// Update required votes threshold (only callable by owner)
const updateResult = await client.updateRequiredVotes(3);
if (updateResult.success) {
  console.log(`Updated required votes to 3, tx: ${updateResult.transactionHash}`);
}

// Transfer ownership (only callable by current owner)
const transferResult = await client.transferOwnership('0xNEW_OWNER_ADDRESS');
if (transferResult.success) {
  console.log(`Transferred ownership, tx: ${transferResult.transactionHash}`);
}
```

## 5. Configuration Best Practices

### Gateway Configuration

| Parameter | Recommended Value | Description |
|-----------|-------------------|-------------|
| `batchCreationThreshold` | 50-100 | Number of commitments before auto-creating a batch |
| `batchCreationInterval` | 300000 (5 min) | Time between batch creation attempts |
| `maxRetries` | 3-5 | Number of transaction retry attempts |
| `gasLimitMultiplier` | 1.2-1.5 | Factor to multiply estimated gas by |
| `autoCreateBatches` | true | Whether to automatically create batches |

### Node Configuration

| Parameter | Recommended Value | Description |
|-----------|-------------------|-------------|
| `smtDepth` | 32 | Depth of Sparse Merkle Tree |
| `batchProcessingInterval` | 180000 (3 min) | Time between batch processing attempts |
| `maxRetries` | 3-5 | Number of transaction retry attempts |
| `gasLimitMultiplier` | 1.2-1.5 | Factor to multiply estimated gas by |
| `autoProcessBatches` | true | Whether to automatically process batches |

### Production Environment Variables

Create a `.env` file with these variables:

```
# Network
ETHEREUM_RPC_URL=https://eth-mainnet.provider.com
CONTRACT_ADDRESS=0x1234567890123456789012345678901234567890

# Gateway
GATEWAY_PRIVATE_KEY=0x...
GATEWAY_ADDRESS=0x...
BATCH_CREATION_THRESHOLD=50
BATCH_CREATION_INTERVAL=300000

# Node
NODE_PRIVATE_KEY=0x...
NODE_ADDRESS=0x...
SMT_DEPTH=32
BATCH_PROCESSING_INTERVAL=180000

# General
GAS_LIMIT_MULTIPLIER=1.3
MAX_RETRIES=3
```

## 6. Authentication and Security

### Private Key Management

1. **Never store private keys in code**:
   - Use environment variables or secrets management
   - Consider using a Hardware Security Module (HSM) in production

2. **Multiple Aggregator Nodes**:
   - Each node should have its own private key
   - Keys should be rotated periodically
   - Use different keys for different environments

### Gateway API Security

1. **Authentication**:
   - Implement API keys or OAuth 2.0
   - Rate limiting to prevent abuse
   - IP whitelisting for trusted clients

2. **Input Validation**:
   - Validate all user inputs
   - Sanitize data before processing
   - Check request ID format and ranges
   - Verify payload and authenticator formats

### Example Express.js Middleware

```typescript
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey || !validateApiKey(apiKey)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
};

const rateLimiter = (req, res, next) => {
  // Implement rate limiting logic
  next();
};

// Apply middleware
app.use('/api', apiKeyAuth);
app.use('/api', rateLimiter);
```

## 7. Testing and Validation

### Local Testing Environment

1. **Set up a local blockchain**:
   ```bash
   # Using Anvil (from Foundry)
   anvil --port 8545
   ```

2. **Deploy test contract**:
   ```bash
   forge script script/AggregatorBatches.s.sol --rpc-url http://localhost:8545 --broadcast
   ```

3. **Configure test client**:
   ```bash
   cd ts-client
   npm run build
   ```

### Automated E2E Testing

For comprehensive end-to-end testing, the repository includes a script that handles:
- Setting up a local Ethereum node
- Deploying the contract
- Running automated tests

```bash
# Run all tests
./scripts/manual-e2e-test.sh all

# Run only integration tests
./scripts/manual-e2e-test.sh integration

# Run only gateway tests
./scripts/manual-e2e-test.sh gateway
```

### Gateway Testing with CLI Tool

The repository includes a specialized CLI tool for testing gateway endpoints. This tool is valuable for both automated and manual validation of gateway functionality.

#### Basic Usage

```bash
npx ts-node src/test-gateway.ts http://gateway-url [options]
```

#### Gateway Test Features

The gateway test tool provides:
- Commitment submission testing
- Inclusion proof polling and verification
- Support for both inclusion and non-inclusion proofs
- Detailed reporting of test results
- Configurable timeout and polling parameters

For detailed documentation on the gateway testing tool, see the [Gateway Testing Guide](GATEWAY_TESTING_GUIDE.md).

### Validating Core Functionality
   ```typescript
   const testClient = new UniCityAnchorClient({
     providerUrl: 'http://localhost:8545',
     contractAddress: '0x...', // Deployed contract address
     privateKey: '0x...' // Test private key
   });
   ```

### Integration Tests

1. **Gateway Integration Test**:
   ```typescript
   // Test commitment submission and batch creation
   async function testGatewayWorkflow() {
     // Submit commitments
     for (let i = 1; i <= 10; i++) {
       const result = await gateway.submitCommitment(
         BigInt(i),
         new TextEncoder().encode(`payload-${i}`),
         new TextEncoder().encode(`auth-${i}`)
       );
       console.assert(result.success, `Commitment ${i} submission failed`);
     }
     
     // Create batch
     const { batchNumber, result } = await gateway.createBatch();
     console.assert(result.success, 'Batch creation failed');
     console.log(`Created batch ${batchNumber}`);
     
     return batchNumber;
   }
   ```

2. **Node Integration Test**:
   ```typescript
   // Test batch processing and hashroot submission
   async function testNodeWorkflow(batchNumber) {
     // Process batch
     const result = await node.processBatch(batchNumber);
     console.assert(result.success, 'Batch processing failed');
     console.log(`Processed batch ${batchNumber}`);
     
     // Check if batch is processed
     const { processed, hashroot } = await node.getBatch(batchNumber);
     console.assert(processed, 'Batch not marked as processed');
     console.log(`Batch hashroot: ${hashroot}`);
   }
   ```

3. **Full System Test**:
   ```typescript
   async function runE2ETest() {
     // Create multiple aggregator nodes
     const node1 = createAggregatorNode(privateKey1);
     const node2 = createAggregatorNode(privateKey2);
     const node3 = createAggregatorNode(privateKey3);
     
     // Create gateway
     const gateway = createAggregatorGateway(privateKey4);
     
     // Submit commitments
     for (let i = 1; i <= 20; i++) {
       await gateway.submitCommitment(/* ... */);
     }
     
     // Create batch
     const { batchNumber } = await gateway.createBatch();
     
     // Process batch with all nodes
     await Promise.all([
       node1.processBatch(batchNumber),
       node2.processBatch(batchNumber),
       node3.processBatch(batchNumber)
     ]);
     
     // Verify batch is processed
     const { processed } = await gateway.getBatch(batchNumber);
     console.assert(processed, 'E2E test failed: batch not processed');
     console.log('E2E test passed!');
   }
   ```

### Production Validation Checklist

- [ ] Smart contract deployed and verified
- [ ] Aggregator gateways can submit commitments
- [ ] Batch creation works correctly
- [ ] Aggregator nodes can process batches
- [ ] Multiple nodes reach consensus
- [ ] Events are properly emitted and captured
- [ ] Error handling works as expected
- [ ] API endpoints are secured
- [ ] Monitoring is in place

## 8. Monitoring and Maintenance

### Key Metrics to Monitor

1. **System Health**:
   - Unprocessed commitment queue size
   - Time between batch creation and processing
   - Transaction success/failure rate
   - Gas costs

2. **Performance**:
   - API response times
   - Batch processing time
   - Hashroot computation time
   - Network latency

3. **Security**:
   - Failed authentication attempts
   - Rejected commitment submissions
   - Unauthorized contract calls

### Prometheus Metrics Example

```typescript
import prometheus from 'prom-client';

// Create metrics
const commitmentCounter = new prometheus.Counter({
  name: 'unicity_commitments_total',
  help: 'Total number of commitments submitted'
});

const batchCounter = new prometheus.Counter({
  name: 'unicity_batches_total',
  help: 'Total number of batches created'
});

const unprocessedGauge = new prometheus.Gauge({
  name: 'unicity_unprocessed_commitments',
  help: 'Number of unprocessed commitments'
});

const processingTimeHistogram = new prometheus.Histogram({
  name: 'unicity_batch_processing_seconds',
  help: 'Time taken to process a batch',
  buckets: prometheus.exponentialBuckets(0.1, 2, 10)
});

// Update metrics
gateway.on(EventType.RequestSubmitted, () => {
  commitmentCounter.inc();
});

gateway.on(EventType.BatchCreated, () => {
  batchCounter.inc();
});

// Update unprocessed gauge periodically
setInterval(async () => {
  const count = await gateway.getUnprocessedRequestCount();
  unprocessedGauge.set(Number(count));
}, 60000);
```

### Alerting

Set up alerts for:

1. Unprocessed commitment queue exceeding threshold
2. Batch processing time exceeding threshold
3. Failed transactions
4. Low gas funds in aggregator accounts
5. Contract errors

### System Maintenance

1. **Regular Tasks**:
   - Rotate API keys periodically
   - Check gas balances in aggregator accounts
   - Review transaction logs for errors
   - Update client dependencies

2. **Backup and Recovery**:
   - Back up private keys (securely)
   - Document recovery procedures
   - Create runbooks for common issues

3. **Updating Smart Contract**:
   - Current contract is not upgradeable
   - For updates, deploy new contract and migrate
   - Coordinate updates across all aggregators

## 9. Troubleshooting

### Common Issues and Solutions

| Issue | Possible Causes | Solutions |
|-------|-----------------|-----------|
| Commitment Rejection | Duplicate request ID with different data | Check if request ID already exists |
| Batch Creation Failure | No unprocessed commitments | Wait for commitments or check filters |
| | Gas price too low | Increase gas limit multiplier |
| Hashroot Submission Failure | Batch already processed | Check batch status before processing |
| | Wrong batch sequence | Batches must be processed in order |
| | Different hashroot calculation | Ensure consistent SMT implementation |
| Consensus Failure | Not enough aggregators | Check required votes setting |
| | Different hashroot submissions | Review SMT implementation for consistency |
| Transaction Timeouts | Network congestion | Increase gas price, adjust retry parameters |

### Debugging

1. **Transaction Debugging**:
   ```typescript
   // Enable debug logging
   client.on(EventType.ANY, (eventType, data) => {
     console.log(`[DEBUG] Event: ${eventType}`, data);
   });

   // Log transaction details
   const result = await gateway.submitCommitment(/* ... */);
   if (!result.success) {
     console.error('Transaction failed:', result.error);
     console.error('Gas used:', result.gasUsed);
     console.error('Transaction hash:', result.transactionHash);
   }
   ```

2. **Viewing Raw Contract Data**:
   ```typescript
   // Get raw contract data for debugging
   const rawTx = await client.provider.getTransaction(txHash);
   console.log('Raw transaction:', rawTx);
   
   const receipt = await client.provider.getTransactionReceipt(txHash);
   console.log('Receipt logs:', receipt.logs);
   ```

3. **Testing with Traces**:
   ```bash
   # Trace a transaction (using cast from Foundry)
   cast trace --rpc-url $ETHEREUM_RPC_URL $TRANSACTION_HASH
   ```

## 10. API Reference

### Aggregator Gateway API

| Endpoint | Method | Description | Parameters |
|----------|--------|-------------|------------|
| `/api/commitments` | POST | Submit a single commitment | `requestID`, `payload`, `authenticator` |
| `/api/commitments/bulk` | POST | Submit multiple commitments in one transaction | `commitments`: array of `{requestID, payload, authenticator}` |
| `/api/commitments/batch` | POST | Submit commitments and create batch in one transaction | `commitments`: array of `{requestID, payload, authenticator}` |
| `/api/batches` | POST | Create a batch | none |
| `/api/batches/specific` | POST | Create a batch with specific requests | `requestIDs` |
| `/api/batches/:batchNumber` | GET | Get a batch by number | `batchNumber` |
| `/api/batches/latest` | GET | Get the latest batch | none |
| `/api/batches/latest/unprocessed` | GET | Get the latest unprocessed batch | none |
| `/api/commitments/:requestID` | GET | Get a commitment by ID | `requestID` |
| `/api/unprocessed` | GET | Get all unprocessed requests | none |

### Aggregator Node API

| Endpoint | Method | Description | Parameters |
|----------|--------|-------------|------------|
| `/api/process-batch/:batchNumber` | POST | Process a batch | `batchNumber` |
| `/api/submit-hashroot/:batchNumber` | POST | Submit a hashroot | `batchNumber`, `hashroot` |
| `/api/proof/:batchNumber/:requestID` | GET | Generate Merkle proof | `batchNumber`, `requestID` |
| `/api/batches/:batchNumber/votes` | GET | Get hashroot votes for a batch | `batchNumber` |

### Client Libraries

For the most up-to-date API reference, see the TypeScript client library:

```typescript
import {
  UniCityAnchorClient,
  AggregatorGatewayClient,
  AggregatorNodeClient,
  EventType
} from '@unicity-anchor/ts-client';
```

Key client classes and their methods:

1. **UniCityAnchorClient** - Base client for contract interaction
2. **AggregatorGatewayClient** - Gateway for collecting commitments
3. **AggregatorNodeClient** - Node for processing batches

---

## 9. Swagger Documentation and JSON-RPC API

The Ethereum Unicity Anchor gateway includes interactive Swagger documentation that makes it easier for developers to understand and test the API.

### 9.1 Accessing Swagger Documentation

When running a gateway, the Swagger documentation is available at:

```
http://{gateway-host}/swagger
```

For example, if your gateway is running on localhost at port 3000, the Swagger documentation would be available at `http://localhost:3000/swagger`.

### 9.2 Using the Swagger UI

The Swagger UI provides:

1. **Interactive API Documentation**: Comprehensive documentation for all API endpoints
2. **Request/Response Examples**: Sample payloads and responses for each endpoint
3. **Try It Out Feature**: Test API calls directly from the browser
4. **Schema Definitions**: Complete data models used by the API

### 9.3 Running the Swagger Server

You can run the Swagger documentation server independently:

```bash
# From the ts-client directory
npm run swagger

# Or specify a custom port
npm run swagger -- 8080
```

### 9.4 JSON-RPC API Reference

The gateway's JSON-RPC API provides a standard interface for interacting with the Ethereum Unicity Anchor system. Key endpoints include:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/submitCommitment` | POST | Submit a single commitment |
| `/submitMultipleCommitments` | POST | Submit multiple commitments in one transaction |
| `/submitBatch` | POST | Submit commitments and create a batch in one transaction |
| `/submitBatchWithNumber` | POST | Submit commitments and create a batch with explicit number |
| `/getInclusionProof/{requestId}` | GET | Get inclusion proof for a commitment |

For comprehensive documentation on the JSON-RPC API, refer to the [Gateway JSON-RPC Guide](GATEWAY_JSON_RPC_GUIDE.md).

## Conclusion

The Ethereum Unicity Anchor system provides a robust framework for processing commitment requests with guaranteed consistency across multiple trusted aggregators. By following this integration guide, development and QA teams can successfully deploy and maintain production-ready aggregator gateways and nodes.

For additional information, refer to the following resources:

- [Deployment Guide](DEPLOYMENT.md) - Instructions for deploying the smart contract
- [Implementation Guide](IMPLEMENTATION_GUIDE.md) - Detailed implementation examples
- [Specification](SPECIFICATION.md) - Complete technical specification
- [Testing Guide](TESTING.md) - Comprehensive test procedures
- [Aggregator Gateway Guide](AGGREGATOR_GATEWAY_GUIDE.md) - Comprehensive guide for using the Aggregator Gateway
- [Gateway JSON-RPC Guide](GATEWAY_JSON_RPC_GUIDE.md) - Detailed guide for using the JSON-RPC API

For questions, feedback, or support, contact the core development team.