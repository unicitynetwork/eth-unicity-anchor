import { ethers } from 'ethers';
import { EthUnicityClient } from '../../src/client';
import { AggregatorGatewayClient } from '../../src/aggregator-gateway';
import { AggregatorNodeClient } from '../../src/aggregator-node';

// This test assumes a local Hardhat node is running with the contract deployed
describe('End-to-End Integration Tests', () => {
  // Test constants
  const RPC_URL = 'http://localhost:8545';
  let contractAddress: string;
  let userWallet: ethers.Wallet;
  let aggregatorWallet: ethers.Wallet;
  let provider: ethers.JsonRpcProvider;
  
  // Client instances
  let gatewayClient: AggregatorGatewayClient;
  let nodeClient: AggregatorNodeClient;
  
  beforeAll(async () => {
    // Read the contract address from a file or environment variable
    // For now, we'll hardcode it (you'll need to update this after deployment)
    contractAddress = process.env.CONTRACT_ADDRESS || '';
    if (!contractAddress) {
      console.warn('CONTRACT_ADDRESS not set, some tests will be skipped');
    }
    
    // Setup provider and wallets
    provider = new ethers.JsonRpcProvider(RPC_URL);
    
    // Use the default Hardhat accounts
    const signers = await provider.listAccounts();
    userWallet = new ethers.Wallet(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // First Hardhat account private key
      provider
    );
    aggregatorWallet = new ethers.Wallet(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // Second Hardhat account private key
      provider
    );
    
    // Initialize clients
    if (contractAddress) {
      const baseClient = new EthUnicityClient({
        contractAddress,
        provider: RPC_URL,
        signer: userWallet
      });
      
      gatewayClient = new AggregatorGatewayClient({
        contractAddress,
        provider: RPC_URL,
        signer: userWallet
      });
      
      nodeClient = new AggregatorNodeClient({
        contractAddress,
        provider: RPC_URL,
        signer: aggregatorWallet
      });
    }
  });
  
  // Skip all tests if contract address is not available
  const conditionalTest = contractAddress ? it : it.skip;
  
  conditionalTest('should submit a commitment and create a batch', async () => {
    // First, the aggregator wallet needs to be added as an aggregator
    const baseClient = new EthUnicityClient({
      contractAddress,
      provider: RPC_URL,
      signer: userWallet
    });
    
    // Add the aggregator (assuming the user is the owner)
    await baseClient.addAggregator(aggregatorWallet.address);
    
    // Submit a commitment
    const requestId = Date.now();
    const payload = ethers.toUtf8Bytes('test payload');
    const authenticator = ethers.toUtf8Bytes('test authenticator');
    
    await gatewayClient.submitCommitment(requestId, payload, authenticator);
    
    // Create a batch
    const batchNumber = await nodeClient.createBatch();
    
    // Get batch info
    const batchInfo = await nodeClient.getBatch(batchNumber);
    
    // Expect the batch to contain our request
    expect(batchInfo.requests.length).toBeGreaterThan(0);
    expect(batchInfo.processed).toBe(false);
    
    // Submit a hashroot
    const hashroot = ethers.toUtf8Bytes('test hashroot');
    await nodeClient.submitHashroot(batchNumber, hashroot);
    
    // Check if the batch is now processed
    const updatedBatchInfo = await nodeClient.getBatch(batchNumber);
    expect(updatedBatchInfo.processed).toBe(true);
    expect(updatedBatchInfo.hashroot).toEqual(hashroot);
  }, 30000); // Set a longer timeout for this test
  
  conditionalTest('should handle batch retrieval and status correctly', async () => {
    if (!gatewayClient || !nodeClient) return;
    
    // Get latest batch numbers
    const latestBatchNumber = await nodeClient.getLatestBatchNumber();
    const latestProcessedBatchNumber = await nodeClient.getLatestProcessedBatchNumber();
    
    expect(latestBatchNumber).toBeGreaterThanOrEqual(0);
    expect(latestProcessedBatchNumber).toBeGreaterThanOrEqual(0);
    
    // Try to get latest unprocessed batch
    try {
      const unprocessedBatch = await nodeClient.getLatestUnprocessedBatch();
      // If we get here, there is an unprocessed batch
      expect(unprocessedBatch.batchNumber).toBeGreaterThan(0);
    } catch (error) {
      // It's okay if there are no unprocessed batches
      console.log('No unprocessed batches found');
    }
  });
});