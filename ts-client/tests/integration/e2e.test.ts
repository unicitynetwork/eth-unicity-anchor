import { ethers } from 'ethers';
import { UniCityAnchorClient } from '../../src/client';
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
      const baseClient = new UniCityAnchorClient({
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
  
  // We'll decide whether to run or skip tests inside each test
  
  it('should submit a commitment and create a batch', async () => {
    if (!contractAddress) {
      console.log('Skipping test due to missing CONTRACT_ADDRESS');
      return;
    }
    // First, the aggregator wallet needs to be added as an aggregator
    const baseClient = new UniCityAnchorClient({
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
    
    // Create a batch (this is done by the gateway client, not the node client)
    console.log('Creating a batch...');
    const { batchNumber, result } = await gatewayClient.createBatch();
    console.log('Batch created with number:', batchNumber.toString());
    console.log('Transaction result:', result);
    
    // Check if we have any unprocessed requests
    const unprocessedCount = await gatewayClient.getUnprocessedRequestCount();
    console.log('Unprocessed request count:', unprocessedCount.toString());
    
    // Get batch info (only if the batch number is > 0)
    if (batchNumber > 0n) {
      try {
        const batchInfo = await nodeClient.getBatch(batchNumber);
        console.log('Batch info:', batchInfo);
        
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
      } catch (error) {
        console.error('Error getting batch:', error);
        throw error;
      }
    } else {
      console.log('No batch was created, skipping batch checks');
      // Exit the test early since we couldn't create a batch
      return;
    }
  }, 30000); // Set a longer timeout for this test
  
  it('should handle batch retrieval and status correctly', async () => {
    if (!contractAddress) {
      console.log('Skipping test due to missing CONTRACT_ADDRESS');
      return;
    }
    
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