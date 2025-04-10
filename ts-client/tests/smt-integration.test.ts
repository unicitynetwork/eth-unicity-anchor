import { ethers } from 'ethers';
import { AggregatorNodeClient } from '../src/aggregator-node';
import { SparseMerkleTree } from '@unicitylabs/commons/src/smt/SparseMerkleTree.js';
import { HashAlgorithm } from '@unicitylabs/commons/src/hash/HashAlgorithm.js';

describe('SMT Integration Tests', () => {
  // Test the Sparse Merkle Tree implementation from @unicitylabs/commons
  it('should create an SMT and add commitments', async () => {
    // Create a new SMT instance
    const smt = await SparseMerkleTree.create(HashAlgorithm.SHA256);
    
    // Add some test commitments
    const textEncoder = new TextEncoder();
    
    // Add commitments to the tree
    await smt.addLeaf(0n, textEncoder.encode('commitment1'));
    await smt.addLeaf(1n, textEncoder.encode('commitment2'));
    await smt.addLeaf(2n, textEncoder.encode('commitment3'));
    
    // Get the root hash - this is what would be stored on-chain
    const rootHash = smt.rootHash;
    console.log('SMT Root Hash:', rootHash.toString());
    
    // Verify a path exists in the tree
    const path = smt.getPath(1n);
    const verificationResult = await path.verify(1n);
    
    expect(verificationResult.isPathIncluded).toBe(true);
    expect(verificationResult.isPathValid).toBe(true);
    expect(verificationResult.result).toBe(true);
    
    // Verify a path that doesn't exist
    const invalidPath = smt.getPath(5n);
    const invalidVerificationResult = await invalidPath.verify(5n);
    
    expect(invalidVerificationResult.isPathIncluded).toBe(false);
    expect(invalidVerificationResult.isPathValid).toBe(true);
    expect(invalidVerificationResult.result).toBe(false);
  });
  
  it('should demonstrate SMT usage with batch commitments', async () => {
    // This test shows how the SMT could be integrated with batch processing
    
    // Create mock batch data
    const batchNumber = 1n;
    const requests = [
      { requestID: 1n, payload: ethers.toUtf8Bytes('payload1'), authenticator: ethers.toUtf8Bytes('auth1') },
      { requestID: 2n, payload: ethers.toUtf8Bytes('payload2'), authenticator: ethers.toUtf8Bytes('auth2') },
      { requestID: 3n, payload: ethers.toUtf8Bytes('payload3'), authenticator: ethers.toUtf8Bytes('auth3') },
    ];
    
    // Create and populate the SMT
    const smt = await SparseMerkleTree.create(HashAlgorithm.SHA256);
    
    // Add each request to the SMT
    for (const request of requests) {
      // In a real implementation, we would likely hash the payload and authenticator together
      // Here we're just using the payload for simplicity
      await smt.addLeaf(request.requestID, request.payload);
    }
    
    // Get the root hash - this would be submitted to the blockchain
    const rootHash = smt.rootHash;
    console.log('Batch SMT Root Hash:', rootHash.toString());
    
    // This demonstrates how a node client would generate a hashroot for a batch
    // In the production system, this would be done by the aggregator
    const mockNodeClient = {
      generateHashrootForBatch: async (batchNum: bigint, reqs: any[]): Promise<Uint8Array> => {
        const tree = await SparseMerkleTree.create(HashAlgorithm.SHA256);
        
        for (const req of reqs) {
          await tree.addLeaf(req.requestID, req.payload);
        }
        
        // Return the root hash data for submission
        return tree.rootHash.data;
      }
    };
    
    // Generate the hashroot
    const hashroot = await mockNodeClient.generateHashrootForBatch(batchNumber, requests);
    
    // Convert to hex for display
    const hashrootHex = ethers.hexlify(hashroot);
    console.log('Generated Hashroot:', hashrootHex);
    
    // Verify that a specific request is included in the SMT
    const path = smt.getPath(2n);
    const verificationResult = await path.verify(2n);
    
    expect(verificationResult.result).toBe(true);
    expect(verificationResult.isPathIncluded).toBe(true);
    expect(verificationResult.isPathValid).toBe(true);
  });
});