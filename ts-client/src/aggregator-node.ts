import { UniCityAnchorClient } from './client';
import {
  AggregatorConfig,
  CommitmentRequest,
  TransactionResult,
  EventType,
  SmtNode,
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

    // Start automatic batch processing if enabled
    if (autoProcessingEnabled) {
      this.startAutoBatchProcessing();
    }
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

      // First, check if this batch is already processed
      const latestProcessed = await this.getLatestProcessedBatchNumber();
      if (bn <= latestProcessed) {
        return {
          success: false,
          error: new Error(`Batch ${bn} is already processed`),
        };
      }

      // Next, check if this is the next batch to be processed
      if (bn !== latestProcessed + BigInt(1)) {
        return {
          success: false,
          error: new Error(
            `Batch ${bn} cannot be processed yet. Current processed batch: ${latestProcessed}`,
          ),
        };
      }

      // Get the batch data
      const { requests, processed } = await this.getBatch(bn);

      if (processed) {
        return {
          success: false,
          error: new Error(`Batch ${bn} is already processed`),
        };
      }

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
