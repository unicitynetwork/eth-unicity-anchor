import { ethers } from 'ethers';
import { UnicityAnchorClient } from './client';
import {
  ClientOptions,
  GatewayConfig,
  CommitmentRequest,
  CommitmentRequestDto,
  TransactionResult,
  EventType,
  Batch,
  BatchDto,
  AggregatorConfig,
} from './types';
import { bytesToHex, hexToBytes, convertDtoToCommitment } from './utils';
import { RequestId } from '@unicitylabs/commons/lib/api/RequestId.js';
import { DataHash } from '@unicitylabs/commons/lib/hash/DataHash.js';
import { Authenticator } from '@unicitylabs/commons/lib/api/Authenticator.js';
import { InclusionProof } from '@unicitylabs/commons/lib/api/InclusionProof.js';
import { Transaction } from '@unicitylabs/commons/lib/api/Transaction.js';
import { SparseMerkleTree } from '@unicitylabs/commons/lib/smt/SparseMerkleTree.js';
import { HashAlgorithm } from '@unicitylabs/commons/lib/hash/HashAlgorithm.js';
import { DataHasher } from '@unicitylabs/commons/lib/hash/DataHasher.js';

// Define a local Commitment class that implements CommitmentRequest
class Commitment implements CommitmentRequest {
  constructor(
    public requestID: RequestId,
    public payload: Uint8Array,
    public authenticator: Authenticator
  ) {}
}

/**
 * Authentication method for submitters
 */
export enum AuthMethod {
  JWT = 'jwt',
  API_KEY = 'api_key',
  ETHEREUM_SIGNATURE = 'ethereum_signature',
}

/**
 * Extended configuration for the gateway with authentication settings
 */
export interface AuthenticatedGatewayConfig extends GatewayConfig {
  authMethod?: AuthMethod;
  jwtSecret?: string;
  apiKeys?: Record<string, { 
    name: string;
    role: string;
    permissions: string[];
  }>;
  trustedSigners?: string[]; // List of trusted Ethereum addresses
  smtDepth?: number; // SMT tree depth
  autoProcessing?: number; // Auto processing interval in seconds
}

/**
 * Response type for commitment submission
 */
export enum SubmitCommitmentStatus {
  SUCCESS = 'SUCCESS',
  AUTHENTICATOR_VERIFICATION_FAILED = 'AUTHENTICATOR_VERIFICATION_FAILED',
  REQUEST_ID_MISMATCH = 'REQUEST_ID_MISMATCH',
  REQUEST_ID_EXISTS = 'REQUEST_ID_EXISTS',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  BATCH_CREATION_FAILED = 'BATCH_CREATION_FAILED',
  INVALID_REQUEST = 'INVALID_REQUEST',
}

/**
 * DTO for batch submission
 */
export interface BatchSubmissionDto {
  commitments: CommitmentRequestDto[];
  signature?: string; // Ethereum signature for authentication
  apiKey?: string;    // API key for authentication
  jwt?: string;       // JWT token for authentication
}

/**
 * Unified Aggregator Gateway client
 * Implements commitment and batch submission to the smart contract
 * and includes SMT functionality for inclusion proof generation
 */
export class AggregatorGatewayClient extends UnicityAnchorClient {
  private readonly gatewayAddress: string;
  private readonly batchCreationThreshold: number;
  private readonly batchCreationInterval: number;
  private batchCreationTimer?: NodeJS.Timeout;
  
  // Authentication properties
  private readonly authMethod?: AuthMethod;
  private readonly jwtSecret?: string;
  private readonly apiKeys?: Record<string, { name: string; role: string; permissions: string[] }>;
  private readonly trustedSigners?: string[];
  
  // SMT properties
  private readonly smtDepth: number;
  private smt: SparseMerkleTree | null = null;
  private processedBatches: Set<bigint> = new Set();
  private processedRequestIds: Set<string> = new Set();
  private requestDataMap: Map<string, { authenticator: Authenticator, transactionHash: DataHash }> = new Map();
  private lastFullyVerifiedBatch: bigint = 0n;
  
  // Batch processing properties
  private batchProcessingInterval: number;
  private batchProcessingTimer?: NodeJS.Timeout;
  private isProcessingBatch = false;

  constructor(config: AuthenticatedGatewayConfig) {
    super(config);
    this.gatewayAddress = config.gatewayAddress;
    this.batchCreationThreshold = config.batchCreationThreshold || 50;
    this.batchCreationInterval = config.batchCreationInterval || 5 * 60 * 1000; // 5 minutes default
    
    // Authentication setup
    this.authMethod = config.authMethod;
    this.jwtSecret = config.jwtSecret;
    this.apiKeys = config.apiKeys;
    this.trustedSigners = config.trustedSigners;
    
    // SMT setup
    this.smtDepth = config.smtDepth || 32;
    
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

    // Start automatic batch creation if enabled
    if (config.autoCreateBatches) {
      this.startAutoBatchCreation();
    }
    
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
   * Submit a commitment request to the contract
   * @param requestID The request ID
   * @param payload The payload data
   * @param authenticator The authenticator data
   * @returns Transaction result
   */
  public async submitCommitment(
    requestID: RequestId,
    payload: Uint8Array,
    authenticator: Authenticator,
  ): Promise<TransactionResult> {
    const requestIdHex = requestID.toDto();
    console.log(`Submitting commitment with requestID hex: ${requestIdHex}`);
    return this.executeTransaction('submitCommitment', [hexToBytes(requestIdHex), payload, authenticator.encode()]);
  }

  /**
   * Create a new batch from all unprocessed commitments
   * @returns The created batch number and transaction result
   */
  public async createBatch(): Promise<{ batchNumber: bigint; result: TransactionResult }> {
    const result = await this.executeTransaction('createBatch', []);
    const batchNumber = await this.getLatestBatchNumber();
    return { batchNumber, result };
  }

  /**
   * Create a new batch with specific request IDs
   * @param requestIDs Array of request IDs to include in the batch
   * @returns The created batch number and transaction result
   */
  public async createBatchForRequests(
    requestIDs: RequestId[],
  ): Promise<{ batchNumber: bigint; result: TransactionResult }> {
    // Convert string IDs to BigInt
    const ids = requestIDs.map((id) => (hexToBytes(id.toDto())));

    const result = await this.executeTransaction('createBatchForRequests', [ids]);

    // Get the latest batch number to return
    const batchNumber = await this.getLatestBatchNumber();

    return { batchNumber, result };
  }

  /**
   * Create a new batch with specific request IDs and an explicit batch number
   * @param requestIDs Array of request IDs to include in the batch
   * @param explicitBatchNumber The explicit batch number to use for this batch
   * @returns The created batch number and transaction result
   */
  public async createBatchForRequestsWithNumber(
    requestIDs: RequestId[],
    explicitBatchNumber: bigint,
  ): Promise<{ batchNumber: bigint; result: TransactionResult }> {
    // Convert string IDs to BigInt
    const ids = requestIDs;
    const batchNum = explicitBatchNumber;

    const result = await this.executeTransaction('createBatchForRequestsWithNumber', [ids, batchNum]);

    // Return the batch number (should be the same as the explicitBatchNumber if successful)
    return { batchNumber: batchNum, result };
  }

  /**
   * Start automatic batch creation based on threshold or interval
   */
  public startAutoBatchCreation(): void {
    if (this.batchCreationTimer) {
      clearInterval(this.batchCreationTimer);
    }

    // Create a batch when the timer fires
    this.batchCreationTimer = setInterval(async () => {
      try {
        // Check if there are enough unprocessed requests to create a batch
        const unprocessedCount = await this.getUnprocessedRequestCount();

        console.log(`Creating batch with ${unprocessedCount} unprocessed requests`);
        await this.createBatch();
      } catch (error) {
        console.error('Error in auto batch creation:', error);
      }
    }, this.batchCreationInterval);
  }

  /**
   * Stop automatic batch creation
   */
  public stopAutoBatchCreation(): void {
    if (this.batchCreationTimer) {
      clearInterval(this.batchCreationTimer);
      this.batchCreationTimer = undefined;
    }
  }

  /**
   * Validate a commitment request before submission
   * This can be extended with custom validation logic
   * @param request The commitment request to validate
   * @returns Boolean indicating if the request is valid
   */
  public async validateCommitment(request: CommitmentRequest): Promise<boolean> {
    if (!request.requestID) {
      return false;
    }

    if (!request.payload || request.payload.length === 0) {
      return false;
    }

    if (!(await request.authenticator?.verify(request.payload))) {
      return false;
    }

    // Get requestId from authenticator for comparison
    const calculatedRequestId = await request.authenticator.calculateRequestId();
    
    // Compare with the provided requestId
    if (!request.requestID.equals(calculatedRequestId)) {
      return false;
    }

    return true;
  }

  /**
   * Filter and validate an array of commitment requests
   * @param requests Array of commitment requests to validate
   * @returns Array of valid commitment requests
   */
  private async filterValidCommitments(
    requests: CommitmentRequest[]
  ): Promise<CommitmentRequest[]> {
    // Validate all requests
    const validRequests = [];
    for (const request of requests) {
      if (await this.validateCommitment(request)) {
        validRequests.push(request);
      }
    }
    
    return validRequests;
  }

  /**
   * Submit multiple commitments in a single transaction
   * @param requests Array of commitment requests to submit
   * @returns Transaction result with success count
   */
  public async submitCommitments(
    requests: CommitmentRequest[],
  ): Promise<{ successCount: bigint; result: TransactionResult }> {
    // Filter and validate requests
    const validRequests = await this.filterValidCommitments(requests);
    
    // Check if there are any valid requests
    if (validRequests.length === 0) {
      return {
        successCount: BigInt(0),
        result: {
          success: false,
          error: new Error('No valid commitment requests provided')
        }
      };
    }

    // Execute the transaction
    const result = await this.executeTransaction('submitCommitments', [validRequests]);
    
    // Get the success count from the transaction result
    // The executeTransaction method now extracts this from the RequestsSubmitted event
    const successCount = result.success && 'successCount' in result 
      ? result.successCount as bigint 
      : BigInt(0);
    
    return { successCount, result };
  }
  
  /**
   * Submit multiple commitments and create a batch with them in a single transaction
   * @param requests Array of commitment requests to submit
   * @returns Transaction result with batch number and success count
   */
  public async submitAndCreateBatch(
    requests: CommitmentRequest[],
  ): Promise<{ batchNumber: bigint; successCount: bigint; result: TransactionResult }> {
    // Filter and validate requests
    const validRequests = await this.filterValidCommitments(requests);
    
    // Check if there are any valid requests
    if (validRequests.length === 0) {
      return {
        batchNumber: BigInt(0),
        successCount: BigInt(0),
        result: {
          success: false,
          error: new Error('No valid commitment requests provided')
        }
      };
    }
    
    // Execute the transaction
    const result = await this.executeTransaction('submitAndCreateBatch', [validRequests]);
    
    // Get the returned values from the transaction result
    // The executeTransaction method now extracts these from events emitted by the contract
    let batchNumber = BigInt(0);
    let successCount = BigInt(0);
    
    if (result.success) {
      if ('batchNumber' in result) {
        batchNumber = result.batchNumber as bigint;
      }
      if ('successCount' in result) {
        successCount = result.successCount as bigint;
      }
    }
    
    return { batchNumber, successCount, result };
  }

  /**
   * Submit multiple commitments and create a batch with them with an explicit batch number
   * @param requests Array of commitment requests to submit
   * @param explicitBatchNumber The explicit batch number to use for this batch
   * @returns Transaction result with batch number and success count
   */
  public async submitAndCreateBatchWithNumber(
    requests: CommitmentRequest[],
    explicitBatchNumber: bigint,
  ): Promise<{ batchNumber: bigint; successCount: bigint; result: TransactionResult }> {
    // Filter and validate requests
    const validRequests = await this.filterValidCommitments(requests);
    
    // Check if there are any valid requests
    if (validRequests.length === 0) {
      return {
        batchNumber: BigInt(0),
        successCount: BigInt(0),
        result: {
          success: false,
          error: new Error('No valid commitment requests provided')
        }
      };
    }
    
    const batchNum = explicitBatchNumber;
    
    // Execute the transaction
    const result = await this.executeTransaction('submitAndCreateBatchWithNumber', [validRequests, batchNum]);
    
    // Get the returned values from the transaction result
    let batchNumber = BigInt(0);
    let successCount = BigInt(0);
    
    if (result.success) {
      // For explicit batch numbering, if the transaction was successful,
      // the batch number is guaranteed to be the one we specified
      batchNumber = batchNum;
      
      // Try to get successCount if available in the result
      if ('successCount' in result) {
        successCount = result.successCount as bigint;
      }
    }
    
    return { batchNumber, successCount, result };
  }

  /**
   * Process a batch by generating a hashroot and submitting it to the contract
   * Uses a persistent SMT that accumulates all requests
   * @param batchNumber The batch number to process
   * @returns Transaction result
   */
  public async processBatch(batchNumber: bigint): Promise<TransactionResult> {
    try {
      // First check if this batch has already been processed by this instance
      if (this.processedBatches.has(batchNumber)) {
        return {
          success: false,
          error: new Error(`Batch ${batchNumber} is already processed by this instance`),
          skipped: true
        };
      }
      
      // Check if the batch is already processed on-chain
      const batchInfo = await this.getBatch(batchNumber);
      if (batchInfo.processed) {
        console.log(`Batch ${batchNumber} is already processed on-chain. Verifying locally...`);
        return this.verifyProcessedBatch(batchNumber, batchInfo);
      }
      
      // Check if we can process this batch (must be the next one after the latest processed)
      const latestProcessed = await this.getLatestProcessedBatchNumber();
      if (batchNumber > latestProcessed + BigInt(1)) {
        return {
          success: false,
          error: new Error(
            `Batch ${batchNumber} cannot be processed yet. Current processed batch: ${latestProcessed}`,
          ),
        };
      }

      // Get the batch data to get the requests
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
        // Get the requestId as string for tracking
        const requestIdStr = request.requestID.toDto();
        
        // Skip already processed requests
        if (this.processedRequestIds.has(requestIdStr)) {
          console.log(`Skipping already processed request ${requestIdStr}`);
          skippedCount++;
          continue;
        }
        
        // Create DataHash from the transaction hash
        const txDataHash = request.payload;
        
        // Create a Transaction object that handles the leaf value computation
        const transaction = await Transaction.create(request.authenticator, txDataHash);
        
        console.log(`Created transaction with leaf value for request ${requestIdStr}`);
        
        // Add the leaf to the SMT using BigInt from RequestId
        await this.smt.addLeaf(request.requestID.toBigInt(), transaction.leafValue.imprint);
        
        // Mark as processed using string representation for tracking
        this.processedRequestIds.add(requestIdStr);
        
        // Store the original request data for inclusion proof generation
        this.requestDataMap.set(requestIdStr, {
          authenticator: request.authenticator,
          transactionHash: txDataHash
        });
        
        addedCount++;
        
        console.log(`Added leaf for request ${requestIdStr}`);
      }
      
      console.log(`Processed ${requests.length} requests: ${addedCount} added, ${skippedCount} skipped`);
      console.log(`Total unique requests in SMT: ${this.processedRequestIds.size}`);
      
      // Get the root hash
      const rootHashData = this.smt.rootHash;
      console.log(`Generated hashroot with ${rootHashData.length} bytes`);

      // Submit the hashroot
      const result = await this.submitHashroot(batchNumber, rootHashData);
      
      // If successful, add to processed batches to avoid duplicate processing
      if (result.success) {
        this.processedBatches.add(batchNumber);
        console.log(`Batch ${batchNumber} processed successfully and added to processed list`);
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
   * Verify a batch that has already been processed on-chain
   * Compares our calculated hashroot with what's recorded on-chain
   * @param batchNumber The batch number to verify
   * @param batchInfo The batch information
   * @returns Transaction result
   */
  protected async verifyProcessedBatch(
    batchNumber: bigint,
    batchInfo: { processed: boolean; hashroot?: string; requests: Array<any> }
  ): Promise<TransactionResult> {
    // If already processed locally, no need to verify again
    if (this.processedBatches.has(batchNumber)) {
      return {
        success: false,
        error: new Error(`Batch ${batchNumber} is already processed`),
      };
    }
    
    // If no hashroot, we can't verify
    if (!batchInfo.hashroot) {
      console.warn(`Batch ${batchNumber} is marked as processed but has no hashroot`);
      this.processedBatches.add(batchNumber);
      return {
        success: false,
        error: new Error(`Batch ${batchNumber} has no hashroot to verify`),
      };
    }
    
    // Calculate the hashroot locally and compare
    try {
      const localHashroot = await this.calculateHashroot(batchInfo.requests);
      const onChainHashroot = new DataHash(Buffer.from(batchInfo.hashroot.replace(/^0x/, ''), 'hex'));
      
      // Use the consensus verification function
      const consensusResult = await this.verifyHashrootConsensus(
        batchNumber, 
        localHashroot, 
        onChainHashroot
      );
      
      if (consensusResult.success) {
        console.log(`Hashroot verification successful for batch ${batchNumber}`);
        this.processedBatches.add(batchNumber);
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
        this.processedBatches.add(batchNumber);
      }
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        message: `Error verifying batch ${batchNumber}`
      };
    }
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
      if (this.processedBatches.has(nextBatchToProcess)) {
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
        if (this.processedBatches.has(data.batchNumber)) {
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
   * Calculate hashroot for a set of requests
   * Used for validation during sync
   * @param requests The requests to calculate hashroot for
   * @returns The calculated hashroot
   */
  protected async calculateHashroot(requests: Array<any>): Promise<DataHash> {
    console.log(`[Hashroot] Calculating hashroot for ${requests.length} requests`);
    
    // Create the SMT if it doesn't exist yet
    if (!this.smt) {
      console.log(`[Hashroot] Creating new SMT instance for the first time`);
      this.smt = await SparseMerkleTree.create(HashAlgorithm.SHA256);
      console.log(`[Hashroot] SMT created successfully`);
    } else {
      // Clear any existing leaves for a fresh calculation
      this.smt = await SparseMerkleTree.create(HashAlgorithm.SHA256);
    }
    
    // Add all commitments as leaves
    for (const request of requests) {
      // Get the requestId as string for tracking
      const requestIdStr = request.requestID.toDto();
      
      // Create DataHash from the transaction hash
      const txDataHash = request.payload;
      
      // Create a Transaction object that handles the leaf value computation
      const transaction = await Transaction.create(request.authenticator, txDataHash);
      
      // Log leaf data for debugging
      console.log(`[Hashroot] Adding leaf for requestId ${requestIdStr}...`);
      
      // Add the leaf to the SMT using BigInt from RequestId
      await this.smt.addLeaf(request.requestID.toBigInt(), transaction.leafValue.imprint);
      
      // Store the data for inclusion proofs
      this.processedRequestIds.add(requestIdStr);
      this.requestDataMap.set(requestIdStr, {
        authenticator: request.authenticator,
        transactionHash: txDataHash
      });
    }
    
    // Get the root hash
    const rootHashData = this.smt.rootHash;
    console.log(`[Hashroot] Generated hashroot: ${rootHashData}`);
    
    return rootHashData;
  }

  /**
   * Verify hashroot consensus for a batch
   * @param batchNumber The batch number
   * @param localHashroot Our locally calculated hashroot
   * @param onChainHashroot Hashroot from the blockchain
   * @returns Result of consensus verification
   */
  protected async verifyHashrootConsensus(
    batchNumber: bigint, 
    localHashroot: DataHash,
    onChainHashroot: DataHash
  ): Promise<{success: boolean; error?: Error; critical?: boolean; waitForConsensus?: boolean; testOverride?: boolean}> {
    // Convert to hex string for comparison
    const localHashrootHex = localHashroot.toDto();
    
    // Standardize the on-chain value in case of format differences
    const normalizedOnChainHashroot = onChainHashroot.toDto();
    
    console.log(`[Consensus] Comparing hashrooots for batch ${batchNumber}:`);
    console.log(`[Consensus] Local calculated: ${localHashrootHex}`);
    console.log(`[Consensus] On-chain value: ${normalizedOnChainHashroot}`);
    
    // Check if our hashroot matches the on-chain value (checking both with and without 0x prefix)
    if (localHashrootHex !== normalizedOnChainHashroot && 
        localHashrootHex.replace('0x', '') !== normalizedOnChainHashroot.replace('0x', '')) {
      
      // CRITICAL SECURITY ALERT - Data integrity failure
      console.error(`[Sync] CRITICAL SECURITY FAILURE: Hashroot mismatch detected for batch ${batchNumber}:`);
      console.error(`[Sync] Local calculated: ${localHashrootHex}`);
      console.error(`[Sync] On-chain value:   ${normalizedOnChainHashroot}`);
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
        
        // In test mode, check if this is a test mismatch that should be accepted
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
    
    // If we get here, the hashroots match
    return { success: true };
  }

  /**
   * Submit a hashroot for a batch
   * @param batchNumber The batch number
   * @param hashroot The hashroot to submit
   * @returns Transaction result
   */
  public async submitHashroot(
    batchNumber: bigint,
    hashroot: DataHash,
  ): Promise<TransactionResult> {
    const bn = batchNumber;
    
    console.log(`[HashRoot] Submitting hashroot for batch ${bn}`);
    console.log(`[HashRoot] Hashroot value: ${hashroot.toDto()}`);
    
    // Extract the hashroot data properly for the contract
    let hashrootData: Uint8Array;
    if (typeof hashroot.imprint === 'function') {
      hashrootData = hashroot.imprint();
    } else {
      hashrootData = hashroot.imprint;
    }
    
    // The executeTransaction method handles the transaction
    return this.executeTransaction('submitHashroot', [bn, hashrootData]);
  }

  /**
   * Synchronize with on-chain state by processing all batches that have been 
   * processed on-chain but not by this instance
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
        if (this.processedBatches.has(i)) {
          console.log(`Already processed batch ${i}, skipping... `);
          continue;
        }
        
        try {
          console.log(`[Sync] Syncing to already processed batch ${i} to verify hashroot`);
          const batch = await this.getBatch(i);
          
          if (!batch.processed || !batch.hashroot) {
            throw new Error(`[Sync] Batch ${i} is marked as processed on-chain but has no hashroot, critical integrity failure`);
          }
          
          // Calculate the hashroot locally
          const localHashroot = await this.calculateHashroot(batch.requests);
          
          // Compare with on-chain hashroot
          const onChainHashroot = new DataHash(Buffer.from(batch.hashroot.replace(/^0x/, ''), 'hex'));
          
          // Verify consensus
          const consensusResult = await this.verifyHashrootConsensus(i, localHashroot, onChainHashroot);
          
          if (consensusResult.success) {
            console.log(`[Sync] Batch ${i} hashroot verified successfully`);
            // Add to processed batches since we've verified it
            this.processedBatches.add(i);
            syncedBatchCount++;
          } else if (consensusResult.critical) {
            // Critical error - this is handled in verifyHashrootConsensus
            throw consensusResult.error || new Error('Critical hashroot mismatch');
          }
        } catch (error) {
          console.error(`[Sync] Error processing batch ${i}:`, error);
          
          // Check if this is a critical error
          if (error instanceof Error && 
              (error.message.includes('CRITICAL') || 
               error.message.includes('integrity'))) {
            throw error; // Re-throw critical errors
          }
          
          // Continue with next batch for non-critical errors
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
   * Get an inclusion proof for a specific request ID
   * @param requestId The request ID to get proof for
   * @returns The inclusion proof or null if not found
   */
  public async getInclusionProof(requestId: RequestId | string): Promise<any> {
    let requestIdObj: RequestId;
    
    // Convert string to RequestId if needed
    if (typeof requestId === 'string') {
      requestIdObj = await RequestId.create(requestId);
    } else {
      requestIdObj = requestId;
    }
    
    const requestIdStr = requestIdObj.toDto();
    console.log(`Getting inclusion proof for requestId ${requestIdStr}`);
    
    // Check if we have an SMT initialized
    if (!this.smt) {
      console.error(`No SMT initialized yet, cannot generate proof`);
      return null;
    }
    
    try {
      // Generate the proof using the SMT's getPath method with BigInt from RequestId
      // This will return a proper Merkle path whether the leaf exists or not
      const proof = this.smt.getPath(requestIdObj.toBigInt());
      
      // Determine if this is a positive or negative inclusion proof
      const isPositiveProof = this.processedRequestIds.has(requestIdStr);
      console.log(`Generated ${isPositiveProof ? 'positive' : 'negative'} inclusion proof with ${proof.steps.length} steps`);
      
      // Get the original request data (if available)
      const originalData = this.requestDataMap.get(requestIdStr);
      
      if (originalData) {
        console.log(`Found original data for requestId ${requestIdStr}`);
        // Attach the original data to the proof object
        proof.leafData = originalData;
      } else {
        console.log(`No original data found for requestId ${requestIdStr}`);
      }
      
      return proof;
    } catch (error) {
      console.error(`Error generating inclusion proof for requestId:`, error);
      return null;
    }
  }

  /**
   * Authenticate a request based on the configured method
   * @param authData Authentication data
   * @returns Whether authentication was successful
   */
  private async authenticate(authData: { 
    apiKey?: string; 
    jwt?: string; 
    signature?: { 
      message: string; 
      signature: string; 
      signer: string; 
    } 
  }): Promise<boolean> {
    if (!this.authMethod) {
      return true; // No authentication configured
    }
    
    switch (this.authMethod) {
      case AuthMethod.API_KEY:
        return this.authenticateApiKey(authData.apiKey);
      
      case AuthMethod.JWT:
        return this.authenticateJWT(authData.jwt);
      
      case AuthMethod.ETHEREUM_SIGNATURE:
        return this.authenticateSignature(
          authData.signature?.message,
          authData.signature?.signature,
          authData.signature?.signer
        );
      
      default:
        return false;
    }
  }

  /**
   * Authenticate using API key
   * @param apiKey API key to validate
   * @returns Whether API key is valid
   */
  private authenticateApiKey(apiKey?: string): boolean {
    if (!apiKey || !this.apiKeys) {
      return false;
    }
    
    // Check if the API key exists and has the required permissions
    const keyData = this.apiKeys[apiKey];
    if (!keyData) {
      return false;
    }
    
    // Check if the key has batch submission permission
    return keyData.permissions.includes('batch:submit');
  }

  /**
   * Authenticate using JWT token
   * @param jwt JWT token to validate
   * @returns Whether JWT is valid
   */
  private authenticateJWT(jwt?: string): boolean {
    if (!jwt || !this.jwtSecret) {
      return false;
    }
    
    try {
      // This is a simplified JWT verification
      // In a production environment, use a proper JWT library
      const [header, payload, signature] = jwt.split('.');
      
      // Verify signature (simplified)
      const verifySignature = (header: string, payload: string, secret: string) => {
        const data = `${header}.${payload}`;
        const expectedSignature = crypto
          .createHmac('sha256', secret)
          .update(data)
          .digest('base64url');
        return expectedSignature === signature;
      };
      
      if (!verifySignature(header, payload, this.jwtSecret)) {
        return false;
      }
      
      // Decode payload
      const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString());
      
      // Check expiration
      if (decodedPayload.exp && decodedPayload.exp < Math.floor(Date.now() / 1000)) {
        return false;
      }
      
      // Check permissions
      return decodedPayload.permissions?.includes('batch:submit') || false;
      
    } catch (error) {
      console.error('JWT authentication error:', error);
      return false;
    }
  }

  /**
   * Authenticate using Ethereum signature
   * @param message Message that was signed
   * @param signature Ethereum signature
   * @param signer Address that signed the message
   * @returns Whether signature is valid and from a trusted signer
   */
  private authenticateSignature(
    message?: string,
    signature?: string,
    signer?: string
  ): boolean {
    if (!message || !signature || !signer || !this.trustedSigners) {
      return false;
    }
    
    try {
      // Verify the signature recovers to the expected signer
      const recoveredAddress = ethers.verifyMessage(message, signature);
      
      // Check if signer matches and is in the trusted signers list
      return (
        recoveredAddress.toLowerCase() === signer.toLowerCase() &&
        this.trustedSigners.some(
          addr => addr.toLowerCase() === signer.toLowerCase()
        )
      );
    } catch (error) {
      console.error('Signature verification error:', error);
      return false;
    }
  }
}