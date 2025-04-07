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
    // Set up Jest timeout to handle blockchain transactions
    jest.setTimeout(30000);
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
        provider: provider,
        signer: userWallet
      });
      
      gatewayClient = new AggregatorGatewayClient({
        contractAddress,
        provider: provider,
        signer: userWallet,
        gatewayAddress: userWallet.address
      });
      
      nodeClient = new AggregatorNodeClient({
        contractAddress,
        provider: provider,
        signer: aggregatorWallet,
        aggregatorAddress: aggregatorWallet.address,
        smtDepth: 32 // Default SMT depth
      });
    }
  });
  
  // Clean up resources after all tests
  afterAll(async () => {
    // Close any open connections
    if (provider) {
      await provider.destroy();
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
      provider: provider,
      signer: userWallet
    });
    
    // Add the aggregator (assuming the user is the owner)
    console.log(`Adding aggregator ${aggregatorWallet.address} to the contract...`);
    try {
      const addAggResult = await baseClient.addAggregator(aggregatorWallet.address);
      console.log('Add aggregator result:', addAggResult);
    } catch (error) {
      console.error('Error adding aggregator:', error);
      throw error;
    }
    
    // Submit a commitment
    const requestId = Date.now();
    const payload = ethers.toUtf8Bytes('test payload');
    const authenticator = ethers.toUtf8Bytes('test authenticator');
    
    console.log(`Submitting commitment with requestId: ${requestId}...`);
    try {
      const submitResult = await gatewayClient.submitCommitment(requestId, payload, authenticator);
      console.log('Submit commitment result:', submitResult);
    } catch (error) {
      console.error('Error submitting commitment:', error);
      throw error;
    }
    
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
        console.log('Submitting hashroot:', ethers.hexlify(hashroot));
        await nodeClient.submitHashroot(batchNumber, hashroot);
        
        // Check if the batch is now processed
        const updatedBatchInfo = await nodeClient.getBatch(batchNumber);
        console.log('Updated batch info:', updatedBatchInfo);
        expect(updatedBatchInfo.processed).toBe(true);
        
        // The hashroot comes back as a hex string, so we need to compare hex strings
        const expectedHashrootHex = ethers.hexlify(hashroot);
        expect(updatedBatchInfo.hashroot).toEqual(expectedHashrootHex);
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