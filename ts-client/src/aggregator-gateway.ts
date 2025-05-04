import { ethers } from 'ethers';
import { UniCityAnchorClient } from './client';
import {
  ClientOptions,
  GatewayConfig,
  CommitmentRequest,
  CommitmentRequestDto,
  TransactionResult,
  EventType,
  Batch,
  BatchDto,
} from './types';
import { bytesToHex, hexToBytes, convertDtoToCommitment } from './utils';
import { RequestId } from '@unicitylabs/commons/lib/api/RequestId.js';
import { DataHash } from '@unicitylabs/commons/lib/hash/DataHash.js';
import { Authenticator } from '@unicitylabs/commons/lib/api/Authenticator.js';
import { InclusionProof } from '@unicitylabs/commons/lib/api/InclusionProof.js';
import { Transaction } from '@unicitylabs/commons/lib/api/Transaction.js';
import crypto from 'crypto';
import { SparseMerkleTree } from '@unicitylabs/commons/lib/smt/SparseMerkleTree.js';
import { HashAlgorithm } from '@unicitylabs/commons/lib/hash/HashAlgorithm.js';

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
  authMethod: AuthMethod;
  jwtSecret?: string;
  apiKeys?: Record<string, { 
    name: string;
    role: string;
    permissions: string[];
  }>;
  trustedSigners?: string[]; // List of trusted Ethereum addresses
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

// Intermin solution for JSON encodding into byte array
const jsonToUint8Array = (jsonInput: string | object): Uint8Array => new TextEncoder().encode(typeof jsonInput === 'string' ? JSON.stringify(JSON.parse(jsonInput)) : JSON.stringify(jsonInput));
const uint8ArrayToJsonObject = (uint8Array: Uint8Array): any => JSON.parse(new TextDecoder().decode(uint8Array));

/**
 * Aggregator Gateway client
 * Implements the same interface as the aggregators_net repository
 * with added methods for batch operations and authentication
 */
// Original AggregatorGatewayClient implementation (kept for backward compatibility)
export class AggregatorGatewayClient extends UniCityAnchorClient {
  private readonly gatewayAddress: string;
  private readonly batchCreationThreshold: number;
  private readonly batchCreationInterval: number;
  private batchCreationTimer?: NodeJS.Timeout;

  constructor(config: GatewayConfig) {
    super(config);
    this.gatewayAddress = config.gatewayAddress;
    this.batchCreationThreshold = config.batchCreationThreshold || 50;
    this.batchCreationInterval = config.batchCreationInterval || 5 * 60 * 1000; // 5 minutes default

    // Start automatic batch creation if enabled
    if (config.autoCreateBatches) {
      this.startAutoBatchCreation();
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
    // Get the next auto-numbered batch before creating the batch
    // This is the batch number that will be used to fill the gap
    const nextAutoNumberedBatch = await this.getNextAutoNumberedBatch();
    
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
  public validateCommitment(request: CommitmentRequest): boolean {
    if (!request.requestID) {
      return false;
    }

    if (!request.payload || request.payload.length === 0) {
      return false;
    }

    if (!(await request?.authenticator?.verify(request.payload))) {
      return false;
    }

    if(!request)

    return true;
  }

  /**
   * Submit multiple commitments in a single transaction
   * @param requests Array of commitment requests to submit
   * @returns Transaction result with success count
   */
  public async submitCommitments(
    requests: CommitmentRequest[],
  ): Promise<{ successCount: bigint; result: TransactionResult }> {
    // Validate all requests first
    const validRequests = requests.filter(request => this.validateCommitment(request));
    
    if (validRequests.length === 0) {
      return {
        successCount: BigInt(0),
        result: {
          success: false,
          error: new Error('No valid commitment requests provided')
        }
      };
    }
    
    // Convert to contract format
    const contractRequests = validRequests.map(request => ({
      requestID: typeof request.requestID === 'string' ? BigInt(request.requestID) : request.requestID,
      payload: typeof request.payload === 'string' ? new TextEncoder().encode(request.payload) : request.payload,
      authenticator: typeof request.authenticator === 'string' ? 
        new TextEncoder().encode(request.authenticator) : request.authenticator
    }));
    
    // Execute the transaction
    const result = await this.executeTransaction('submitCommitments', [contractRequests]);
    
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
    // Validate all requests first
    const validRequests = requests.filter(request => this.validateCommitment(request));
    
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
    
    // Convert to contract format
    const contractRequests = validRequests.map(request => ({
      requestID: typeof request.requestID === 'string' ? BigInt(request.requestID) : request.requestID,
      payload: typeof request.payload === 'string' ? new TextEncoder().encode(request.payload) : request.payload,
      authenticator: typeof request.authenticator === 'string' ? 
        new TextEncoder().encode(request.authenticator) : request.authenticator
    }));
    
    // Execute the transaction
    const result = await this.executeTransaction('submitAndCreateBatch', [contractRequests]);
    
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
    explicitBatchNumber: bigint | string,
  ): Promise<{ batchNumber: bigint; successCount: bigint; result: TransactionResult }> {
    // Validate all requests first
    const validRequests = requests.filter(request => this.validateCommitment(request));
    
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
    
    // Convert to contract format
    const contractRequests = validRequests.map(request => ({
      requestID: typeof request.requestID === 'string' ? BigInt(request.requestID) : request.requestID,
      payload: typeof request.payload === 'string' ? new TextEncoder().encode(request.payload) : request.payload,
      authenticator: typeof request.authenticator === 'string' ? 
        new TextEncoder().encode(request.authenticator) : request.authenticator
    }));
    
    const batchNum = typeof explicitBatchNumber === 'string' ? BigInt(explicitBatchNumber) : explicitBatchNumber;
    
    // Execute the transaction
    const result = await this.executeTransaction('submitAndCreateBatchWithNumber', [contractRequests, batchNum]);
    
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
   * Process multiple commitment requests individually (legacy method)
   * @param requests Array of commitment requests to submit
   * @returns Array of results for each submission
   * @deprecated Use submitCommitments instead for better gas efficiency
   */
  public async submitMultipleCommitments(
    requests: CommitmentRequest[],
  ): Promise<{ requestID: RequestId; result: TransactionResult }[]> {
    console.warn('submitMultipleCommitments is deprecated. Use submitCommitments for better gas efficiency.');
    
    const results: { requestID: RequestId; result: TransactionResult }[] = [];

    for (const request of requests) {
      if (this.validateCommitment(request)) {
        const result = await this.submitCommitment(
          request.requestID,
          request.payload,
          request.authenticator,
        );

        results.push({ requestID: request.requestID, result });
      } else {
        results.push({
          requestID: request.requestID,
          result: {
            success: false,
            error: new Error('Invalid commitment request'),
          },
        });
      }
    }

    return results;
  }
}

// Enhanced AggregatorGateway implementation with the aggregators_net interface
export class AggregatorGateway extends UniCityAnchorClient {
  private readonly gatewayAddress: string;
  private readonly batchCreationThreshold: number;
  private readonly batchCreationInterval: number;
  private batchCreationTimer?: NodeJS.Timeout;
  private pendingCommitments: Commitment[] = [];
  private readonly authMethod: AuthMethod;
  private readonly jwtSecret?: string;
  private readonly apiKeys?: Record<string, { name: string; role: string; permissions: string[] }>;
  private readonly trustedSigners?: string[];
  private smt: SparseMerkleTree | null = null;
  
  /**
   * Create a new Aggregator Gateway client
   * @param config Configuration for the gateway
   */
  constructor(config: AuthenticatedGatewayConfig) {
    super(config);
    this.gatewayAddress = config.gatewayAddress;
    this.batchCreationThreshold = config.batchCreationThreshold || 100;
    this.batchCreationInterval = config.batchCreationInterval || 60 * 1000; // Default to 1 minute
    this.authMethod = config.authMethod || AuthMethod.API_KEY;
    this.jwtSecret = config.jwtSecret;
    this.apiKeys = config.apiKeys;
    this.trustedSigners = config.trustedSigners;

    // SMT will be initialized when needed
    this.smt = null;

    // Start automatic batch creation if enabled
    if (config.autoCreateBatches) {
      this.startAutoBatchCreation();
    }
  }

  /**
   * Submit a single commitment
   * Compatible with the aggregators_net interface
   * @param request Commitment data with request ID, transaction hash and authenticator
   * @param authToken Authentication token (optional, depending on auth method)
   * @returns Response with status
   */
  public async submitCommitment(
    request: { 
      requestId: string; 
      transactionHash: string; 
      authenticator: { 
        publicKey: string; 
        stateHash: string; 
        signature: string; 
      } 
    },
    authToken?: string
  ): Promise<{ status: SubmitCommitmentStatus }> {
    // Authenticate if required
    if (this.authMethod === AuthMethod.JWT && !this.authenticateJWT(authToken)) {
      return { status: SubmitCommitmentStatus.AUTHENTICATION_FAILED };
    }

    try {
      // Convert to internal types
      const requestId = await RequestId.create(request.requestId);
      const transactionHash = new DataHash(Buffer.from(request.transactionHash, 'hex'));
      const authenticator = new Authenticator(
        Buffer.from(request.authenticator.publicKey, 'hex'),
        Buffer.from(request.authenticator.stateHash, 'hex'),
        Buffer.from(request.authenticator.signature, 'hex')
      );

      // Validate the commitment
      const validationResult = await this.validateCommitment(requestId, transactionHash, authenticator);
      if (validationResult !== SubmitCommitmentStatus.SUCCESS) {
        return { status: validationResult };
      }

      // Create and store the commitment
      const commitment = new Commitment(requestId, transactionHash, authenticator);
      
      // Add to pending queue
      this.pendingCommitments.push(commitment);

      // Process immediately if threshold is reached
      if (this.pendingCommitments.length >= this.batchCreationThreshold) {
        await this.processPendingCommitments();
      }

      return { status: SubmitCommitmentStatus.SUCCESS };
    } catch (error) {
      console.error('Error submitting commitment:', error);
      return { status: SubmitCommitmentStatus.INVALID_REQUEST };
    }
  }

  /**
   * NEW METHOD: Submit multiple commitments in a single call
   * @param requests Array of commitment requests
   * @param authData Authentication data (varies by auth method)
   * @returns Response with status and counts
   */
  public async submitMultipleCommitments(
    requests: { 
      requestId: string; 
      transactionHash: string; 
      authenticator: { 
        publicKey: string; 
        stateHash: string; 
        signature: string; 
      } 
    }[],
    authData: { 
      apiKey?: string; 
      jwt?: string; 
      signature?: { 
        message: string; 
        signature: string; 
        signer: string; 
      } 
    }
  ): Promise<{ 
    status: SubmitCommitmentStatus; 
    processedCount: number;
    failedCount: number;
    batchCreated: boolean;
    batchNumber?: bigint;
  }> {
    // Authenticate based on the configured method
    const isAuthenticated = await this.authenticate(authData);
    if (!isAuthenticated) {
      return { 
        status: SubmitCommitmentStatus.AUTHENTICATION_FAILED,
        processedCount: 0,
        failedCount: requests.length,
        batchCreated: false
      };
    }

    try {
      let processedCount = 0;
      let failedCount = 0;

      // Process each commitment request
      for (const request of requests) {
        // Convert to internal types
        const requestId = await RequestId.create(request.requestId);
        const transactionHash = new DataHash(Buffer.from(request.transactionHash, 'hex'));
        const authenticator = new Authenticator(
          Buffer.from(request.authenticator.publicKey, 'hex'),
          Buffer.from(request.authenticator.stateHash, 'hex'),
          Buffer.from(request.authenticator.signature, 'hex')
        );

        // Validate the commitment
        const validationResult = await this.validateCommitment(requestId, transactionHash, authenticator);
        if (validationResult === SubmitCommitmentStatus.SUCCESS) {
          // Create and store the commitment
          const commitment = new Commitment(requestId, transactionHash, authenticator);
          this.pendingCommitments.push(commitment);
          processedCount++;
        } else {
          failedCount++;
        }
      }

      // Create a batch if we reached the threshold or processed all requests
      let batchCreated = false;
      let batchNumber: bigint | undefined;

      if (this.pendingCommitments.length >= this.batchCreationThreshold) {
        const result = await this.processPendingCommitments();
        batchCreated = result.success;
        batchNumber = result.batchNumber;
      }

      return {
        status: processedCount > 0 ? SubmitCommitmentStatus.SUCCESS : SubmitCommitmentStatus.INVALID_REQUEST,
        processedCount,
        failedCount,
        batchCreated,
        batchNumber
      };
    } catch (error) {
      console.error('Error submitting multiple commitments:', error);
      return {
        status: SubmitCommitmentStatus.INVALID_REQUEST,
        processedCount: 0,
        failedCount: requests.length,
        batchCreated: false
      };
    }
  }

  /**
   * NEW METHOD: Submit an entire batch directly
   * @param batch The batch data with commitments
   * @param authData Authentication data
   * @returns Transaction result
   */
  public async submitBatch(
    batch: BatchSubmissionDto,
    authData: { 
      apiKey?: string; 
      jwt?: string; 
      signature?: { 
        message: string; 
        signature: string; 
        signer: string; 
      } 
    }
  ): Promise<TransactionResult> {
    // Authenticate based on the configured method
    const isAuthenticated = await this.authenticate(authData);
    if (!isAuthenticated) {
      return {
        success: false,
        error: new Error('Authentication failed'),
        message: 'The provided authentication credentials are invalid',
      };
    }

    try {
      // Convert all commitments to internal format
      const commitments: Commitment[] = [];
      
      for (const commitmentDto of batch.commitments) {
        // Convert from DTO to internal types
        const requestId = await RequestId.create(commitmentDto.requestID);
        const transactionHash = new DataHash(Buffer.from(hexToBytes(commitmentDto.payload)));
        
        // Extract authenticator parts from combined format
        // This is a simplified approach - adapt based on your actual format
        const authBytes = hexToBytes(commitmentDto.authenticator);
        const publicKey = authBytes.slice(0, 32);
        const stateHash = authBytes.slice(32, 64);
        const signature = authBytes.slice(64);
        
        const authenticator = new Authenticator(
          Buffer.from(publicKey),
          Buffer.from(stateHash),
          Buffer.from(signature)
        );
        
        commitments.push(new Commitment(requestId, transactionHash, authenticator));
      }

      // Reset pending commitments and add the batch directly
      this.pendingCommitments = [];
      this.pendingCommitments.push(...commitments);

      // Process the batch immediately
      return await this.processPendingCommitments();
    } catch (error: any) {
      return {
        success: false,
        error: new Error(`Error submitting batch: ${error.message}`),
        message: 'Failed to process the submitted batch',
      };
    }
  }
  
  /**
   * Submit batch with explicit batch number
   * @param batch The batch data with commitments
   * @param explicitBatchNumber The explicit batch number to use
   * @param authData Authentication data
   * @returns Transaction result
   */
  public async submitBatchWithNumber(
    batch: BatchSubmissionDto,
    explicitBatchNumber: bigint | string,
    authData: { 
      apiKey?: string; 
      jwt?: string; 
      signature?: { 
        message: string; 
        signature: string; 
        signer: string; 
      } 
    }
  ): Promise<TransactionResult> {
    // Authenticate based on the configured method
    const isAuthenticated = await this.authenticate(authData);
    if (!isAuthenticated) {
      return {
        success: false,
        error: new Error('Authentication failed'),
        message: 'The provided authentication credentials are invalid',
      };
    }

    try {
      // Convert all commitments to internal format
      const commitments: Commitment[] = [];
      
      for (const commitmentDto of batch.commitments) {
        // Convert from DTO to internal types
        const requestId = await RequestId.create(commitmentDto.requestID);
        const transactionHash = new DataHash(Buffer.from(hexToBytes(commitmentDto.payload)));
        
        // Extract authenticator parts from combined format
        const authBytes = hexToBytes(commitmentDto.authenticator);
        const publicKey = authBytes.slice(0, 32);
        const stateHash = authBytes.slice(32, 64);
        const signature = authBytes.slice(64);
        
        const authenticator = new Authenticator(
          Buffer.from(publicKey),
          Buffer.from(stateHash),
          Buffer.from(signature)
        );
        
        commitments.push(new Commitment(requestId, transactionHash, authenticator));
      }

      // Convert commitments to contract format for submitAndCreateBatchWithNumber
      const contractRequests = commitments.map(commitment => ({
        requestID: commitment.requestID,
        payload: commitment.payload,
        authenticator: commitment.authenticator
      }));

      const batchNum = typeof explicitBatchNumber === 'string' ? BigInt(explicitBatchNumber) : explicitBatchNumber;
      
      // Submit with explicit batch number
      return await this.executeTransaction('submitAndCreateBatchWithNumber', [contractRequests, batchNum]);
    } catch (error: any) {
      return {
        success: false,
        error: new Error(`Error submitting batch with explicit number: ${error.message}`),
        message: 'Failed to process the submitted batch',
      };
    }
  }
  
  /**
   * Get inclusion proof for a request
   * Compatible with the aggregators_net interface
   * @param requestId The request ID to get proof for
   * @returns Inclusion proof or null if not found
   */
  public async getInclusionProof(requestId: string): Promise<any> {
    try {
      // Convert to internal request ID
      const reqId = await RequestId.create(requestId);
      
      // Check if request exists in our records
      const record = await this.getCommitmentRecord(reqId);
      if (!record) {
        return null;
      }

      // Get Merkle path for this request ID
      const merkleProof = await this.generateMerkleProof(record.batchNumber, reqId.toString());
      if (!merkleProof) {
        return null;
      }

      // Create and return an InclusionProof
      const inclusionProof = new InclusionProof(
        merkleProof.proof,
        record.authenticator,
        record.transactionHash
      );

      return inclusionProof.toDto();
    } catch (error) {
      console.error('Error getting inclusion proof:', error);
      return null;
    }
  }

  /**
   * Get no deletion proof
   * Compatible with the aggregators_net interface
   * @returns Proof that no commitments have been deleted
   */
  public async getNoDeleteProof(): Promise<any> {
    // This is a placeholder - would need to be implemented according to your specific requirements
    throw new Error('Not implemented.');
  }

  /**
   * Process all pending commitments into a new batch
   * @returns Transaction result
   */
  private async processPendingCommitments(): Promise<TransactionResult> {
    if (this.pendingCommitments.length === 0) {
      return {
        success: false,
        error: new Error('No pending commitments to process'),
        message: 'No pending commitments available for processing'
      };
    }

    try {
      // Get the next batch number
      const nextBatchNumber = await this.getNextBatchNumber();
      
      // Create leaf nodes for the Merkle Tree
      const leaves: [string, string][] = [];

      // Process all commitments
      for (const commitment of this.pendingCommitments) {
        const key = commitment.requestID.toDto();
        const value = bytesToHex(Buffer.concat([
          commitment.payload,
          commitment.authenticator.toBuffer()
        ]));
        leaves.push([key, value]);
      }

      // Create the SMT and get root hash
      // Initialize SMT with SHA256 algorithm
      if (!this.smt) {
        this.smt = await SparseMerkleTree.create(HashAlgorithm.SHA256);
      } else {
        // Clear any existing leaves
        this.smt = await SparseMerkleTree.create(HashAlgorithm.SHA256);
      }
      
      // Add leaves to the SMT
      for (const [key, value] of leaves) {
        await this.smt.addLeaf(BigInt(`0x${key}`), Buffer.from(value, 'hex'));
      }
      
      // The rootHash is likely a DataHash object from @unicitylabs/commons
      // It should have a toString() method or a toBuffer() method
      // Handle various possible formats
      let rootHash: string;
      
      if (Buffer.isBuffer(this.smt.rootHash)) {
        // If it's already a Buffer
        rootHash = this.smt.rootHash.toString('hex');
      } else if (this.smt.rootHash && typeof this.smt.rootHash.toString === 'function') {
        // If it has a toString method (DataHash likely has this)
        rootHash = this.smt.rootHash.toString();
      } else if (this.smt.rootHash && 'data' in this.smt.rootHash) {
        // If it has a data property (likely DataHash from unicitylabs)
        const dataBuffer = (this.smt.rootHash as any).data;
        rootHash = Buffer.isBuffer(dataBuffer) ? dataBuffer.toString('hex') : String(dataBuffer);
      } else {
        // Fallback for other cases
        rootHash = String(this.smt.rootHash);
      }
      
      // Create request IDs array
      const requestIds = this.pendingCommitments.map(commitment => 
        commitment.requestID);
      
      // Submit the batch to the blockchain using direct method calls
      // First, create a batch normally
      const createBatchResult = await this.executeTransaction('createBatch', []);
      
      if (!createBatchResult.success) {
        return createBatchResult;
      }
      
      // Then submit the hashroot for this batch
      const result = await this.executeTransaction('submitHashroot', [
        nextBatchNumber, 
        Buffer.from(rootHash, 'hex')
      ]);

      // Clear pending commitments if successful
      if (result.success) {
        this.pendingCommitments = [];
        return {
          ...result,
          batchNumber: nextBatchNumber,
          successCount: BigInt(requestIds.length),
          message: `Successfully created batch ${nextBatchNumber} with ${requestIds.length} commitments`
        };
      }

      return {
        ...result,
        message: `Failed to create batch: ${result.error?.message}`
      };
    } catch (error: any) {
      return {
        success: false,
        error: new Error(`Error processing commitments: ${error.message}`),
        message: 'Failed to process pending commitments'
      };
    }
  }

  /**
   * Start automatic batch creation
   */
  public startAutoBatchCreation(): void {
    if (this.batchCreationTimer) {
      clearInterval(this.batchCreationTimer);
    }

    this.batchCreationTimer = setInterval(async () => {
      try {
        if (this.pendingCommitments.length > 0) {
          console.log(`Processing ${this.pendingCommitments.length} pending commitments...`);
          await this.processPendingCommitments();
        }
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
   * Get the next batch number
   * @returns Next batch number
   */
  private async getNextBatchNumber(): Promise<bigint> {
    try {
      const latestBatch = await this.getLatestBatchNumber();
      return latestBatch + BigInt(1);
    } catch (error) {
      console.error('Error getting next batch number:', error);
      throw error;
    }
  }

  /**
   * Create a new batch on the blockchain
   * @param batchNumber Batch number
   * @param requestIds Request IDs in the batch
   * @param hashroot Root hash of the SMT
   * @returns Transaction result
   */
  private async createBatch(
    batchNumber: bigint,
    requestIds: bigint[],
    hashroot: Uint8Array
  ): Promise<TransactionResult> {
    try {
      // Use an existing method in the contract that supports batch creation with hashroots
      // If no such method exists, we'll need to modify the contract to support this
      
      // This is a specialized method so we may need to get creative
      // For now, let's try createBatch and submitHashroot separately
      const createBatchResult = await this.executeTransaction('createBatch', []);
      
      if (createBatchResult.success) {
        // Now submit the hashroot for this batch using a proper method call
        const submitHashrootResult = await this.executeTransaction('submitHashroot', [batchNumber, hashroot]);
        
        return {
          ...submitHashrootResult,
          batchNumber: batchNumber
        };
      }
      
      return createBatchResult;
    } catch (error) {
      console.error('Error creating batch with hashroot:', error);
      return {
        success: false,
        error: new Error(`Failed to create batch with hashroot: ${error}`),
        message: 'Failed to create batch with custom hashroot'
      };
    }
  }

  /**
   * Generate Merkle proof for a specific commitment
   * @param batchNumber The batch number
   * @param requestID The request ID
   * @returns Merkle proof or null if not found
   */
  private async generateMerkleProof(
    batchNumber: bigint | string,
    requestID: string
  ): Promise<{ proof: string[]; value: string } | null> {
    try {
      const bn = typeof batchNumber === 'string' ? BigInt(batchNumber) : batchNumber;
      
      // Get the batch data
      const batch = await this.getBatch(bn);
      if (!batch || !batch.processed) {
        return null;
      }

      // Check if the request is in this batch
      if (!batch.requests.some(req => req.requestID === requestID)) {
        return null;
      }

      // Rebuild the SMT from the batch data
      // This would need to be implemented based on how you store batch data
      // For now, we'll use a simplified approach of fetching all commitment records

      const leaves: [string, string][] = [];
      for (const req of batch.requests) {
        const reqId = req.requestID;
        const record = await this.getCommitmentRecord({ toString: () => reqId } as RequestId);
        if (record) {
          const key = reqId.toString();
          const value = bytesToHex(Buffer.concat([
            record.transactionHash.toBuffer(),
            record.authenticator.toBuffer()
          ]));
          leaves.push([key, value]);
        }
      }

      // Create the SMT
      if (!this.smt) {
        this.smt = await SparseMerkleTree.create(HashAlgorithm.SHA256);
      } else {
        // Clear any existing leaves
        this.smt = await SparseMerkleTree.create(HashAlgorithm.SHA256);
      }
      
      // Add leaves to the SMT
      for (const [key, value] of leaves) {
        await this.smt.addLeaf(BigInt(`0x${key}`), Buffer.from(value, 'hex'));
      }
      
      // For the unicitylabs SparseMerkleTree implementation
      // We need to check if the request ID is in the tree by other means
      const requestBigInt = BigInt(`0x${requestID}`);
      
      // Attempt to get the path - if there's no leaf, this should still provide
      // a path to where the leaf would be if it existed
      try {
        // Generate the proof - MerkleTreePath has a steps property
        const merkleTreePath = this.smt.getPath(requestBigInt);
        
        // Convert path steps to hex strings
        const proof = [];
        if (merkleTreePath.steps) {
          for (const step of merkleTreePath.steps) {
            if (step && step.sibling) {
              proof.push(step.sibling.toString());
            } else if (step) {
              proof.push('0x0000');
            }
          }
        }
        const value = leaves.find(leaf => leaf[0] === requestID)?.[1] || '';

        return { proof, value };
      } catch (error) {
        console.error('Error in proof generation:', error);
        return null;
      }
    } catch (error) {
      console.error('Error generating Merkle proof:', error);
      return null;
    }
  }

  /**
   * Get a commitment record by request ID
   * This would need to be implemented based on your storage mechanism
   * @param requestId Request ID to look up
   * @returns Commitment record or null if not found
   */
  private async getCommitmentRecord(requestId: RequestId): Promise<any> {
    try {
      // First check our pending commitments
      const pendingCommitment = this.pendingCommitments.find(c => 
        c.requestID.toDto() === requestId.toDto());
      
      if (pendingCommitment) {
        // This is a pending commitment - get its batch info from storage
        return {
          batchNumber: BigInt(0), // A placeholder for pending commitments
          transactionHash: pendingCommitment.payload,
          authenticator: pendingCommitment.authenticator
        };
      }
      
      // If not in pending commitments, check on-chain
      // Call contract method to get commitment record
      // This is a simplified example - you'll need to implement based on your contract
      
      // Call contract to get the batch number for this request ID
      const batchNumber = await this.contract.getRequestBatch(requestId);
      
      if (batchNumber === BigInt(0)) {
        // Request not found
        return null;
      }
      
      // Get the batch data to get the commitment
      const batch = await this.getBatch(batchNumber);
      
      if (!batch) {
        return null;
      }
      
      // At this point, in a real implementation, you would fetch the
      // commitment details using the batch data, but this depends on
      // how your contract stores commitment data
      
      // For simplicity, we'll return a mock record
      return {
        batchNumber,
        transactionHash: new DataHash(crypto.randomBytes(32)),
        authenticator: new Authenticator(
          crypto.randomBytes(32),
          crypto.randomBytes(32),
          crypto.randomBytes(65)
        )
      };
    } catch (error) {
      console.error('Error getting commitment record:', error);
      return null;
    }
  }

  /**
   * Validate a commitment
   * @param requestId Request ID
   * @param transactionHash Transaction hash
   * @param authenticator Authenticator
   * @returns Validation status
   */
  private async validateCommitment(
    requestId: RequestId, 
    transactionHash: DataHash, 
    authenticator: Authenticator
  ): Promise<SubmitCommitmentStatus> {
    try {
      // Check if request ID is correctly derived from authenticator
      const expectedRequestId = await RequestId.create(
        authenticator.publicKey,
        authenticator.stateHash
      );
      
      if (expectedRequestId.toDto() !== requestId.toDto()) {
        return SubmitCommitmentStatus.REQUEST_ID_MISMATCH;
      }
      
      // Verify authenticator signature
      if (!(await authenticator.verify(transactionHash))) {
        return SubmitCommitmentStatus.AUTHENTICATOR_VERIFICATION_FAILED;
      }
      
      // Check if request ID already exists with different transaction hash
      const existingRecord = await this.getCommitmentRecord(requestId);
      // Compare transaction hashes - if they're different, reject
      if (existingRecord) {
        const existingTxHashStr = Buffer.from(existingRecord.transactionHash).toString('hex');
        const newTxHashStr = Buffer.from(transactionHash).toString('hex');
        if (existingTxHashStr !== newTxHashStr) {
          return SubmitCommitmentStatus.REQUEST_ID_EXISTS;
        }
      }
      
      return SubmitCommitmentStatus.SUCCESS;
    } catch (error) {
      console.error('Error validating commitment:', error);
      return SubmitCommitmentStatus.INVALID_REQUEST;
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

  /**
   * Legacy method for submitting a commitment (aligned with current AggregatorGatewayClient)
   * @param requestID The request ID
   * @param payload The payload data
   * @param authenticator The authenticator data
   * @returns Transaction result
   */
  public async submitCommitmentLegacy(
    requestID: bigint | string,
    payload: Uint8Array | string,
    authenticator: Uint8Array | string,
  ): Promise<TransactionResult> {
    const id = typeof requestID === 'string' ? BigInt(requestID) : requestID;

    // Convert string payloads to Uint8Array if needed
    const payloadBytes = typeof payload === 'string' 
      ? new TextEncoder().encode(payload) 
      : payload;

    const authBytes = typeof authenticator === 'string' 
      ? new TextEncoder().encode(authenticator) 
      : authenticator;

    return this.executeTransaction('submitCommitment', [id, payloadBytes, authBytes]);
  }

  /**
   * Legacy method for creating a batch (aligned with current AggregatorGatewayClient)
   * @returns The created batch number and transaction result
   */
  public async createBatchLegacy(): Promise<{ batchNumber: bigint; result: TransactionResult }> {
    const result = await this.executeTransaction('createBatch', []);

    // Get the latest batch number to return
    const batchNumber = await this.getLatestBatchNumber();

    return { batchNumber, result };
  }
}