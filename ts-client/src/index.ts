// Export all the components
export * from './types';
export * from './client';
export * from './aggregator-gateway';
export * from './aggregator-node';
export * from './aggregator-node-smt';
export * from './utils';
export { ABI } from './abi';

// Export gateway types
export * from './gateway-types/DataHash';
export * from './gateway-types/RequestId';
export * from './gateway-types/Authenticator';
export * from './gateway-types/Commitment';
export * from './gateway-types/InclusionProof';

// Example usage:
/*
import { 
  AggregatorGatewayClient, 
  AggregatorNodeClient,
  SMTAggregatorNodeClient,
  generateRandomRequestId
} from 'eth-unicity-anchor-client';

// Create a gateway client
const gateway = new AggregatorGatewayClient({
  providerUrl: 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY',
  contractAddress: '0x1234567890123456789012345678901234567890',
  privateKey: 'YOUR_PRIVATE_KEY',
  gatewayAddress: '0xYOUR_GATEWAY_ADDRESS',
  autoCreateBatches: true
});

// Submit a commitment
const requestId = generateRandomRequestId();
const result = await gateway.submitCommitment(
  requestId,
  new TextEncoder().encode('Example payload'),
  new TextEncoder().encode('Example authenticator')
);

// Create a batch
const { batchNumber } = await gateway.createBatch();

// Create a standard aggregator node client
const aggregator = new AggregatorNodeClient({
  providerUrl: 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY',
  contractAddress: '0x1234567890123456789012345678901234567890',
  privateKey: 'YOUR_PRIVATE_KEY',
  aggregatorAddress: '0xYOUR_AGGREGATOR_ADDRESS',
  smtDepth: 32,
  autoProcessBatches: true
});

// Process a batch
await aggregator.processBatch(batchNumber);

// Example using the SMT-based aggregator node client
const smtAggregator = new SMTAggregatorNodeClient({
  providerUrl: 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY',
  contractAddress: '0x1234567890123456789012345678901234567890',
  privateKey: 'YOUR_PRIVATE_KEY',
  aggregatorAddress: '0xYOUR_AGGREGATOR_ADDRESS',
  smtDepth: 32 // Optional: depth of the Sparse Merkle Tree (defaults to 32)
});

// Process a batch using Sparse Merkle Tree for hashroot generation
await smtAggregator.processBatch(batchNumber);

// Process all unprocessed batches
await smtAggregator.processAllUnprocessedBatches();

// Note: The SMT-based aggregator client uses the Sparse Merkle Tree from the
// @unicitylabs/commons package to generate hashroots for batches. This provides
// cryptographic proofs that can be verified on-chain or off-chain.
*/
