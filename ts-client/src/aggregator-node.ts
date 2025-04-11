import { UniCityAnchorClient } from './client';
import {
  AggregatorConfig,
  CommitmentRequest,
  TransactionResult,
  EventType,
  SmtNode,
  BatchRequest,
} from './types';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { ethers } from 'ethers';
import { bytesToHex, hexToBytes } from './utils';

/**
 * Client for aggregator node operations
 * Handles batch processing and hashroot submissions
 */
export class AggregatorNodeClient extends UniCityAnchorClient {
  private readonly aggregatorAddress: string;
  private readonly smtDepth: number;
  private readonly batchProcessingInterval: number;
  private batchProcessingTimer?: NodeJS.Timeout;
  // Track which batches have been processed by this instance
  protected processedBatches: Set<string> = new Set();
  private smt: any; // Will be initialized when needed

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
          
          if (ethers.hexlify(localHashroot) === onChainHashroot) {
            console.log(`[Sync] Batch ${i} hashroot verified successfully`);
            // Add to processed batches since we've verified it
            this.processedBatches.add(i.toString());
            syncedBatchCount++;
          } else {
            console.warn(`[Sync] Batch ${i} hashroot mismatch:
              Local:    ${ethers.hexlify(localHashroot)}
              On-chain: ${onChainHashroot}`);
            // Still mark as processed to avoid attempting to reprocess it
            this.processedBatches.add(i.toString());
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
      
      if (localHashrootHex === batchInfo.hashroot) {
        console.log(`Hashroot verification successful for batch ${batchNumber}`);
        this.processedBatches.add(batchKey);
        return {
          success: true,
          message: `Batch ${batchNumber} hashroot verified successfully`,
          verified: true
        };
      } else {
        console.warn(`Hashroot mismatch for batch ${batchNumber}:
          Local:    ${localHashrootHex}
          On-chain: ${batchInfo.hashroot}`);
        
        // Still mark as processed to avoid redundant checks
        this.processedBatches.add(batchKey);
        return {
          success: false,
          error: new Error(`Batch ${batchNumber} hashroot mismatch`),
          message: 'Hashroot mismatch between local calculation and on-chain value'
        };
      }
    } catch (error) {
      console.error(`Error verifying batch ${batchNumber}:`, error);
      // Still mark as processed to avoid endless retries
      this.processedBatches.add(batchKey);
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
    this.smt = StandardMerkleTree.of(leaves, ['string', 'string']);
    
    // Get the SMT root
    const root = this.smt.root;
    return hexToBytes(root);
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
    const hr = typeof hashroot === 'string' ? hexToBytes(hashroot) : hashroot;

    return this.executeTransaction('submitHashroot', [bn, hr]);
  }

  /**
   * Process a batch by computing its hashroot and submitting it
   * @param batchNumber The batch number to process
   * @returns Result of the hashroot submission
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

      // Create leaf nodes for the Merkle Tree
      const leaves: [string, string][] = [];

      // Add all commitments as leaves
      for (const request of requests) {
        // Create a leaf value that combines payload and authenticator
        const key = request.requestID;
        const value = bytesToHex(
          ethers.concat([hexToBytes(request.payload), hexToBytes(request.authenticator)]),
        );

        // Add to leaves array
        leaves.push([key, value]);
      }

      // Create the Merkle Tree
      this.smt = StandardMerkleTree.of(leaves, ['string', 'string']);

      // Get the SMT root
      const root = this.smt.root;
      const rootBytes = hexToBytes(root);

      // Submit the hashroot
      const result = await this.submitHashroot(bn, rootBytes);
      
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
    
    // Process each unprocessed batch
    for (let i = latestProcessedBatchNumber + 1n; i <= latestBatchNumber; i++) {
      // Skip batches that have already been processed by this instance
      if (this.processedBatches.has(i.toString())) {
        console.log(`Skipping batch ${i} as it was already processed by this instance`);
        // Add a result to indicate this batch was skipped but previously processed
        results.push({
          success: true, // Count as success since we processed it before
          message: `Batch ${i} already processed by this instance`,
          skipped: true
        });
        continue;
      }
      
      try {
        console.log(`Processing batch ${i}...`);
        const result = await this.processBatch(i);
        results.push(result);
        
        if (!result.success) {
          console.log(`Note: Batch ${i} processing was not successful: ${result.error?.message}`);
        }
      } catch (error) {
        console.error(`Error processing batch ${i}:`, error);
        // Continue with next batch instead of throwing
        results.push({
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          message: `Failed to process batch ${i}`
        });
      }
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
   * Generate Merkle proof for a specific commitment in a processed batch
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

      // Create leaf nodes for the Merkle Tree
      const leaves: [string, string][] = [];

      // Add all commitments as leaves
      for (const req of requests) {
        const key = req.requestID;
        const value = bytesToHex(
          ethers.concat([hexToBytes(req.payload), hexToBytes(req.authenticator)]),
        );

        leaves.push([key, value]);
      }

      // Create the Merkle Tree
      this.smt = StandardMerkleTree.of(leaves, ['string', 'string']);

      // Find the leaf index
      let leafIndex = -1;
      for (const [i, v] of this.smt.entries()) {
        if (v[0] === id) {
          leafIndex = i;
          break;
        }
      }

      if (leafIndex === -1) {
        return null; // Leaf not found in tree
      }

      // Generate proof
      const proof = this.smt.getProof(leafIndex);

      return {
        proof: proof,
        value: leaves.find((leaf) => leaf[0] === id)?.[1] || '',
      };
    } catch (error) {
      console.error('Error generating Merkle proof:', error);
      return null;
    }
  }
}
