import { UniCityAnchorClient } from './client';
import { AggregatorConfig, CommitmentRequest, TransactionResult, EventType, SmtNode } from './types';
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
  private smt: any; // Will be initialized when needed

  constructor(config: AggregatorConfig) {
    super(config);
    this.aggregatorAddress = config.aggregatorAddress;
    this.smtDepth = config.smtDepth || 32; // Default to 32 levels for SMT
    this.batchProcessingInterval = config.batchProcessingInterval || 5 * 60 * 1000; // 5 minutes default
    
    // Will initialize the Merkle Tree when processing batches

    // Start automatic batch processing if enabled
    if (config.autoProcessBatches) {
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
    hashroot: Uint8Array | string
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
          error: new Error(`Batch ${bn} is already processed`)
        };
      }
      
      // Next, check if this is the next batch to be processed
      if (bn !== latestProcessed + BigInt(1)) {
        return {
          success: false,
          error: new Error(`Batch ${bn} cannot be processed yet. Current processed batch: ${latestProcessed}`)
        };
      }
      
      // Get the batch data
      const { requests, processed } = await this.getBatch(bn);
      
      if (processed) {
        return {
          success: false,
          error: new Error(`Batch ${bn} is already processed`)
        };
      }
      
      // Create leaf nodes for the Merkle Tree
      const leaves: [string, string][] = [];
      
      // Add all commitments as leaves
      for (const request of requests) {
        // Create a leaf value that combines payload and authenticator
        const key = request.requestID;
        const value = bytesToHex(ethers.concat([
          hexToBytes(request.payload),
          hexToBytes(request.authenticator)
        ]));
        
        // Add to leaves array
        leaves.push([key, value]);
      }
      
      // Create the Merkle Tree
      this.smt = StandardMerkleTree.of(leaves, ["string", "string"]);
      
      // Get the SMT root
      const root = this.smt.root;
      const rootBytes = hexToBytes(root);
      
      // Submit the hashroot
      return await this.submitHashroot(bn, rootBytes);
    } catch (error: any) {
      return {
        success: false,
        error: new Error(`Error processing batch: ${error.message}`)
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
   * Start automatic batch processing
   */
  public startAutoBatchProcessing(): void {
    if (this.batchProcessingTimer) {
      clearInterval(this.batchProcessingTimer);
    }

    // Process batches when the timer fires
    this.batchProcessingTimer = setInterval(async () => {
      try {
        const latestProcessed = await this.getLatestProcessedBatchNumber();
        const latestBatch = await this.getLatestBatchNumber();
        
        if (latestBatch > latestProcessed) {
          const nextBatchToProcess = latestProcessed + BigInt(1);
          console.log(`Processing batch ${nextBatchToProcess}`);
          await this.processBatch(nextBatchToProcess);
        } else {
          console.log('No unprocessed batches available');
        }
      } catch (error) {
        console.error('Error in auto batch processing:', error);
      }
    }, this.batchProcessingInterval);

    // Also listen for new batch created events to process them
    this.on(EventType.BatchCreated, async (_, data: { batchNumber: bigint }) => {
      try {
        const latestProcessed = await this.getLatestProcessedBatchNumber();
        
        // Check if this is the next batch to process
        if (data.batchNumber === latestProcessed + BigInt(1)) {
          console.log(`New batch ${data.batchNumber} created. Processing...`);
          await this.processBatch(data.batchNumber);
        } else {
          console.log(`New batch ${data.batchNumber} created, but not next in sequence. Current processed: ${latestProcessed}`);
        }
      } catch (error) {
        console.error('Error in event-triggered batch processing:', error);
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
    requestID: bigint | string
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
      const request = requests.find(r => r.requestID === id);
      if (!request) {
        return null; // Request not found in this batch
      }
      
      // Create leaf nodes for the Merkle Tree
      const leaves: [string, string][] = [];
      
      // Add all commitments as leaves
      for (const req of requests) {
        const key = req.requestID;
        const value = bytesToHex(ethers.concat([
          hexToBytes(req.payload),
          hexToBytes(req.authenticator)
        ]));
        
        leaves.push([key, value]);
      }
      
      // Create the Merkle Tree
      this.smt = StandardMerkleTree.of(leaves, ["string", "string"]);
      
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
        value: leaves.find(leaf => leaf[0] === id)?.[1] || ''
      };
    } catch (error) {
      console.error('Error generating Merkle proof:', error);
      return null;
    }
  }
}