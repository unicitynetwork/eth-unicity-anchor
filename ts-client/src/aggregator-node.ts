import { UniCityAnchorClient } from './client';
import {
  AggregatorConfig,
  CommitmentRequest,
  TransactionResult,
  EventType,
  SmtNode,
  BatchRequest,
} from './types';
import { SparseMerkleTree } from '@unicitylabs/commons/lib/smt/SparseMerkleTree.js';
import { HashAlgorithm } from '@unicitylabs/commons/lib/hash/HashAlgorithm.js';
import { DataHasher } from '@unicitylabs/commons/lib/hash/DataHasher.js';
import { ethers } from 'ethers';
import { bytesToHex, hexToBytes } from './utils';

/**
 * Client for aggregator node operations
 * Handles batch processing and hashroot submissions
 */
export class AggregatorNodeClient extends UniCityAnchorClient {
  // Changed from private to protected to allow access in derived classes
  protected readonly aggregatorAddress: string;
  private readonly smtDepth: number;
  private readonly batchProcessingInterval: number;
  private batchProcessingTimer?: NodeJS.Timeout;
  // Track which batches have been processed by this instance
  protected processedBatches: Set<string> = new Set();
  
  // Track processed requests
  private processedRequestIds: Set<string> = new Set();
  
  // Store the original request data (authenticator and transaction hash)
  // along with the requestId to be able to reconstruct complete inclusion proofs
  private requestDataMap: Map<string, { authenticator: any, transactionHash: string }> = new Map();
  
  // Single persistent SMT instance for the entire lifecycle
  private smt: any = null; // Will be initialized when needed

  constructor(config: AggregatorConfig) {
    super(config);
    this.aggregatorAddress = config.aggregatorAddress;
    this.smtDepth = config.smtDepth || 32; // Default to 32 levels for SMT
    
    // Support both the new autoProcessing parameter and backward compatibility
    let autoProcessingEnabled = false;
    
    if (typeof config.autoProcessing === 'number') {
      // New style: autoProcessing in seconds
      this.batchProcessingInterval = config.autoProcessing > 0 ? config.autoProcessing * 1000 : 0;
      autoProcessingEnabled = this.batchProcessingInterval > 0;
    } else {
      // Legacy style
      this.batchProcessingInterval = config.batchProcessingInterval || 5 * 60 * 1000; // 5 minutes default
      autoProcessingEnabled = !!config.autoProcessBatches;
    }

    // Will initialize the Merkle Tree when processing batches

    // If batch processing is enabled, catch up with the on-chain state
    if (autoProcessingEnabled) {
      // Run this in the background to avoid blocking constructor
      setTimeout(() => {
        this.syncWithOnChainState().then(() => {
          // Start automatic batch processing after sync
          this.startAutoBatchProcessing();
        }).catch(error => {
          console.error('Error syncing with on-chain state:', error);
          // Still start batch processing even if sync fails
          this.startAutoBatchProcessing();
        });
      }, 0);
    }
  }

  /**
   * Synchronize with on-chain state by processing all batches that have been 
   * processed on-chain but not by this instance
   * 
   * This ensures the gateway is in sync with the blockchain state even after
   * a restart, and that the SMT state is consistent with what's on-chain.
   */
  protected async syncWithOnChainState(): Promise<void> {
    try {
      console.log('[Sync] Starting synchronization with on-chain state');
      const startTime = Date.now();
      
      // Get the latest batch numbers
      const latestBatchNumber = await this.getLatestBatchNumber();
      const latestProcessedBatchNumber = await this.getLatestProcessedBatchNumber();
      
      if (latestBatchNumber === 0n) {
        console.log('[Sync] No batches found on-chain, nothing to synchronize');
        return;
      }
      
      console.log(`[Sync] Found ${latestBatchNumber} batches on-chain, ${latestProcessedBatchNumber} processed`);
      
      // Process all batches from 1 to latestProcessedBatchNumber
      // These are already processed on-chain, but we need to calculate hashroots locally
      // to maintain consistency
      let syncedBatchCount = 0;
      
      for (let i = 1n; i <= latestProcessedBatchNumber; i++) {
        // Skip if already processed by this instance
        if (this.processedBatches.has(i.toString())) {
          continue;
        }
        
        try {
          console.log(`[Sync] Processing already processed batch ${i} to verify hashroot`);
          const batch = await this.getBatch(i);
          
          if (!batch.processed || !batch.hashroot) {
            console.warn(`[Sync] Batch ${i} is marked as processed on-chain but has no hashroot, skipping`);
            continue;
          }
          
          // Calculate the hashroot locally
          const localHashroot = await this.calculateHashroot(batch.requests);
          
          // Compare with on-chain hashroot
          const onChainHashroot = batch.hashroot;
          
          // Standardize the on-chain value in case of format differences
          let normalizedOnChainHashroot = onChainHashroot;
          if (!normalizedOnChainHashroot.startsWith('0x')) {
            normalizedOnChainHashroot = `0x${normalizedOnChainHashroot}`;
          }
          
          // Convert our local hashroot to hex string for comparison
          const localHashrootHex = ethers.hexlify(localHashroot);
          
          console.log(`[Sync] Comparing hashrooots for batch ${i}:`);
          console.log(`[Sync] Local calculated: ${localHashrootHex}`);
          console.log(`[Sync] On-chain value (original): ${onChainHashroot}`);
          console.log(`[Sync] On-chain value (normalized): ${normalizedOnChainHashroot}`);
          
          // Log more details for debugging
          const localHashHex = localHashrootHex;
          const localHashStripped = localHashHex.replace('0x', '');
          const onChainHashHex = normalizedOnChainHashroot;
          const onChainHashStripped = onChainHashHex.replace('0x', '');
          
          console.log(`[Sync-Debug] Local hash hex: ${localHashHex}`);
          console.log(`[Sync-Debug] Local hash stripped: ${localHashStripped}`);
          console.log(`[Sync-Debug] OnChain hash hex: ${onChainHashHex}`);
          console.log(`[Sync-Debug] OnChain hash stripped: ${onChainHashStripped}`);
          console.log(`[Sync-Debug] Direct compare: ${localHashHex === onChainHashHex}`);
          console.log(`[Sync-Debug] Stripped compare: ${localHashStripped === onChainHashStripped}`);

          // Original comparison code
          if (localHashrootHex === normalizedOnChainHashroot || 
              localHashrootHex.replace('0x', '') === normalizedOnChainHashroot.replace('0x', '')) {
            console.log(`[Sync] Batch ${i} hashroot verified successfully`);
            // Add to processed batches since we've verified it
            this.processedBatches.add(i.toString());
            syncedBatchCount++;
          } else {
            // CRITICAL SECURITY BREACH - data integrity failure
            console.error(`[Sync] CRITICAL SECURITY FAILURE: Hashroot mismatch detected for batch ${i}:`);
            console.error(`[Sync] Local calculated: ${localHashrootHex}`);
            console.error(`[Sync] On-chain value:   ${onChainHashroot}`);
            console.error(`[Sync] This represents a serious data integrity breach or SMT consistency failure!`);
            
            // This is a critical system failure that requires immediate termination
            if (process.env.NODE_ENV !== 'test') {
              console.error(`[Sync] CRITICAL SYSTEM INTEGRITY FAILURE: Exiting process to prevent data corruption`);
              process.exit(1); // Exit with non-zero code to signal error
            } else {
              console.error(`[Sync] Would exit immediately in production mode. Continuing in test mode only.`);
            }
            
            // Do NOT mark as processed - this prevents building an SMT on corrupted data
            // Instead, throw an error with a consistent message format for test detection
            const errorMessage = `CRITICAL INTEGRITY FAILURE: Hashroot mismatch detected for batch ${i}`;
            console.error(`[Sync] ${errorMessage}`);
            
            // Create error with property to make detection easier in tests
            const error = new Error(errorMessage);
            (error as any).criticalHashrootMismatch = true;
            
            throw error;
          }
        } catch (error) {
          console.error(`[Sync] Error processing batch ${i}:`, error);
          // Continue with next batch
        }
      }
      
      const elapsedTime = Date.now() - startTime;
      console.log(`[Sync] Synchronized ${syncedBatchCount} batches in ${elapsedTime}ms`);
    } catch (error) {
      console.error('[Sync] Error synchronizing with on-chain state:', error);
      throw error;
    }
  }

  /**
   * Verify hashroot consensus for a batch
   * This is a critical security function that ensures data integrity
   * 
   * @param batchNumber Batch number to verify
   * @param localHashroot Our locally calculated hashroot
   * @param onChainHashroot Hashroot from the blockchain
   * @returns True if consensus is achieved, false otherwise with critical error
   */
  protected async verifyHashrootConsensus(
    batchNumber: bigint, 
    localHashroot: Uint8Array | string,
    onChainHashroot: string
  ): Promise<{success: boolean; error?: Error; critical?: boolean; waitForConsensus?: boolean; testOverride?: boolean}> {
    // Convert to hex string for comparison if needed
    const localHashrootHex = typeof localHashroot === 'string' 
      ? (localHashroot.startsWith('0x') ? localHashroot : `0x${localHashroot}`)
      : ethers.hexlify(localHashroot);
    
    // Standardize the on-chain value in case of format differences
    const normalizedOnChainHashroot = onChainHashroot.startsWith('0x') 
      ? onChainHashroot 
      : `0x${onChainHashroot}`;
    
    console.log(`[Consensus] Comparing hashrooots for batch ${batchNumber}:`);
    console.log(`[Consensus] Local calculated: ${localHashrootHex}`);
    console.log(`[Consensus] On-chain value (original): ${onChainHashroot}`);
    console.log(`[Consensus] On-chain value (normalized): ${normalizedOnChainHashroot}`);
    
    // Step 1: Check if our hashroot matches the on-chain value (checking both with and without 0x prefix)
    if (localHashrootHex !== normalizedOnChainHashroot && 
        localHashrootHex.replace('0x', '') !== normalizedOnChainHashroot.replace('0x', '')) {
      
      // Log more details for debugging
      const localHashHex = localHashrootHex;
      const localHashStripped = localHashHex.replace('0x', '');
      const onChainHashHex = normalizedOnChainHashroot;
      const onChainHashStripped = onChainHashHex.replace('0x', '');
      
      console.log(`[Consensus-Debug] Local hash hex: ${localHashHex}`);
      console.log(`[Consensus-Debug] Local hash stripped: ${localHashStripped}`);
      console.log(`[Consensus-Debug] OnChain hash hex: ${onChainHashHex}`);
      console.log(`[Consensus-Debug] OnChain hash stripped: ${onChainHashStripped}`);
      console.log(`[Consensus-Debug] Direct compare: ${localHashHex === onChainHashHex}`);
      console.log(`[Consensus-Debug] Stripped compare: ${localHashStripped === onChainHashStripped}`);
      
      // CRITICAL SECURITY ALERT - Data integrity failure
      console.error(`[Sync] CRITICAL SECURITY FAILURE: Hashroot mismatch detected for batch ${batchNumber}:`);
      console.error(`[Sync] Local calculated: ${localHashrootHex}`);
      console.error(`[Sync] On-chain value:   ${onChainHashroot}`);
      console.error(`[Sync] This represents a serious data integrity breach or SMT consistency failure!`);
      
      // Create a consistent error message for test detection
      const errorMessage = `CRITICAL INTEGRITY FAILURE: Hashroot mismatch detected for batch ${batchNumber}`;
      console.error(`[Sync] ${errorMessage}`);
      
      // Create the error object with a property to make detection easier
      const error = new Error(errorMessage);
      (error as any).criticalHashrootMismatch = true;
      
      // This is a critical system failure that requires immediate termination
      // Do not continue processing under any circumstances as it would corrupt the SMT
      if (process.env.NODE_ENV !== 'test') {
        console.error(`[Sync] CRITICAL SYSTEM INTEGRITY FAILURE: Exiting process to prevent data corruption`);
        process.exit(1); // Exit with non-zero code to signal error
      } else {
        console.error(`[Sync] Would exit immediately in production mode. Continuing only because in test mode.`);
        
        // NEW CODE: In test mode, check if this is a test mismatch that should be accepted
        if (process.env.ALLOW_TEST_MISMATCH === 'true') {
          console.log(`[Consensus] WARNING: Accepting mismatched hashroot for testing purposes - DEVELOPMENT MODE ONLY`);
          // Still return an error object but with a testOverride flag to allow tests to check proper handling
          return { 
            success: false, 
            error: error,
            critical: true,
            testOverride: true // Flag that test override was used
          };
        }
      }
      
      // Always return error by default (important for security!)
      return {
        success: false, 
        error: error,
        critical: true
      };
    }
    
    // Step 2: Verify consensus by checking if the batch is processed on the contract
    // The smart contract is the source of truth for whether quorum has been reached
    try {
      // Get the batch state directly from the contract
      const batchInfo = await this.getBatch(batchNumber);
      
      // If the batch is marked as processed, consensus has been achieved
      if (batchInfo.processed) {
        // The smart contract has determined that sufficient votes have been received
        // and the batch is officially processed - this is definitive proof of consensus
        console.log(`Hashroot consensus verified for batch ${batchNumber} - batch is marked as processed in contract`);
        return { success: true };
      }
      
      // The batch exists but hasn't reached quorum yet
      // Get current vote stats for informational purposes only
      try {
        const contract = this.contract;
        const voteCounts = await contract.getVoteCounts(batchNumber);
        const requiredVotes = await contract.requiredVotes();
        
        console.log(`Batch ${batchNumber} waiting for consensus: ${voteCounts}/${requiredVotes} votes received`);
      } catch (error) {
        // If we can't get vote counts, just log a general message
        console.log(`Batch ${batchNumber} waiting for consensus - quorum not yet reached`);
      }
      
      // Not processed yet, but this is normal consensus gathering - keep waiting
      return {
        success: false,
        error: new Error(`Batch ${batchNumber} has not reached quorum yet`),
        waitForConsensus: true // Flag indicating we should continue waiting, not a critical failure
      };
      
    } catch (error) {
      console.error(`Error checking hashroot consensus for batch ${batchNumber}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  /**
   * Verify a batch that has already been processed on-chain
   * Compares our calculated hashroot with what's recorded on-chain
   */
  protected async verifyProcessedBatch(
    batchNumber: bigint,
    batchInfo: { processed: boolean; hashroot?: string; requests: BatchRequest[] }
  ): Promise<TransactionResult> {
    const batchKey = batchNumber.toString();
    
    // If already processed locally, no need to verify again
    if (this.processedBatches.has(batchKey)) {
      return {
        success: false,
        error: new Error(`Batch ${batchNumber} is already processed`),
      };
    }
    
    // If no hashroot, we can't verify
    if (!batchInfo.hashroot) {
      console.warn(`Batch ${batchNumber} is marked as processed but has no hashroot`);
      this.processedBatches.add(batchKey);
      return {
        success: false,
        error: new Error(`Batch ${batchNumber} has no hashroot to verify`),
      };
    }
    
    // Calculate the hashroot locally and compare
    try {
      const localHashroot = await this.calculateHashroot(batchInfo.requests);
      const localHashrootHex = ethers.hexlify(localHashroot);
      
      // Use the centralized consensus verification function
      const consensusResult = await this.verifyHashrootConsensus(
        batchNumber, 
        localHashrootHex, 
        batchInfo.hashroot
      );
      
      if (consensusResult.success) {
        console.log(`Hashroot verification successful for batch ${batchNumber}`);
        this.processedBatches.add(batchKey);
        return {
          success: true,
          message: `Batch ${batchNumber} hashroot verified successfully`,
          verified: true
        };
      } else {
        // Propagate critical failures
        if (consensusResult.critical) {
          return {
            success: false,
            error: consensusResult.error,
            message: consensusResult.error?.message || 'Hashroot consensus verification failed',
            critical: true
          };
        }
        
        // For non-critical failures (like not enough votes yet), don't mark as processed
        return {
          success: false,
          error: consensusResult.error,
          message: consensusResult.error?.message || 'Hashroot consensus verification failed'
        };
      }
    } catch (error) {
      console.error(`Error verifying batch ${batchNumber}:`, error);
      // Only mark as processed for non-critical errors
      if (!(error instanceof Error && error.message.includes('CRITICAL'))) {
        this.processedBatches.add(batchKey);
      }
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        message: `Error verifying batch ${batchNumber}`
      };
    }
  }

  /**
   * Calculate hashroot for a set of requests
   * Used for validation during sync
   */
  protected async calculateHashroot(requests: BatchRequest[]): Promise<Uint8Array> {
    console.log(`[Hashroot] Calculating hashroot for ${requests.length} requests`);
    
    // Create the SMT if it doesn't exist yet
    if (!this.smt) {
      console.log(`[Hashroot] Creating new SMT instance for the first time`);
      this.smt = await SparseMerkleTree.create(HashAlgorithm.SHA256);
      console.log(`[Hashroot] SMT created successfully`);
    }
    
    // Add all commitments as leaves
    for (const request of requests) {
      // Convert requestId to SMT path using our helper method (with 1 prefix)
      const { path: requestIdPath, hex: requestIdHex } = this.convertRequestIdToSMTPath(request.requestID);
      
      console.log(`[Hashroot] RequestID as SMT path: ${requestIdPath}`);
      
      // 1. Parse authenticator as JSON
      let authenticatorObj;
      try {
        const authText = Buffer.from(hexToBytes(request.authenticator)).toString();
        authenticatorObj = JSON.parse(authText);
      } catch (e: any) {
        // If not valid JSON, handle gracefully
        console.warn(`[Hashroot] Failed to parse authenticator as JSON: ${e.message}`);
        // Use raw authenticator if not valid JSON
        authenticatorObj = request.authenticator; 
      }
      
      // 2. Get transaction hash from payload
      const transactionHash = request.payload;
      
      // 3. Combine into the structure expected
      const jsonData = {
        authenticator: authenticatorObj,
        transactionHash: transactionHash
      };
      
      // 4. Convert to JSON and hash it
      const jsonString = JSON.stringify(jsonData);
      const leafValue = await new DataHasher(HashAlgorithm.SHA256)
        .update(new TextEncoder().encode(jsonString))
        .digest();
      
      // Log leaf data for debugging
      console.log(`[Hashroot] Adding leaf for requestId ${requestIdHex.substring(0, 20)}...`);
      
      // 5. Add the leaf to the SMT using SMT path with 1 prefix
      await this.smt.addLeaf(requestIdPath, leafValue.data);
      
      // Store the data for inclusion proofs
      this.processedRequestIds.add(requestIdHex);
      this.requestDataMap.set(requestIdHex, {
        authenticator: authenticatorObj,
        transactionHash: `0000${transactionHash}` // Adding "0000" prefix for SHA-256 hash algorithm
      });
    }
    
    // Get the root hash
    const rootHashData = this.smt.rootHash.data;
    console.log(`[Hashroot] Generated hashroot with ${rootHashData.length} bytes`);
    
    return rootHashData;
  }
  
  /**
   * Submit a hashroot for a batch
   * @param batchNumber The batch number
   * @param hashroot The hashroot to submit
   * @returns Transaction result
   */
  public async submitHashroot(
    batchNumber: bigint | string,
    hashroot: Uint8Array | string,
  ): Promise<TransactionResult> {
    const bn = typeof batchNumber === 'string' ? BigInt(batchNumber) : batchNumber;
    
    // Standardize hashroot to ensure consistent format
    let hrBytes: Uint8Array;
    if (typeof hashroot === 'string') {
      // Make sure it has 0x prefix for consistent handling
      const normalizedHashroot = hashroot.startsWith('0x') ? hashroot : `0x${hashroot}`;
      console.log(`[HashRoot] Normalized hashroot string: ${normalizedHashroot}`);
      hrBytes = hexToBytes(normalizedHashroot);
    } else {
      hrBytes = hashroot;
    }

    console.log(`[HashRoot] Submitting hashroot for batch ${bn} to the transaction queue`);
    console.log(`[HashRoot] Hashroot value: ${ethers.hexlify(hrBytes)}`);
    console.log(`[HashRoot] This submission will be processed sequentially with proper confirmation`);
    
    // The executeTransaction method is now wrapping our queue implementation
    // It will categorize this as HASHROOT_VOTE and ensure proper confirmation
    return this.executeTransaction('submitHashroot', [bn, hrBytes]);
  }

  /**
   * Process a batch by computing its hashroot and submitting it
   * @param batchNumber The batch number to process
   * @returns Result of the hashroot submission
   */
  /**
   * Helper method to convert a requestId to BigInt format for SMT
   * Also returns the hex representation for tracking
   * @param requestId The request ID in any format
   * @returns Object with BigInt and hex string representation of the requestId
   */
  private convertRequestIdToBigInt(requestId: any): { bigint: bigint, hex: string } {
    let requestIdBigInt: bigint;
    let requestIdHex: string;
    
    if (typeof requestId === 'string') {
      requestIdHex = requestId.replace(/^0x/, '');
      // Convert hex string to BigInt
      try {
        requestIdBigInt = BigInt('0x' + requestIdHex);
      } catch (e) {
        // If not valid hex, use hash fallback
        console.warn(`Cannot convert string to BigInt directly: ${requestIdHex}. Using hash fallback.`);
        const hashVal = [...requestIdHex].reduce((acc, char) => {
          return ((acc << 5) - acc + char.charCodeAt(0)) | 0;
        }, 0);
        requestIdBigInt = BigInt(Math.abs(hashVal));
      }
    } else if (typeof requestId === 'bigint') {
      requestIdBigInt = requestId;
      requestIdHex = requestId.toString(16);
    } else if (typeof requestId === 'number') {
      requestIdBigInt = BigInt(requestId);
      requestIdHex = requestId.toString(16);
    } else if (requestId instanceof Uint8Array || Buffer.isBuffer(requestId)) {
      // Convert bytes to hex string, then to BigInt
      requestIdHex = Buffer.from(requestId).toString('hex');
      requestIdBigInt = BigInt('0x' + requestIdHex);
    } else {
      // Try to convert other formats to string first
      const requestIdStr = String(requestId).replace(/^0x/, '');
      requestIdHex = requestIdStr;
      try {
        // Try to interpret as hex
        requestIdBigInt = BigInt('0x' + requestIdStr);
      } catch (e) {
        // Use a hash of the string as fallback
        console.warn(`Cannot convert to BigInt: ${requestIdStr}. Using hash fallback.`);
        // Simple hash function
        const hashVal = [...requestIdStr].reduce((acc, char) => {
          return ((acc << 5) - acc + char.charCodeAt(0)) | 0;
        }, 0);
        requestIdBigInt = BigInt(Math.abs(hashVal));
      }
    }
    
    return { bigint: requestIdBigInt, hex: requestIdHex };
  }
  
  /**
   * Helper method to convert a requestId to SMT path format
   * SMT paths require a '1' prefix to properly preserve leading zeros
   * 
   * @param requestId The request ID in any format
   * @returns Object with SMT-formatted BigInt path and hex string representation
   */
  private convertRequestIdToSMTPath(requestId: any): { path: bigint, hex: string } {
    // First normalize to hex string without 0x prefix
    let hexString: string;
    
    if (typeof requestId === 'string') {
      // Remove 0x if present
      hexString = requestId.replace(/^0x/, '');
    } else if (requestId instanceof Uint8Array || Buffer.isBuffer(requestId)) {
      // Convert bytes to hex string
      hexString = Buffer.from(requestId).toString('hex');
    } else if (typeof requestId === 'bigint' || typeof requestId === 'number') {
      // Convert numeric to hex string
      hexString = (typeof requestId === 'bigint' ? 
        requestId.toString(16) : BigInt(requestId).toString(16));
    } else {
      // For any other type, stringify first
      hexString = String(requestId).replace(/^0x/, '');
    }
    
    // Create SMT path by adding '1' prefix to preserve leading zeros
    const smtPath = BigInt('0x1' + hexString);
    
    console.log(`Normalized request ID to hex: ${hexString.substring(0, 20)}...`);
    console.log(`SMT path with 1-prefix: 0x1${hexString.substring(0, 20)}...`);
    
    return { path: smtPath, hex: hexString };
  }

  /**
   * Process a batch by generating a hashroot and submitting it to the contract
   * Uses a persistent SMT that accumulates all requests
   * @param batchNumber The batch number to process
   * @returns Transaction result
   */
  public async processBatch(batchNumber: bigint | string): Promise<TransactionResult> {
    try {
      const bn = typeof batchNumber === 'string' ? BigInt(batchNumber) : batchNumber;

      // First check if this batch has already been processed by this instance
      if (this.processedBatches.has(bn.toString())) {
        return {
          success: false,
          error: new Error(`Batch ${bn} is already processed by this instance`),
          skipped: true
        };
      }
      
      // Check if the batch is already processed on-chain
      const batchInfo = await this.getBatch(bn);
      if (batchInfo.processed) {
        console.log(`Batch ${bn} is already processed on-chain. Verifying locally...`);
        return this.verifyProcessedBatch(bn, batchInfo);
      }
      
      // Check if we can process this batch (must be the next one after the latest processed)
      const latestProcessed = await this.getLatestProcessedBatchNumber();
      if (bn > latestProcessed + BigInt(1)) {
        return {
          success: false,
          error: new Error(
            `Batch ${bn} cannot be processed yet. Current processed batch: ${latestProcessed}`,
          ),
        };
      }

      // We already got the batch info above, but let's make sure we have the correct variables
      const { requests } = batchInfo;

      // Create the SMT if it doesn't exist yet
      if (!this.smt) {
        console.log(`Creating new SMT instance for the first time`);
        this.smt = await SparseMerkleTree.create(HashAlgorithm.SHA256);
        console.log(`SMT created successfully`);
      }
      
      // Add each request to the SMT
      let addedCount = 0;
      let skippedCount = 0;
      
      for (const request of requests) {
        // Convert requestId to SMT path using our helper method (with 1 prefix)
        const { path: requestIdPath, hex: requestIdHex } = this.convertRequestIdToSMTPath(request.requestID);
        
        console.log(`RequestID as SMT path: ${requestIdPath}`);
        
        // Skip already processed requests
        if (this.processedRequestIds.has(requestIdHex)) {
          console.log(`Skipping already processed request ${requestIdHex.substring(0, 20)}...`);
          skippedCount++;
          continue;
        }
        
        // 1. Parse authenticator as JSON
        let authenticatorObj;
        try {
          const authText = Buffer.from(hexToBytes(request.authenticator)).toString();
          authenticatorObj = JSON.parse(authText);
        } catch (e: any) {
          // If not valid JSON, handle gracefully
          console.warn(`Failed to parse authenticator as JSON for request ${requestIdHex.substring(0, 20)}...: ${e.message}`);
          // Use raw authenticator if not valid JSON
          authenticatorObj = request.authenticator; 
        }
        
        // 2. Get transaction hash from payload
        const transactionHash = request.payload;
        
        // 3. Combine into the structure expected by InclusionProof verification
        const jsonData = {
          authenticator: authenticatorObj,
          transactionHash: transactionHash
        };
        
        // 4. Convert to JSON and hash it
        const jsonString = JSON.stringify(jsonData);
        const leafValue = await new DataHasher(HashAlgorithm.SHA256)
          .update(new TextEncoder().encode(jsonString))
          .digest();
        
        console.log(`Calculated leaf value for request ${requestIdHex.substring(0, 20)}...`);
        
        // 5. Add the leaf to the SMT using BigInt as the key (UniCity SMT expects BigInt)
        await this.smt.addLeaf(requestIdPath, leafValue.data);
        
        // Mark as processed using hex representation for tracking
        this.processedRequestIds.add(requestIdHex);
        
        // Store the original request data for inclusion proof generation
        this.requestDataMap.set(requestIdHex, {
          authenticator: authenticatorObj,
          transactionHash: `0000${transactionHash}` // Adding "0000" prefix for SHA-256 hash algorithm
        });
        
        addedCount++;
        
        console.log(`Added leaf for request ${requestIdHex.substring(0, 20)}...`);
      }
      
      console.log(`Processed ${requests.length} requests: ${addedCount} added, ${skippedCount} skipped`);
      console.log(`Total unique requests in SMT: ${this.processedRequestIds.size}`);
      
      // Get the root hash
      const rootHashData = this.smt.rootHash.data;
      console.log(`Generated hashroot with ${rootHashData.length} bytes`);

      // Submit the hashroot
      const result = await this.submitHashroot(bn, rootHashData);
      
      // If successful, add to processed batches to avoid duplicate processing
      if (result.success) {
        this.processedBatches.add(bn.toString());
        console.log(`Batch ${bn} processed successfully and added to processed list`);
      }
      
      return result;
    } catch (error: any) {
      return {
        success: false,
        error: new Error(`Error processing batch: ${error.message}`),
      };
    }
  }

  /**
   * Reset the Merkle Tree
   */
  private resetSmt(): void {
    this.smt = null; // Will be re-initialized when needed
  }

  /**
   * Process all unprocessed batches
   * @returns Array of transaction results
   */
  public async processAllUnprocessedBatches(): Promise<TransactionResult[]> {
    const latestBatchNumber = await this.getLatestBatchNumber();
    const latestProcessedBatchNumber = await this.getLatestProcessedBatchNumber();
    
    console.log(`Processing all unprocessed batches from ${latestProcessedBatchNumber + 1n} to ${latestBatchNumber}`);
    
    const results: TransactionResult[] = [];
    
    // Process batches sequentially without skipping
    let nextBatchToProcess = latestProcessedBatchNumber + 1n;
    
    while (nextBatchToProcess <= latestBatchNumber) {
      console.log(`Checking batch ${nextBatchToProcess}...`);
      
      // Skip batches that have already been processed by this instance
      if (this.processedBatches.has(nextBatchToProcess.toString())) {
        console.log(`Skipping batch ${nextBatchToProcess} as it was already processed by this instance`);
        // Add a result to indicate this batch was skipped but previously processed
        results.push({
          success: true, // Count as success since we processed it before
          message: `Batch ${nextBatchToProcess} already processed by this instance`,
          skipped: true
        });
        nextBatchToProcess++; // Move to next batch
        continue;
      }
      
      // First check if the batch exists before trying to process it
      let batchExists = true;
      try {
        // Try to get the batch - this will throw if it doesn't exist
        await this.getBatch(nextBatchToProcess);
      } catch (error) {
        // If we get "Batch does not exist" error, mark it and stop
        if (error instanceof Error && error.message.includes("Batch does not exist")) {
          console.log(`Batch ${nextBatchToProcess} does not exist (gap). Stopping batch processing.`);
          results.push({
            success: false,
            error: error,
            message: `Batch ${nextBatchToProcess} does not exist (gap detected)` 
          });
          return results; // Stop processing on first gap
        }
        batchExists = false;
      }
      
      // Only try to process if the batch exists
      if (batchExists) {
        try {
          console.log(`Processing batch ${nextBatchToProcess}...`);
          const result = await this.processBatch(nextBatchToProcess);
          results.push(result);
          
          if (!result.success) {
            console.log(`Note: Batch ${nextBatchToProcess} processing was not successful: ${result.error?.message}`);
            // Stop at first failure - we can't continue past a failed batch
            return results;
          }
        } catch (error) {
          console.error(`Error processing batch ${nextBatchToProcess}:`, error);
          // Stop at first error - we can't continue past a failed batch
          results.push({
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
            message: `Failed to process batch ${nextBatchToProcess}`
          });
          return results;
        }
      }
      
      // Move to next batch number
      nextBatchToProcess++;
    }
    
    return results;
  }

  /**
   * Start automatic batch processing
   */
  public startAutoBatchProcessing(): void {
    if (this.batchProcessingTimer) {
      clearInterval(this.batchProcessingTimer);
    }

    // Process batches when the timer fires
    this.batchProcessingTimer = setInterval(async () => {
      try {
        console.log(`[AutoProcess] Checking for unprocessed batches at ${new Date().toISOString()}`);
        const results = await this.processAllUnprocessedBatches();
        
        if (results.length > 0) {
          const successCount = results.filter(r => r.success).length;
          console.log(`[AutoProcess] Processed ${results.length} batches, ${successCount} successful`);
        } else {
          console.log('[AutoProcess] No unprocessed batches available');
        }
      } catch (error) {
        console.error('[AutoProcess] Error in auto batch processing:', error);
      }
    }, this.batchProcessingInterval);

    // Also listen for new batch created events to process them
    this.on(EventType.BatchCreated, async (_, data: { batchNumber: bigint }) => {
      try {
        // Skip if already processed by this instance
        const batchKey = data.batchNumber.toString();
        if (this.processedBatches.has(batchKey)) {
          console.log(`[BatchCreated] Batch ${data.batchNumber} already processed by this instance, skipping`);
          return;
        }
        
        const latestProcessed = await this.getLatestProcessedBatchNumber();

        // Check if this is the next batch to process
        if (data.batchNumber === latestProcessed + BigInt(1)) {
          console.log(`[BatchCreated] New batch ${data.batchNumber} created. Processing...`);
          await this.processBatch(data.batchNumber);
        } else {
          console.log(
            `[BatchCreated] New batch ${data.batchNumber} created, but not next in sequence. Current processed: ${latestProcessed}`,
          );
        }
      } catch (error) {
        console.error('[BatchCreated] Error in event-triggered batch processing:', error);
      }
    });
  }

  /**
   * Stop automatic batch processing
   */
  public stopAutoBatchProcessing(): void {
    if (this.batchProcessingTimer) {
      clearInterval(this.batchProcessingTimer);
      this.batchProcessingTimer = undefined;
    }
  }

  /**
   * Check if we are eligible to process the next batch
   * @returns Boolean indicating if the next batch can be processed
   */
  public async canProcessNextBatch(): Promise<boolean> {
    try {
      const latestProcessed = await this.getLatestProcessedBatchNumber();
      const latestBatch = await this.getLatestBatchNumber();

      return latestBatch > latestProcessed;
    } catch (error) {
      console.error('Error checking batch processing eligibility:', error);
      return false;
    }
  }

  /**
   * Get the next batch to process
   * @returns The next batch number or null if no batch to process
   */
  public async getNextBatchToProcess(): Promise<bigint | null> {
    try {
      const latestProcessed = await this.getLatestProcessedBatchNumber();
      const latestBatch = await this.getLatestBatchNumber();

      if (latestBatch > latestProcessed) {
        return latestProcessed + BigInt(1);
      }

      return null;
    } catch (error) {
      console.error('Error getting next batch to process:', error);
      return null;
    }
  }

  /**
   * Get an inclusion proof for a specific request ID from the SMT
   * The SMT will return an appropriate proof whether the leaf exists or not
   * 
   * @param requestId The request ID to generate a proof for (can be bytes, hex string, or Buffer)
   * @returns The inclusion proof or null if SMT isn't initialized
   */
  public async getInclusionProof(requestId: Uint8Array | string | Buffer | bigint): Promise<any> {
    // Convert the requestId to SMT path using our helper method (with 1 prefix)
    const { path: requestIdPath, hex: requestIdHex } = this.convertRequestIdToSMTPath(requestId);
    
    console.log(`Getting inclusion proof for requestId ${requestIdHex.substring(0, 20)}...`);
    console.log(`RequestID as SMT path: ${requestIdPath}`);
    
    // Check if we have an SMT initialized
    if (!this.smt) {
      console.error(`No SMT initialized yet, cannot generate proof`);
      return null;
    }
    
    try {
      // Generate the proof using the SMT's getPath method with SMT path (with 1 prefix)
      // This will return a proper Merkle path whether the leaf exists or not
      const proof = this.smt.getPath(requestIdPath);
      
      // Determine if this is a positive or negative inclusion proof
      const isPositiveProof = this.processedRequestIds.has(requestIdHex);
      console.log(`Generated ${isPositiveProof ? 'positive' : 'negative'} inclusion proof with ${proof.steps.length} steps`);
      
      // Get the original request data (if available)
      const originalData = this.requestDataMap.get(requestIdHex);
      
      if (originalData) {
        console.log(`Found original data for requestId ${requestIdHex.substring(0, 20)}`);
        // Attach the original data to the proof object
        proof.leafData = originalData;
      } else {
        console.log(`No original data found for requestId ${requestIdHex.substring(0, 20)}`);
      }
      
      return proof;
    } catch (error) {
      console.error(`Error generating inclusion proof for requestId:`, error);
      return null;
    }
  }

  /**
   * Generate Merkle proof for a specific commitment in a processed batch
   * This is a backward compatibility method that uses the new getInclusionProof internally
   * @param batchNumber The batch number
   * @param requestID The request ID to generate proof for
   * @returns The Merkle proof or null if not found
   */
  public async generateMerkleProof(
    batchNumber: bigint | string,
    requestID: bigint | string,
  ): Promise<{ proof: string[]; value: string } | null> {
    try {
      const bn = typeof batchNumber === 'string' ? BigInt(batchNumber) : batchNumber;
      const id = typeof requestID === 'string' ? requestID.toString() : requestID.toString();

      // Get the batch data
      const { requests, processed } = await this.getBatch(bn);

      if (!processed) {
        return null; // Cannot generate proof for unprocessed batch
      }

      // Check if the request is in this batch
      const request = requests.find((r) => r.requestID === id);
      if (!request) {
        return null; // Request not found in this batch
      }

      // Use our new getInclusionProof method
      const inclusionProof = await this.getInclusionProof(id);
      if (!inclusionProof) {
        return null;
      }

      // For backward compatibility, format the proof in the expected format
      return {
        proof: inclusionProof.steps.map((step: any) => step.toString()),
        value: request.payload + request.authenticator,
      };
    } catch (error) {
      console.error('Error generating Merkle proof:', error);
      return null;
    }
  }
}
