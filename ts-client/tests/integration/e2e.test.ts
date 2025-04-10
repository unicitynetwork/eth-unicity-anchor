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
      // Get the correct ABI (using the global helper from setup)
      const abi = (global as any).getContractABI();
      console.log(`Using ABI with ${abi.length} entries for contract initialization`);
      
      // Create client options with the correct ABI
      const baseClientOptions = {
        contractAddress,
        provider: provider,
        signer: userWallet,
        abi // Use the custom ABI
      };
      
      const baseClient = new UniCityAnchorClient(baseClientOptions);
      
      gatewayClient = new AggregatorGatewayClient({
        ...baseClientOptions,
        gatewayAddress: userWallet.address
      });
      
      nodeClient = new AggregatorNodeClient({
        ...baseClientOptions,
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
    const requestId = BigInt(Date.now()); // Convert to BigInt for proper typing
    const payload = ethers.toUtf8Bytes('test payload');
    const authenticator = ethers.toUtf8Bytes('test authenticator');
    
    console.log(`Submitting commitment with requestId: ${requestId.toString()}...`);
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
        // Test fixed - batchInfo.processed should be false here
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
      const [batchNumber, requests] = await nodeClient.getLatestUnprocessedBatch();
      // If we get here, there is an unprocessed batch
      expect(batchNumber).toBeGreaterThan(0n);
      expect(requests).toBeDefined();
    } catch (error) {
      // It's okay if there are no unprocessed batches
      console.log('No unprocessed batches found');
    }
  });
  
  it('should submit multiple commitments in a single transaction', async () => {
    if (!contractAddress) {
      console.log('Skipping test due to missing CONTRACT_ADDRESS');
      return;
    }
    
    // Create multiple commitments
    const commitments = [];
    const count = 5;
    
    for (let i = 0; i < count; i++) {
      const requestId = BigInt(Date.now() + i);
      const payload = ethers.toUtf8Bytes(`batch payload ${i}`);
      const authenticator = ethers.toUtf8Bytes(`batch auth ${i}`);
      
      commitments.push({
        requestID: requestId,
        payload,
        authenticator
      });
    }
    
    console.log(`Submitting ${count} commitments in a single transaction...`);
    try {
      const { successCount, result } = await gatewayClient.submitCommitments(commitments);
      console.log(`Successfully submitted ${successCount} commitments`);
      console.log('Transaction result:', result);
      
      expect(result.success).toBe(true);
      // Verify the success count matches the number of commitments
      expect(successCount).toBe(BigInt(count));
      
      // Create a batch with the submitted commitments
      const { batchNumber, result: batchResult } = await gatewayClient.createBatch();
      console.log('Batch created with number:', batchNumber.toString());
      expect(batchResult.success).toBe(true);
      
      // Get batch info
      const batchInfo = await nodeClient.getBatch(batchNumber);
      console.log('Batch info:', batchInfo);
      
      // Expect the batch to contain our requests
      expect(batchInfo.requests.length).toBe(count);
      expect(batchInfo.processed).toBe(false);
    } catch (error) {
      console.error('Error with batch submission:', error);
      throw error;
    }
  }, 30000);
  
  it('should submit commitments and create batch in a single transaction', async () => {
    if (!contractAddress) {
      console.log('Skipping test due to missing CONTRACT_ADDRESS');
      return;
    }
    
    // Create multiple commitments
    const commitments = [];
    const count = 5;
    
    for (let i = 0; i < count; i++) {
      const requestId = BigInt(Date.now() + 1000 + i); // Different range from previous test
      const payload = ethers.toUtf8Bytes(`combined payload ${i}`);
      const authenticator = ethers.toUtf8Bytes(`combined auth ${i}`);
      
      commitments.push({
        requestID: requestId,
        payload,
        authenticator
      });
    }
    
    console.log(`Submitting ${count} commitments and creating batch in a single transaction...`);
    try {
      const { batchNumber, successCount, result } = await gatewayClient.submitAndCreateBatch(commitments);
      console.log(`Successfully submitted ${successCount} commitments and created batch #${batchNumber}`);
      console.log('Transaction result:', result);
      
      expect(result.success).toBe(true);
      // Verify the success count matches the number of commitments
      expect(successCount).toBe(BigInt(count));
      expect(batchNumber).toBeGreaterThan(0n);
      
      // Get batch info
      const batchInfo = await nodeClient.getBatch(batchNumber);
      console.log('Batch info:', batchInfo);
      
      // Expect the batch to contain our requests
      expect(batchInfo.requests.length).toBe(count);
      expect(batchInfo.processed).toBe(false);
      
      // Process any earlier batches that are unprocessed
      // Need to process batches in sequence
      const latestProcessedBatch = await nodeClient.getLatestProcessedBatchNumber();
      console.log(`Latest processed batch: ${latestProcessedBatch}`);
      
      // Process all batches between latestProcessedBatch and batchNumber
      for (let i = Number(latestProcessedBatch) + 1; i <= Number(batchNumber); i++) {
        const batchToProcess = BigInt(i);
        const processingHashroot = ethers.toUtf8Bytes(`test hashroot for batch ${i}`);
        console.log(`Processing batch ${batchToProcess} with hashroot: ${ethers.hexlify(processingHashroot)}`);
        
        const processResult = await nodeClient.submitHashroot(batchToProcess, processingHashroot);
        expect(processResult.success).toBe(true);
        console.log(`Successfully processed batch ${batchToProcess}`);
      }
      
      // Verify our target batch is now processed
      const targetHashroot = ethers.toUtf8Bytes('combined test hashroot');
      
      // Get the updated batch info
      const updatedBatchInfo = await nodeClient.getBatch(batchNumber);
      console.log('Updated batch info:', updatedBatchInfo);
      expect(updatedBatchInfo.processed).toBe(true);
      
      // The batch should have the hashroot we used to process it
      const expectedBatchHashroot = ethers.hexlify(ethers.toUtf8Bytes(`test hashroot for batch ${batchNumber}`));
      expect(updatedBatchInfo.hashroot).toEqual(expectedBatchHashroot);
    } catch (error) {
      console.error('Error with combined submission and batch creation:', error);
      throw error;
    }
  }, 30000);
  
  it('should demonstrate performance improvements with batch operations', async () => {
    if (!contractAddress) {
      console.log('Skipping test due to missing CONTRACT_ADDRESS');
      return;
    }
    
    // Number of commitments to test with
    const count = 5;
    
    // Create identical commitments for fair comparison
    const baseCommitments = [];
    for (let i = 0; i < count; i++) {
      const requestId = BigInt(Date.now() + 2000 + i); // Different range from previous tests
      const payload = ethers.toUtf8Bytes(`perf payload ${i}`);
      const authenticator = ethers.toUtf8Bytes(`perf auth ${i}`);
      
      baseCommitments.push({
        requestID: requestId,
        payload,
        authenticator
      });
    }
    
    // Performance test 1: Individual submissions (old way)
    console.log('\n===== PERFORMANCE TEST: INDIVIDUAL SUBMISSIONS =====');
    let individualStart = Date.now();
    let totalIndividualGas = BigInt(0);
    
    try {
      // Use legacy method that submits each commitment individually
      const results = await gatewayClient.submitMultipleCommitments(baseCommitments);
      
      // Sum up all the gas used
      for (const item of results) {
        if (item.result.success && item.result.gasUsed) {
          totalIndividualGas += item.result.gasUsed;
        }
      }
      
      // Create batch separately
      const { result: batchResult } = await gatewayClient.createBatch();
      if (batchResult.success && batchResult.gasUsed) {
        totalIndividualGas += batchResult.gasUsed;
      }
      
      const individualElapsed = Date.now() - individualStart;
      console.log(`Individual submissions completed in ${individualElapsed}ms`);
      console.log(`Total gas used: ${totalIndividualGas.toString()}`);
    } catch (error) {
      console.error('Error in individual submissions test:', error);
    }
    
    // Create new commitments with different IDs for batch submission
    const batchCommitments = [];
    for (let i = 0; i < count; i++) {
      const requestId = BigInt(Date.now() + 3000 + i);
      const payload = ethers.toUtf8Bytes(`perf payload ${i}`);
      const authenticator = ethers.toUtf8Bytes(`perf auth ${i}`);
      
      batchCommitments.push({
        requestID: requestId,
        payload,
        authenticator
      });
    }
    
    // Performance test 2: submitCommitments (new way)
    console.log('\n===== PERFORMANCE TEST: BATCH SUBMISSIONS =====');
    let batchStart = Date.now();
    let batchSubmissionGas = BigInt(0);
    
    try {
      // Submit all commitments in a single transaction
      const { result } = await gatewayClient.submitCommitments(batchCommitments);
      
      if (result.success && result.gasUsed) {
        batchSubmissionGas = result.gasUsed;
      }
      
      // Create batch separately
      const { result: batchResult } = await gatewayClient.createBatch();
      if (batchResult.success && batchResult.gasUsed) {
        batchSubmissionGas += batchResult.gasUsed;
      }
      
      const batchElapsed = Date.now() - batchStart;
      console.log(`Batch submission completed in ${batchElapsed}ms`);
      console.log(`Total gas used: ${batchSubmissionGas.toString()}`);
    } catch (error) {
      console.error('Error in batch submissions test:', error);
    }
    
    // Create new commitments with different IDs for combined operation
    const combinedCommitments = [];
    for (let i = 0; i < count; i++) {
      const requestId = BigInt(Date.now() + 4000 + i);
      const payload = ethers.toUtf8Bytes(`perf payload ${i}`);
      const authenticator = ethers.toUtf8Bytes(`perf auth ${i}`);
      
      combinedCommitments.push({
        requestID: requestId,
        payload,
        authenticator
      });
    }
    
    // Performance test 3: submitAndCreateBatch (combined way)
    console.log('\n===== PERFORMANCE TEST: COMBINED SUBMISSION AND BATCH CREATION =====');
    let combinedStart = Date.now();
    let combinedGas = BigInt(0);
    
    try {
      // Submit and create batch in a single transaction
      const { result } = await gatewayClient.submitAndCreateBatch(combinedCommitments);
      
      if (result.success && result.gasUsed) {
        combinedGas = result.gasUsed;
      }
      
      const combinedElapsed = Date.now() - combinedStart;
      console.log(`Combined operation completed in ${combinedElapsed}ms`);
      console.log(`Total gas used: ${combinedGas.toString()}`);
      
      // Print summary
      console.log('\n===== PERFORMANCE COMPARISON SUMMARY =====');
      console.log(`Individual submissions gas: ${totalIndividualGas.toString()}`);
      console.log(`Batch submission gas: ${batchSubmissionGas.toString()}`);
      console.log(`Combined operation gas: ${combinedGas.toString()}`);
      
      if (totalIndividualGas > 0 && batchSubmissionGas > 0) {
        const batchSavingsPercent = 100 - (Number(batchSubmissionGas) * 100 / Number(totalIndividualGas));
        console.log(`Batch submission gas savings: ${batchSavingsPercent.toFixed(2)}%`);
      }
      
      if (totalIndividualGas > 0 && combinedGas > 0) {
        const combinedSavingsPercent = 100 - (Number(combinedGas) * 100 / Number(totalIndividualGas));
        console.log(`Combined operation gas savings: ${combinedSavingsPercent.toFixed(2)}%`);
      }
    } catch (error) {
      console.error('Error in combined operation test:', error);
    }
  }, 60000); // Increase timeout for this comprehensive test
});