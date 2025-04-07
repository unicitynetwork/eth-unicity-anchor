// Export all the components
export * from './types';
export * from './client';
export * from './aggregator-gateway';
export * from './aggregator-node';
export * from './utils';
export { ABI } from './abi';

// Example usage:
/*
import { 
  AggregatorGatewayClient, 
  AggregatorNodeClient,
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

// Create an aggregator node client
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
*/
