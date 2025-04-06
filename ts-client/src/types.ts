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
  providerUrl: string;
  contractAddress: string;
  privateKey?: string;
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
  batchProcessingInterval?: number;
  autoProcessBatches?: boolean;
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
  BatchCreated = 'BatchCreated',
  BatchProcessed = 'BatchProcessed',
  HashrootSubmitted = 'HashrootSubmitted'
}

/**
 * Event callback interface
 */
export type EventCallback = (eventType: EventType, data: any) => void;