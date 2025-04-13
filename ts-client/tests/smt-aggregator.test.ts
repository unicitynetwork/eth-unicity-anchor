import { ethers } from 'ethers';
import { SMTAggregatorNodeClient } from '../src/aggregator-node-smt';
import { AggregatorGatewayClient } from '../src/aggregator-gateway';
import { UniCityAnchorClient } from '../src/client';
import { SparseMerkleTree } from '@unicitylabs/commons/lib/smt/SparseMerkleTree.js';
import { HashAlgorithm } from '@unicitylabs/commons/lib/hash/HashAlgorithm.js';

// This test demonstrates how the SMT can be used by the aggregator node client
describe('SMT Aggregator Node Integration', () => {
  const RPC_URL = 'http://localhost:8545';
  let contractAddress: string;
  let userWallet: ethers.Wallet;
  let aggregatorWallet: ethers.Wallet;
  let provider: ethers.JsonRpcProvider;
  
  // Client instances
  let gatewayClient: AggregatorGatewayClient;
  let nodeClient: SMTAggregatorNodeClient;
  
  beforeAll(async () => {
    // Longer timeout for blockchain interactions
    jest.setTimeout(30000);
    
    // Skip tests if running in unit test environment
    contractAddress = process.env.CONTRACT_ADDRESS || '';
    if (!contractAddress) {
      console.warn('CONTRACT_ADDRESS not set, integration tests will be skipped');
      return;
    }
    
    // Setup provider and wallets
    provider = new ethers.JsonRpcProvider(RPC_URL);
    
    // Use default Hardhat accounts
    userWallet = new ethers.Wallet(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // First Hardhat account
      provider
    );
    aggregatorWallet = new ethers.Wallet(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // Second Hardhat account
      provider
    );
    
    // Initialize clients
    const abi = (global as any).getContractABI();
    
    const baseClientOptions = {
      contractAddress,
      provider: provider,
      signer: userWallet,
      abi
    };
    
    const baseClient = new UniCityAnchorClient(baseClientOptions);
    
    gatewayClient = new AggregatorGatewayClient({
      ...baseClientOptions,
      gatewayAddress: userWallet.address
    });
    
    nodeClient = new SMTAggregatorNodeClient({
      ...baseClientOptions,
      signer: aggregatorWallet,
      aggregatorAddress: aggregatorWallet.address,
      smtDepth: 32
    });
    
    // Add the aggregator role to the aggregator wallet
    try {
      await baseClient.addAggregator(aggregatorWallet.address);
      console.log(`Added aggregator role to ${aggregatorWallet.address}`);
    } catch (error) {
      // Ignore error if aggregator is already registered
      console.log('Aggregator may already be registered');
    }
  });
  
  afterAll(async () => {
    if (provider) {
      await provider.destroy();
    }
  });

  // Test generating a hashroot using SMT and submitting to a batch
  it('should generate hashroot using SMT and submit to contract', async () => {
    // Skip if no contract address
    if (!contractAddress) {
      console.log('Skipping test due to missing CONTRACT_ADDRESS');
      return;
    }
    
    // Create commitments
    const commitments = [];
    const count = 5;
    
    for (let i = 0; i < count; i++) {
      const requestId = BigInt(Date.now() + i);
      const payload = ethers.toUtf8Bytes(`smt-payload-${i}`);
      const authenticator = ethers.toUtf8Bytes(`smt-auth-${i}`);
      
      commitments.push({
        requestID: requestId,
        payload,
        authenticator
      });
    }
    
    // Submit commitments and create a batch
    console.log(`Submitting ${count} commitments and creating a batch...`);
    const { batchNumber, successCount, result } = await gatewayClient.submitAndCreateBatch(commitments);
    
    expect(result.success).toBe(true);
    expect(successCount).toBe(BigInt(count));
    expect(batchNumber).toBeGreaterThan(0n);
    
    console.log(`Created batch #${batchNumber} with ${successCount} commitments`);
    
    // Get the batch info
    const batchInfo = await nodeClient.getBatch(batchNumber);
    expect(batchInfo.requests.length).toBe(count);
    expect(batchInfo.processed).toBe(false);
    
    // Generate a hashroot using SMT
    const smtTree = await SparseMerkleTree.create(HashAlgorithm.SHA256);
    
    // Add each request to the SMT
    for (const request of batchInfo.requests) {
      const requestId = BigInt(request.requestID);
      const payload = typeof request.payload === 'object' && request.payload !== null ?
        new Uint8Array(request.payload as ArrayBuffer) : new Uint8Array(0);
      await smtTree.addLeaf(requestId, payload);
    }
    
    // Get the root hash
    const smtRootHash = smtTree.rootHash;
    console.log('SMT Root Hash:', smtRootHash.toString());
    
    // Process the batch using the SMT aggregator client
    console.log(`Processing batch #${batchNumber} using SMT...`);
    const processResult = await nodeClient.processBatch(batchNumber);
    
    expect(processResult.success).toBe(true);
    console.log('Batch processing transaction:', processResult.transactionHash);
    
    // Verify the batch is now processed
    const updatedBatchInfo = await nodeClient.getBatch(batchNumber);
    expect(updatedBatchInfo.processed).toBe(true);
    
    // The batch should have a hashroot now
    expect(updatedBatchInfo.hashroot).toBeTruthy();
    console.log('Batch hashroot:', updatedBatchInfo.hashroot);
  }, 40000); // Increase timeout for blockchain operations
  
  // This test processes all unprocessed batches
  it('should process all unprocessed batches', async () => {
    // Skip if no contract address
    if (!contractAddress) {
      console.log('Skipping test due to missing CONTRACT_ADDRESS');
      return;
    }
    
    // Create several batches with commitments
    const batchCount = 3;
    const batchNumbers: bigint[] = [];
    
    for (let b = 0; b < batchCount; b++) {
      // Create commitments for this batch
      const commitments = [];
      const count = 3;
      
      for (let i = 0; i < count; i++) {
        const requestId = BigInt(Date.now() + 1000 + (b * 100) + i);
        const payload = ethers.toUtf8Bytes(`multi-batch-payload-${b}-${i}`);
        const authenticator = ethers.toUtf8Bytes(`multi-batch-auth-${b}-${i}`);
        
        commitments.push({
          requestID: requestId,
          payload,
          authenticator
        });
      }
      
      // Submit commitments and create a batch
      console.log(`Creating batch ${b+1}/${batchCount} with ${count} commitments...`);
      const { batchNumber } = await gatewayClient.submitAndCreateBatch(commitments);
      batchNumbers.push(batchNumber);
      console.log(`Created batch #${batchNumber}`);
    }
    
    // Process all unprocessed batches
    console.log('Processing all unprocessed batches...');
    const results = await nodeClient.processAllUnprocessedBatches();
    
    console.log(`Processed ${results.length} batches`);
    
    // Verify all batches are processed
    for (const batchNumber of batchNumbers) {
      const batchInfo = await nodeClient.getBatch(batchNumber);
      expect(batchInfo.processed).toBe(true);
      console.log(`Verified batch #${batchNumber} is processed`);
    }
  }, 60000); // Increase timeout for multiple blockchain operations
});