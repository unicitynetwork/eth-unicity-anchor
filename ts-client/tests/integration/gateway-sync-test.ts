import { ethers } from 'ethers';
import { UniCityAnchorClient } from '../../src/client';
import { AggregatorGatewayClient } from '../../src/aggregator-gateway';
import { AggregatorNodeClient } from '../../src/aggregator-node';
import { SMTAggregatorNodeClient } from '../../src/aggregator-node-smt';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { bytesToHex, hexToBytes } from '../../src/utils';

// This test focuses on SMT synchronization and startup behavior
describe('Gateway SMT Synchronization Tests', () => {
  // Test constants
  const RPC_URL = 'http://localhost:8545';
  let contractAddress: string;
  let owner: ethers.Wallet;              // Contract owner/deployer
  let userWallet: ethers.Wallet;         // Used for gateway operations
  let aggregator1Wallet: ethers.Wallet;  // First aggregator
  let aggregator2Wallet: ethers.Wallet;  // Second aggregator
  let aggregator3Wallet: ethers.Wallet;  // Third aggregator (used for mismatch test)
  let provider: ethers.JsonRpcProvider;
  
  // Client instances
  let baseClient: UniCityAnchorClient;
  let gatewayClient: AggregatorGatewayClient;
  let aggregator1: SMTAggregatorNodeClient;
  let aggregator2: AggregatorNodeClient;
  let aggregator3: AggregatorNodeClient; // Will be used to create hashroot mismatches
  
  // Tracking variables for batch verification
  const processedBatches: Map<string, string> = new Map(); // batchNumber => hashroot
  const createdCommitments: any[] = []; // Keep track of created commitments
  
  // Custom hashroot calculator for verification purposes
  async function calculateHashroot(requests: any[]): Promise<string> {
    // Create leaf nodes for the Merkle Tree
    const leaves: [string, string][] = [];
    
    // Add all commitments as leaves
    for (const request of requests) {
      const key = request.requestID;
      const value = bytesToHex(
        ethers.concat([hexToBytes(request.payload), hexToBytes(request.authenticator)]),
      );
      
      leaves.push([key, value]);
    }
    
    // Create the Merkle Tree
    const smt = StandardMerkleTree.of(leaves, ['string', 'string']);
    
    // Get the SMT root
    const root = smt.root;
    return root;
  }
  
  // Helper to create a tampered hashroot (for mismatch testing)
  function createTamperedHashroot(originalHashroot: string): string {
    // Create a slightly modified version of the hashroot
    const bytes = hexToBytes(originalHashroot);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] + 1) % 256; // Modify the last byte
    return bytesToHex(bytes);
  }
  
  beforeAll(async () => {
    // Set up Jest timeout to handle blockchain transactions
    jest.setTimeout(120000);
    
    // Read the contract address from environment variable
    contractAddress = process.env.CONTRACT_ADDRESS || '';
    if (!contractAddress) {
      console.warn('CONTRACT_ADDRESS not set, tests will be skipped');
      return;
    }
    
    // Setup provider and wallets
    provider = new ethers.JsonRpcProvider(RPC_URL);
    
    // Use the default Anvil accounts
    owner = new ethers.Wallet(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // First Anvil account private key
      provider
    );
    
    userWallet = new ethers.Wallet(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // Second Anvil account private key
      provider
    );
    
    aggregator1Wallet = new ethers.Wallet(
      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // Third Anvil account private key
      provider
    );
    
    aggregator2Wallet = new ethers.Wallet(
      '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // Fourth Anvil account private key
      provider
    );
    
    aggregator3Wallet = new ethers.Wallet(
      '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', // Fifth Anvil account private key
      provider
    );
    
    // Initialize clients
    if (contractAddress) {
      // Get the correct ABI (using the global helper from setup)
      const abi = (global as any).getContractABI();
      console.log(`Using ABI with ${abi.length} entries for contract initialization`);
      
      // Create base client for admin operations
      baseClient = new UniCityAnchorClient({
        contractAddress,
        provider: provider,
        signer: owner,
        abi
      });
      
      // Gateway client for creating batches
      gatewayClient = new AggregatorGatewayClient({
        contractAddress,
        provider: provider,
        signer: userWallet,
        gatewayAddress: userWallet.address,
        abi,
        // Disable auto batch creation to control the test flow
        autoCreateBatches: false
      });
      
      // First aggregator - SMT-based
      aggregator1 = new SMTAggregatorNodeClient({
        contractAddress,
        provider: provider,
        signer: aggregator1Wallet,
        aggregatorAddress: aggregator1Wallet.address,
        smtDepth: 32,
        abi,
        // Disable auto processing to control the test flow
        autoProcessing: 0
      });
      
      // Second aggregator - Standard (non-SMT) implementation
      aggregator2 = new AggregatorNodeClient({
        contractAddress,
        provider: provider,
        signer: aggregator2Wallet,
        aggregatorAddress: aggregator2Wallet.address,
        smtDepth: 32,
        abi,
        // Disable auto processing to control the test flow
        autoProcessing: 0
      });
      
      // Third aggregator - Used for creating hashroot mismatches
      aggregator3 = new AggregatorNodeClient({
        contractAddress,
        provider: provider,
        signer: aggregator3Wallet,
        aggregatorAddress: aggregator3Wallet.address,
        smtDepth: 32,
        abi,
        // Disable auto processing
        autoProcessing: 0
      });
      
      // Add all aggregators to the contract
      console.log(`Setting up aggregators for testing...`);
      try {
        // Set required votes to 1 to make tests faster
        await baseClient.updateRequiredVotes(1);
        console.log('Set required votes to 1 for testing');
        
        // Register all aggregators
        await baseClient.addAggregator(aggregator1Wallet.address);
        await baseClient.addAggregator(aggregator2Wallet.address);
        await baseClient.addAggregator(aggregator3Wallet.address);
        console.log('All aggregators registered successfully');
      } catch (error) {
        console.log('Error setting up aggregators:', error);
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
  
  // Helper function to submit commitments and create batches
  async function createBatchWithCommitments(count: number): Promise<{batchNumber: bigint, requests: any[]}> {
    // Create commitments
    const commitments = [];
    for (let i = 0; i < count; i++) {
      const requestId = BigInt(Date.now() + i);
      const payload = ethers.toUtf8Bytes(`sync-test-payload-${Date.now()}-${i}`);
      const authenticator = ethers.toUtf8Bytes(`sync-test-auth-${Date.now()}-${i}`);
      
      commitments.push({
        requestID: requestId,
        payload,
        authenticator
      });
    }
    
    console.log(`Submitting ${count} commitments and creating a batch...`);
    const { batchNumber, successCount, result } = await gatewayClient.submitAndCreateBatch(commitments);
    
    // Convert payload and authenticator to hex for easier tracking
    const requestsAsHex = commitments.map(c => ({
      requestID: c.requestID.toString(),
      payload: ethers.hexlify(c.payload),
      authenticator: ethers.hexlify(c.authenticator)
    }));
    
    createdCommitments.push(...requestsAsHex);
    
    console.log(`Created batch #${batchNumber} with ${successCount} commitments`);
    return { batchNumber, requests: requestsAsHex };
  }
  
  // Test 1: Create and process initial batches to set up data for sync tests
  it('should create and process multiple batches to prepare test data', async () => {
    if (!contractAddress) {
      console.log('Skipping test due to missing CONTRACT_ADDRESS');
      return;
    }
    
    // Create 3 batches with 5 commitments each
    console.log('Creating initial test data: 3 batches with 5 commitments each');
    
    // Create and process batch 1
    const { batchNumber: batch1, requests: requests1 } = await createBatchWithCommitments(5);
    // Process it with aggregator 1
    console.log(`Processing batch #${batch1} with aggregator 1...`);
    const result1 = await aggregator1.processBatch(batch1);
    expect(result1.success).toBe(true);
    console.log(`Batch #${batch1} processed successfully`);
    
    // Store the hashroot for verification
    const batchInfo1 = await baseClient.getBatch(batch1);
    processedBatches.set(batch1.toString(), batchInfo1.hashroot);
    console.log(`Batch #${batch1} hashroot: ${batchInfo1.hashroot}`);
    
    // Create and process batch 2
    const { batchNumber: batch2, requests: requests2 } = await createBatchWithCommitments(5);
    // Process it with aggregator 2
    console.log(`Processing batch #${batch2} with aggregator 2...`);
    const result2 = await aggregator2.processBatch(batch2);
    expect(result2.success).toBe(true);
    console.log(`Batch #${batch2} processed successfully`);
    
    // Store the hashroot for verification
    const batchInfo2 = await baseClient.getBatch(batch2);
    processedBatches.set(batch2.toString(), batchInfo2.hashroot);
    console.log(`Batch #${batch2} hashroot: ${batchInfo2.hashroot}`);
    
    // Create batch 3, but process it with a tampered hashroot
    const { batchNumber: batch3, requests: requests3 } = await createBatchWithCommitments(5);
    // Calculate the correct hashroot for verification
    const correctHashroot = await calculateHashroot(requests3);
    // Create a tampered hashroot
    const tamperedHashroot = createTamperedHashroot(correctHashroot);
    
    // Get direct access to the contract for tampered submission
    const contract = (aggregator3 as any).contract;
    
    // Submit the tampered hashroot
    console.log(`Submitting tampered hashroot for batch #${batch3}...`);
    await contract.submitHashroot(batch3, hexToBytes(tamperedHashroot));
    
    // Store the tampered hashroot for verification
    processedBatches.set(batch3.toString(), tamperedHashroot);
    console.log(`Batch #${batch3} tampered hashroot: ${tamperedHashroot}`);
    console.log(`Batch #${batch3} correct hashroot: ${correctHashroot}`);
    
    // Verify we have 3 batches processed
    const latestProcessed = await baseClient.getLatestProcessedBatchNumber();
    expect(latestProcessed).toBe(batch3);
    console.log(`Test data prepared: ${latestProcessed} batches processed`);
  }, 60000);
  
  // Test 2: Test synchronization of a new gateway instance with existing on-chain data
  it('should correctly synchronize a new gateway with existing on-chain data', async () => {
    if (!contractAddress) {
      console.log('Skipping test due to missing CONTRACT_ADDRESS');
      return;
    }
    if (processedBatches.size === 0) {
      console.log('Skipping test because no batches were processed in the previous test');
      return;
    }
    
    console.log('Testing new gateway instance synchronization...');
    
    // Create a new gateway with autoProcessing enabled to trigger sync
    const newAggregator = new AggregatorNodeClient({
      contractAddress,
      provider: provider,
      signer: aggregator1Wallet, // Reuse first aggregator wallet
      aggregatorAddress: aggregator1Wallet.address,
      smtDepth: 32,
      abi: (global as any).getContractABI(),
      // Enable auto-sync but disable auto processing
      autoProcessing: 0
    });
    
    // Manually trigger sync to make it easily observable
    console.log('Triggering manual synchronization...');
    await newAggregator.syncWithOnChainState();
    
    // Verify we've processed all batches by checking the processed batches set
    // Access the private property for testing purposes
    const processedBatchesSet = (newAggregator as any).processedBatches;
    
    // Verify each batch is processed
    for (const [batchNumber, hashroot] of processedBatches.entries()) {
      expect(processedBatchesSet.has(batchNumber)).toBe(true);
      console.log(`Verified batch #${batchNumber} is marked as processed in new gateway instance`);
    }
    
    console.log('New gateway successfully synchronized with on-chain data');
  }, 30000);
  
  // Test 3: Test automatic processing of new batches
  it('should automatically process new unprocessed batches', async () => {
    if (!contractAddress) {
      console.log('Skipping test due to missing CONTRACT_ADDRESS');
      return;
    }
    
    console.log('Testing automatic processing of new batches...');
    
    // Create a new aggregator with autoProcessing enabled
    const autoProcessAggregator = new AggregatorNodeClient({
      contractAddress,
      provider: provider,
      signer: aggregator2Wallet, // Reuse second aggregator wallet
      aggregatorAddress: aggregator2Wallet.address,
      smtDepth: 32,
      abi: (global as any).getContractABI(),
      // Set a short interval for quick testing (1 second)
      autoProcessing: 1
    });
    
    // Track the latest processed batch before our test
    const previousLatestProcessed = await baseClient.getLatestProcessedBatchNumber();
    console.log(`Latest processed batch before test: ${previousLatestProcessed}`);
    
    // Create a new batch
    const { batchNumber: newBatch } = await createBatchWithCommitments(3);
    console.log(`Created new batch #${newBatch} for autoprocessing test`);
    
    // Wait for auto processing to happen (give it a few seconds)
    console.log('Waiting for automatic batch processing...');
    await new Promise(r => setTimeout(r, 5000));
    
    // Verify the batch got processed
    const batchInfo = await baseClient.getBatch(newBatch);
    console.log(`Batch #${newBatch} processed status: ${batchInfo.processed}`);
    expect(batchInfo.processed).toBe(true);
    
    // Clean up by stopping auto processing
    autoProcessAggregator.stopAutoBatchProcessing();
    console.log('Automatic batch processing verified and stopped');
  }, 30000);
  
  // Test 4: Test handling of hashroot mismatches
  it('should correctly handle hashroot mismatches during synchronization', async () => {
    if (!contractAddress) {
      console.log('Skipping test due to missing CONTRACT_ADDRESS');
      return;
    }
    if (processedBatches.size === 0) {
      console.log('Skipping test because no batches were processed in the setup test');
      return;
    }
    
    console.log('Testing handling of hashroot mismatches...');
    
    // Get the batch with the tampered hashroot (should be batch 3)
    const tamperedBatchNumber = '3';
    if (!processedBatches.has(tamperedBatchNumber)) {
      console.log(`No tampered batch found with number ${tamperedBatchNumber}, skipping test`);
      return;
    }
    
    // Create a new gateway instance that will detect the mismatch
    const mismatchDetector = new SMTAggregatorNodeClient({
      contractAddress,
      provider: provider,
      signer: aggregator1Wallet,
      aggregatorAddress: aggregator1Wallet.address,
      smtDepth: 32,
      abi: (global as any).getContractABI(),
      // Disable auto processing
      autoProcessing: 0
    });
    
    // Create a spy to capture console.warn calls
    const originalWarn = console.warn;
    const warnMock = jest.fn();
    console.warn = warnMock;
    
    try {
      // Manually trigger sync
      console.log('Triggering synchronization to detect hashroot mismatch...');
      await mismatchDetector.syncWithOnChainState();
      
      // Check if we detected the mismatch
      const mismatchWarningCalled = warnMock.mock.calls.some(call => 
        call[0].includes('Batch 3 hashroot mismatch') || 
        call[0].includes('hashroot mismatch')
      );
      
      expect(mismatchWarningCalled).toBe(true);
      console.log('Successfully detected hashroot mismatch during synchronization');
      
      // Verify the tampered batch is still marked as processed
      const processedBatchesSet = (mismatchDetector as any).processedBatches;
      expect(processedBatchesSet.has(tamperedBatchNumber)).toBe(true);
      console.log('Tampered batch is correctly marked as processed despite mismatch');
    } finally {
      // Restore console.warn
      console.warn = originalWarn;
    }
  }, 30000);
  
  // Test 5: Test robustness with concurrent gateway instances
  it('should handle concurrent batch processing with multiple gateways', async () => {
    if (!contractAddress) {
      console.log('Skipping test due to missing CONTRACT_ADDRESS');
      return;
    }
    
    console.log('Testing concurrent batch processing with multiple gateways...');
    
    // Create two new aggregator instances to compete for batch processing
    const aggregatorA = new AggregatorNodeClient({
      contractAddress,
      provider: provider,
      signer: aggregator1Wallet,
      aggregatorAddress: aggregator1Wallet.address,
      smtDepth: 32,
      abi: (global as any).getContractABI(),
      // Disable auto processing
      autoProcessing: 0
    });
    
    const aggregatorB = new AggregatorNodeClient({
      contractAddress,
      provider: provider,
      signer: aggregator2Wallet,
      aggregatorAddress: aggregator2Wallet.address,
      smtDepth: 32,
      abi: (global as any).getContractABI(),
      // Disable auto processing
      autoProcessing: 0
    });
    
    // Create a new batch to process
    const { batchNumber: concurrentBatch } = await createBatchWithCommitments(3);
    console.log(`Created batch #${concurrentBatch} for concurrent processing test`);
    
    // Process the batch with both aggregators concurrently
    console.log('Processing batch concurrently from two aggregator instances...');
    const [resultA, resultB] = await Promise.all([
      aggregatorA.processBatch(concurrentBatch),
      aggregatorB.processBatch(concurrentBatch)
    ]);
    
    // One should succeed and one should handle the "already processed" case
    const oneSucceeded = resultA.success || resultB.success;
    const oneHandledAlreadyProcessed = 
      (resultA.success === false && resultA.message?.includes('already processed')) ||
      (resultB.success === false && resultB.message?.includes('already processed'));
    
    // If both are false, something is wrong with our test
    if (!oneSucceeded) {
      console.log('Both aggregators failed to process:', { resultA, resultB });
    }
    
    expect(oneSucceeded).toBe(true);
    
    // Verify the batch is processed on-chain
    const batchInfo = await baseClient.getBatch(concurrentBatch);
    expect(batchInfo.processed).toBe(true);
    
    console.log('Concurrent batch processing handled correctly');
  }, 30000);
});