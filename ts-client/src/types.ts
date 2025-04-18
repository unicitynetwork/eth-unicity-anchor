/**
 * Core data types for the Ethereum Unicity Anchor client
 */

/**
 * Represents a commitment request
 */
export interface CommitmentRequest {
  requestID: bigint;
  payload: Uint8Array;
  authenticator: Uint8Array;
}

/**
 * Commitment request with string representation for easier handling
 */
export interface CommitmentRequestDto {
  requestID: string;
  payload: string; // hex string
  authenticator: string; // hex string
}

/**
 * Batch request interface for processing
 */
export interface BatchRequest {
  requestID: string;
  payload: string; // hex string
  authenticator: string; // hex string
}

/**
 * Represents a batch of commitment requests
 */
export interface Batch {
  batchNumber: bigint;
  requestIds: bigint[];
  hashroot: Uint8Array;
  processed: boolean;
}

/**
 * Batch with string representation for easier handling
 */
export interface BatchDto {
  batchNumber: string;
  requestIds: string[];
  hashroot: string; // hex string
  processed: boolean;
}

/**
 * Options for initializing the client
 */
export interface ClientOptions {
  providerUrl?: string;
  provider?: string | any; // Can be a provider URL string or an ethers.Provider
  contractAddress: string;
  privateKey?: string;
  signer?: any; // Can be an ethers.Wallet or ethers.Signer
  abi?: any[]; // Optional custom ABI to use instead of the default
  maxRetries?: number;
  retryDelay?: number;
  timeoutMs?: number;
  gasLimitMultiplier?: number;
}

/**
 * Configuration for an aggregator node
 */
export interface AggregatorConfig extends ClientOptions {
  aggregatorAddress: string;
  smtDepth: number;
  /**
   * @deprecated Use autoProcessing instead
   */
  batchProcessingInterval?: number;
  /**
   * @deprecated Use autoProcessing instead
   */
  autoProcessBatches?: boolean;
  /**
   * Time in seconds between batch processing attempts.
   * If set to a non-zero value, automatic batch processing will be enabled.
   * Default: 0 (disabled)
   */
  autoProcessing?: number;
}

/**
 * Configuration for an aggregator gateway
 */
export interface GatewayConfig extends ClientOptions {
  gatewayAddress: string;
  batchCreationThreshold?: number;
  batchCreationInterval?: number;
  autoCreateBatches?: boolean;
}

/**
 * Result of a transaction
 */
export interface TransactionResult {
  success: boolean;
  transactionHash?: string;
  blockNumber?: number;
  gasUsed?: bigint;
  error?: Error;
  // Additional fields for batch operations
  successCount?: bigint;      // Number of successfully processed commitments
  batchNumber?: bigint;       // Batch number created (for createBatch operations)
  // Additional fields for extended information
  message?: string;           // Informational message about the transaction
  /**
   * Indicates this was a skipped operation because it was previously processed
   */
  skipped?: boolean;
  
  /**
   * Indicates this batch was verified against an on-chain processed batch
   */
  verified?: boolean;
  
  /**
   * Indicates a critical failure that requires immediate attention
   * When true, the system may exit with a non-zero code to prevent
   * silent failures that could corrupt the SMT or batch sequence
   */
  critical?: boolean;
  
  /**
   * Indicates that we should wait for consensus even if retry count is exceeded
   * This is used for non-critical consensus states where we're waiting for
   * enough aggregator votes without a hashroot mismatch
   */
  waitForConsensus?: boolean;
  
  /**
   * Indicates that we're waiting for a previous batch to be fully processed
   * This is used when we detect a batch in the sequence that exists but isn't 
   * marked as processed yet, preventing processing of subsequent batches
   */
  waitForPrevious?: boolean;
}

/**
 * Sparse Merkle Tree node interface
 */
export interface SmtNode {
  hash: Uint8Array;
  left?: SmtNode;
  right?: SmtNode;
}

/**
 * Events emitted by the contract
 */
export enum EventType {
  RequestSubmitted = 'RequestSubmitted',
  RequestsSubmitted = 'RequestsSubmitted',
  BatchCreated = 'BatchCreated',
  BatchProcessed = 'BatchProcessed',
  HashrootSubmitted = 'HashrootSubmitted',
}

/**
 * Event callback interface
 */
export type EventCallback = (eventType: EventType, data: any) => void;

/**
 * Transaction queue entry for sequential processing
 */
export interface TransactionQueueEntry {
  /**
   * Method name to be called on the contract
   */
  method: string;
  
  /**
   * Arguments to pass to the method
   */
  args: any[];
  
  /**
   * Unique identifier for the transaction (e.g. batchNumber for batch processing)
   */
  id: string;
  
  /**
   * Type of transaction for logging and priority handling
   */
  type: 'HASHROOT_VOTE' | 'BATCH_CREATION' | 'COMMITMENT' | 'ADMIN' | 'OTHER';
  
  /**
   * Optional callback to be called after transaction is confirmed
   */
  onComplete?: (result: TransactionResult) => void;
  
  /**
   * Should transaction wait for confirmations
   */
  confirmations?: number;
  
  /**
   * Timestamp when the transaction was queued
   */
  timestamp: number;
  
  /**
   * Indicates if this transaction requires confirmation before proceeding with next batch processing
   */
  requireConfirmation?: boolean;
  
  /**
   * Transaction result (set after execution)
   */
  result?: TransactionResult;
}
