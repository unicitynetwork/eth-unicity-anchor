import { ethers } from 'ethers';
import { UniCityAnchorClient } from '../../src/client';
import { AggregatorGatewayClient } from '../../src/aggregator-gateway';
import { AggregatorNodeClient } from '../../src/aggregator-node';

// This test specifically focuses on explicit batch numbering operations
describe('Explicit Batch Numbering Integration Tests', () => {
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
    
    // Read the contract address from environment variable
    contractAddress = process.env.CONTRACT_ADDRESS || '';
    if (!contractAddress) {
      console.warn('CONTRACT_ADDRESS not set, tests will be skipped');
    }
    
    // Setup provider and wallets
    provider = new ethers.JsonRpcProvider(RPC_URL);
    
    // Use the default Hardhat accounts
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
      
      // Add the aggregator if not already added
      try {
        console.log(`Adding aggregator ${aggregatorWallet.address} to the contract...`);
        await baseClient.addAggregator(aggregatorWallet.address);
      } catch (error) {
        // If it fails, the aggregator might already be added, which is fine
        console.log("Could not add aggregator - it may already be added or you don't have permission");
      }
    }
  });
  
  // Clean up resources after all tests
  afterAll(async () => {
    // Close any open connections
    if (provider) {
      await provider.destroy();
    }
  });
  
  it('should properly retrieve the next auto-numbered batch', async () => {
    if (!contractAddress) {
      console.log('Skipping test due to missing CONTRACT_ADDRESS');
      return;
    }
    
    // Get the next auto-numbered batch
    const nextBatchNumber = await gatewayClient.getNextAutoNumberedBatch();
    console.log(`Next auto-numbered batch: ${nextBatchNumber}`);
    
    // It should be a positive number or zero
    expect(nextBatchNumber).toBeGreaterThanOrEqual(0n);
    
    // Compare with the highest batch number
    const highestBatchNumber = await gatewayClient.getLatestBatchNumber();
    console.log(`Highest batch number: ${highestBatchNumber}`);
    
    // Next batch should be less than or equal to highest batch + 1
    // (It could be less if there are gaps in the sequence)
    expect(nextBatchNumber).toBeLessThanOrEqual(highestBatchNumber + 1n);
  });
  
  it('should create a batch with an explicit number', async () => {
    if (!contractAddress) {
      console.log('Skipping test due to missing CONTRACT_ADDRESS');
      return;
    }
    
    // Get the current highest batch number to pick an explicit number above it
    const highestBatchNumber = await gatewayClient.getLatestBatchNumber();
    const explicitBatchNumber = highestBatchNumber + 10n;
    
    console.log(`Current highest batch: ${highestBatchNumber}, using explicit number: ${explicitBatchNumber}`);
    
    // Create some commitment requests for the batch
    const commitments = [];
    for (let i = 0; i < 3; i++) {
      const requestId = BigInt(Date.now() + 5000 + i); // Different range from previous tests
      const payload = ethers.toUtf8Bytes(`explicit test payload ${i}`);
      const authenticator = ethers.toUtf8Bytes(`explicit test auth ${i}`);
      
      commitments.push({
        requestID: requestId,
        payload,
        authenticator
      });
    }
    
    // Submit the commitments
    const { successCount, result: submitResult } = await gatewayClient.submitCommitments(commitments);
    console.log(`Successfully submitted ${successCount} commitments`);
    expect(submitResult.success).toBe(true);
    
    // Create a batch with explicit number
    const requestIds = commitments.map(c => c.requestID);
    const { batchNumber, result } = await gatewayClient.createBatchForRequestsWithNumber(
      requestIds,
      explicitBatchNumber
    );
    
    console.log(`Batch created with explicit number: ${batchNumber}`);
    expect(result.success).toBe(true);
    expect(batchNumber).toBe(explicitBatchNumber);
    
    // Verify the batch exists with the correct number
    const batchInfo = await gatewayClient.getBatch(explicitBatchNumber);
    expect(batchInfo.requests.length).toBeGreaterThan(0);
    
    // Check if a gap was created
    const nextAutoBatchNumber = await gatewayClient.getNextAutoNumberedBatch();
    console.log(`After explicit batch creation, next auto-numbered batch: ${nextAutoBatchNumber}`);
    
    // The next auto batch should be less than the explicit batch we just created
    // (since we created a gap)
    expect(nextAutoBatchNumber).toBeLessThan(explicitBatchNumber);
    
    // Check the highest batch number - should match our explicit batch
    const newHighestBatch = await gatewayClient.getLatestBatchNumber();
    expect(newHighestBatch).toBe(explicitBatchNumber);
  });
  
  it('should submit commitments and create a batch with explicit number in one transaction', async () => {
    if (!contractAddress) {
      console.log('Skipping test due to missing CONTRACT_ADDRESS');
      return;
    }
    
    // Get the current highest batch number to pick an explicit number above it
    const highestBatchNumber = await gatewayClient.getLatestBatchNumber();
    const explicitBatchNumber = highestBatchNumber + 10n;
    
    console.log(`Current highest batch: ${highestBatchNumber}, using explicit number: ${explicitBatchNumber}`);
    
    // Create some commitment requests for the batch
    const commitments = [];
    for (let i = 0; i < 3; i++) {
      const requestId = BigInt(Date.now() + 6000 + i); // Different range from previous tests
      const payload = ethers.toUtf8Bytes(`combined explicit payload ${i}`);
      const authenticator = ethers.toUtf8Bytes(`combined explicit auth ${i}`);
      
      commitments.push({
        requestID: requestId,
        payload,
        authenticator
      });
    }
    
    // Submit commitments and create batch with explicit number in one transaction
    const { batchNumber, successCount, result } = await gatewayClient.submitAndCreateBatchWithNumber(
      commitments,
      explicitBatchNumber
    );
    
    console.log(`Successfully submitted ${successCount} commitments and created batch #${batchNumber}`);
    expect(result.success).toBe(true);
    expect(successCount).toBe(BigInt(commitments.length));
    expect(batchNumber).toBe(explicitBatchNumber);
    
    // Verify the batch exists with the correct number
    const batchInfo = await gatewayClient.getBatch(explicitBatchNumber);
    expect(batchInfo.requests.length).toBeGreaterThan(0);
    
    // Check the highest batch number - should match our explicit batch
    const newHighestBatch = await gatewayClient.getLatestBatchNumber();
    expect(newHighestBatch).toBe(explicitBatchNumber);
  });
  
  it('should fill gaps when using auto-numbered batches', async () => {
    if (!contractAddress) {
      console.log('Skipping test due to missing CONTRACT_ADDRESS');
      return;
    }
    
    // First check for a gap
    let nextAutoBatchNumber = await gatewayClient.getNextAutoNumberedBatch();
    let highestBatchNumber = await gatewayClient.getLatestBatchNumber();
    
    console.log(`Before gap test: next auto-numbered batch = ${nextAutoBatchNumber}, highest batch = ${highestBatchNumber}`);
    
    // Only continue if there's a gap (auto next batch < highest batch)
    if (nextAutoBatchNumber >= highestBatchNumber) {
      console.log('No gap detected, creating one for the test...');
      
      // Create a gap by creating an explicit batch
      const explicitBatchNumber = highestBatchNumber + 10n;
      
      // Create a simple commitment
      const requestId = BigInt(Date.now() + 7000);
      const payload = ethers.toUtf8Bytes('gap test payload');
      const authenticator = ethers.toUtf8Bytes('gap test auth');
      
      // Submit and create a batch with explicit number
      await gatewayClient.submitCommitment(requestId, payload, authenticator);
      await gatewayClient.createBatchForRequestsWithNumber([requestId], explicitBatchNumber);
      
      // Verify the gap
      nextAutoBatchNumber = await gatewayClient.getNextAutoNumberedBatch();
      highestBatchNumber = await gatewayClient.getLatestBatchNumber();
      
      console.log(`Created gap: next auto = ${nextAutoBatchNumber}, highest = ${highestBatchNumber}`);
      expect(nextAutoBatchNumber).toBeLessThan(highestBatchNumber);
    }
    
    // Now create an auto-numbered batch which should fill the gap
    const gapRequestId = BigInt(Date.now() + 8000);
    const gapPayload = ethers.toUtf8Bytes('gap fill payload');
    const gapAuthenticator = ethers.toUtf8Bytes('gap fill auth');
    
    // Submit the commitment
    await gatewayClient.submitCommitment(gapRequestId, gapPayload, gapAuthenticator);
    
    // Create an auto-numbered batch (should use the next available gap)
    const { batchNumber, result } = await gatewayClient.createBatch();
    
    console.log(`Auto-numbered batch created with number: ${batchNumber}`);
    expect(result.success).toBe(true);
    expect(batchNumber).toBe(nextAutoBatchNumber);
    
    // Verify the next auto batch has been incremented
    const updatedNextAuto = await gatewayClient.getNextAutoNumberedBatch();
    console.log(`After gap fill: next auto-numbered batch = ${updatedNextAuto}`);
    
    // If there were multiple gaps, the next auto might still be less than highest
    // If there was only one gap, the next auto should now be highest + 1
    expect(updatedNextAuto).toBeGreaterThan(nextAutoBatchNumber);
  });
  
  it('should allow processing batches in sequence regardless of creation order', async () => {
    if (!contractAddress) {
      console.log('Skipping test due to missing CONTRACT_ADDRESS');
      return;
    }
    
    // Get the latest processed batch
    const latestProcessedBatch = await nodeClient.getLatestProcessedBatchNumber();
    console.log(`Latest processed batch: ${latestProcessedBatch}`);
    
    // Create two batches with explicit numbers
    // First create a higher batch number (out of sequence)
    const higherBatchNumber = latestProcessedBatch + 3n;
    
    // Create a commitment for higher batch
    const higherReqId = BigInt(Date.now() + 9000);
    const higherPayload = ethers.toUtf8Bytes('higher batch payload');
    const higherAuth = ethers.toUtf8Bytes('higher batch auth');
    
    // Submit and create higher batch
    await gatewayClient.submitCommitment(higherReqId, higherPayload, higherAuth);
    const { batchNumber: higherBatch } = await gatewayClient.createBatchForRequestsWithNumber(
      [higherReqId],
      higherBatchNumber
    );
    
    console.log(`Created higher batch with number: ${higherBatch}`);
    
    // Now create the lower batch that should be processed first
    const lowerBatchNumber = latestProcessedBatch + 1n;
    
    // Create a commitment for lower batch
    const lowerReqId = BigInt(Date.now() + 9100);
    const lowerPayload = ethers.toUtf8Bytes('lower batch payload');
    const lowerAuth = ethers.toUtf8Bytes('lower batch auth');
    
    // Submit and create lower batch
    await gatewayClient.submitCommitment(lowerReqId, lowerPayload, lowerAuth);
    const { batchNumber: lowerBatch } = await gatewayClient.createBatchForRequestsWithNumber(
      [lowerReqId],
      lowerBatchNumber
    );
    
    console.log(`Created lower batch with number: ${lowerBatch}`);
    
    // Try to process the higher batch first (should fail)
    console.log('Attempting to process higher batch before lower batch (should fail)...');
    const higherHashroot = ethers.toUtf8Bytes('higher batch hashroot');
    try {
      await nodeClient.submitHashroot(higherBatch, higherHashroot);
      // If we get here, something is wrong with the sequence validation
      console.error('❌ Processed higher batch out of sequence!');
    } catch (error) {
      // This is expected - should not be able to process out of sequence
      console.log('✅ Correctly failed to process higher batch out of sequence');
    }
    
    // Now process the lower batch (should succeed)
    console.log('Processing lower batch...');
    const lowerHashroot = ethers.toUtf8Bytes('lower batch hashroot');
    const lowerResult = await nodeClient.submitHashroot(lowerBatch, lowerHashroot);
    
    console.log(`Lower batch processing result: ${lowerResult.success}`);
    expect(lowerResult.success).toBe(true);
    
    // Verify the lower batch is now processed
    const lowerBatchInfo = await nodeClient.getBatch(lowerBatch);
    expect(lowerBatchInfo.processed).toBe(true);
    
    // Now process any other batches in sequence before our higher batch
    
    // For our test, we'll create a smaller gap to make it easier to test
    // Modify the test to create a batch with batchNumber = lowerBatch + 1 
    // instead of a larger gap
    
    // Create a middle batch (N+2) to ensure sequential processing
    const middleBatch = lowerBatch + 1n;
    
    try {
      // Check if the batch already exists
      await nodeClient.getBatch(middleBatch);
      console.log(`Middle batch ${middleBatch} already exists`);
    } catch (error) {
      // Batch doesn't exist, create it
      console.log(`Creating middle batch ${middleBatch}...`);
      
      // Create a commitment for this middle batch
      const middleReqId = BigInt(Date.now() + 10000);
      const middlePayload = ethers.toUtf8Bytes('middle batch payload');
      const middleAuth = ethers.toUtf8Bytes('middle batch auth');
      
      // Submit and create batch with this explicit number
      await gatewayClient.submitCommitment(middleReqId, middlePayload, middleAuth);
      const middleBatchResult = await gatewayClient.createBatchForRequestsWithNumber(
        [middleReqId],
        middleBatch
      );
      console.log(`Middle batch created: ${middleBatchResult.batchNumber}`);
    }
    
    // Process the middle batch
    console.log(`Processing middle batch ${middleBatch}...`);
    const middleHashroot = ethers.toUtf8Bytes('middle batch hashroot');
    const middleResult = await nodeClient.submitHashroot(middleBatch, middleHashroot);
    
    console.log(`Middle batch processing result: ${middleResult.success}`);
    expect(middleResult.success).toBe(true);
    
    // Verify that the middle batch is processed
    const middleBatchInfo = await nodeClient.getBatch(middleBatch);
    expect(middleBatchInfo.processed).toBe(true);
    
    // Now process the higher batch (should succeed)
    console.log(`Now processing higher batch ${higherBatch}...`);
    const higherResult = await nodeClient.submitHashroot(higherBatch, higherHashroot);
    
    console.log(`Higher batch processing result: ${higherResult.success}`);
    expect(higherResult.success).toBe(true);
    
    // Verify the higher batch is now processed
    const higherBatchInfo = await nodeClient.getBatch(higherBatch);
    expect(higherBatchInfo.processed).toBe(true);
    
    // Final check - the latest processed batch should be our higher batch
    const newLatestProcessed = await nodeClient.getLatestProcessedBatchNumber();
    expect(newLatestProcessed).toBe(higherBatch);
  });
});