import { ethers } from 'ethers';
import {
  ClientOptions,
  CommitmentRequest,
  CommitmentRequestDto,
  Batch,
  BatchDto,
  TransactionResult,
  EventType,
  EventCallback,
  TransactionQueueEntry,
} from './types';
import { ABI } from './abi';
import {
  convertCommitmentToDto,
  convertDtoToCommitment,
  convertBatchToDto,
  hexToBytes,
  bytesToHex,
} from './utils';

/**
 * Base client for interacting with the Ethereum Unicity Anchor smart contract
 */
export class UniCityAnchorClient {
  protected provider: ethers.JsonRpcProvider;
  protected contract: any; // Using any to avoid Contract type issues
  protected signer?: ethers.Wallet;
  protected options: ClientOptions & {
    maxRetries: number;
    retryDelay: number;
    timeoutMs: number;
    gasLimitMultiplier: number;
  };
  private eventListeners: Map<EventType, EventCallback[]> = new Map();

  /**
   * Create a new UnicityCityAnchorClient
   * @param options Client configuration options
   */
  constructor(options: ClientOptions) {
    this.options = {
      ...options,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      timeoutMs: options.timeoutMs || 60000,
      gasLimitMultiplier: options.gasLimitMultiplier || 1.2,
    };

    // Handle provider initialization
    if (options.provider) {
      if (typeof options.provider === 'string') {
        this.provider = new ethers.JsonRpcProvider(options.provider);
      } else {
        this.provider = options.provider;
      }
    } else if (options.providerUrl) {
      this.provider = new ethers.JsonRpcProvider(options.providerUrl);
    } else {
      throw new Error('Either provider or providerUrl must be provided');
    }

    // Initialize contract with provider
    this.contract = new ethers.Contract(
      options.contractAddress, 
      options.abi || ABI, // Use custom ABI if provided
      this.provider
    );

    // Initialize signer if provided
    if (options.signer) {
      this.signer = options.signer;
      this.contract = this.contract.connect(this.signer);
    } else if (options.privateKey) {
      this.signer = new ethers.Wallet(options.privateKey, this.provider);
      this.contract = this.contract.connect(this.signer);
    }

    this.setupEventListeners();
  }

  /**
   * Set up event listeners for contract events
   */
  private setupEventListeners(): void {
    // Set up event listeners for the contract
    this.contract.on('RequestSubmitted', (requestID: bigint, payload: string) => {
      this.emitEvent(EventType.RequestSubmitted, { requestID, payload });
    });
    
    this.contract.on('RequestsSubmitted', (count: bigint, successCount: bigint) => {
      this.emitEvent(EventType.RequestsSubmitted, { count, successCount });
    });

    this.contract.on('BatchCreated', (batchNumber: bigint, requestCount: bigint) => {
      this.emitEvent(EventType.BatchCreated, { batchNumber, requestCount });
    });

    this.contract.on('BatchProcessed', (batchNumber: bigint, hashroot: string) => {
      this.emitEvent(EventType.BatchProcessed, { batchNumber, hashroot });
    });

    this.contract.on(
      'HashrootSubmitted',
      (batchNumber: bigint, aggregator: string, hashroot: string) => {
        this.emitEvent(EventType.HashrootSubmitted, { batchNumber, aggregator, hashroot });
      },
    );
  }

  /**
   * Register an event listener
   * @param eventType Type of event to listen for
   * @param callback Callback function
   */
  public on(eventType: EventType, callback: EventCallback): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType)?.push(callback);
  }

  /**
   * Emit an event to registered listeners
   * @param eventType Type of event
   * @param data Event data
   */
  private emitEvent(eventType: EventType, data: any): void {
    const listeners = this.eventListeners.get(eventType) || [];
    for (const listener of listeners) {
      try {
        listener(eventType, data);
      } catch (error) {
        console.error(`Error in event listener for ${eventType}:`, error);
      }
    }
  }

  /**
   * Get current chain ID
   * @returns The chain ID as a number
   */
  public async getChainId(): Promise<number> {
    const network = await this.provider.getNetwork();
    return Number(network.chainId);
  }

  /**
   * Check if the contract is deployed and accessible
   * @returns Boolean indicating if the contract is available
   */
  public async isContractAvailable(): Promise<boolean> {
    try {
      const code = await this.provider.getCode(this.options.contractAddress);
      return code !== '0x';
    } catch (error) {
      return false;
    }
  }

  /**
   * Get a commitment by request ID
   * @param requestID The request ID to fetch
   * @returns The commitment request data
   */
  public async getCommitment(requestID: bigint | string): Promise<CommitmentRequestDto> {
    const id = typeof requestID === 'string' ? BigInt(requestID) : requestID;
    const result = await this.contract.getCommitment(id);
    return convertCommitmentToDto(result);
  }

  /**
   * Get the latest batch number
   * @returns The latest batch number
   */
  public async getLatestBatchNumber(): Promise<bigint> {
    return await this.contract.getLatestBatchNumber();
  }

  /**
   * Get the latest processed batch number
   * @returns The latest processed batch number
   */
  public async getLatestProcessedBatchNumber(): Promise<bigint> {
    return await this.contract.getLatestProcessedBatchNumber();
  }

  /**
   * Get the next available batch number for auto-numbering (first available gap)
   * @returns The next available batch number
   */
  public async getNextAutoNumberedBatch(): Promise<bigint> {
    return await this.contract.getNextAutoNumberedBatch();
  }

  /**
   * Get the latest unprocessed batch
   * @returns Tuple containing batch number and array of commitment requests
   */
  public async getLatestUnprocessedBatch(): Promise<[bigint, CommitmentRequestDto[]]> {
    const [batchNumber, requests] = await this.contract.getLatestUnprocessedBatch();

    const commitments = requests.map((req: any) => convertCommitmentToDto(req));

    return [batchNumber, commitments];
  }

  /**
   * Get a batch by number
   * @param batchNumber The batch number to retrieve
   * @returns Object containing requests, processed status, and hashroot
   */
  public async getBatch(batchNumber: bigint | string): Promise<{
    requests: CommitmentRequestDto[];
    processed: boolean;
    hashroot: string;
  }> {
    const bn = typeof batchNumber === 'string' ? BigInt(batchNumber) : batchNumber;
    const [requests, processed, hashroot] = await this.contract.getBatch(bn);

    return {
      requests: requests.map((req: any) => convertCommitmentToDto(req)),
      processed,
      hashroot: bytesToHex(hashroot),
    };
  }

  /**
   * Get the hashroot for a batch
   * @param batchNumber The batch number
   * @returns The hashroot as a hex string
   */
  public async getBatchHashroot(batchNumber: bigint | string): Promise<string> {
    const bn = typeof batchNumber === 'string' ? BigInt(batchNumber) : batchNumber;
    const hashroot = await this.contract.getBatchHashroot(bn);
    return bytesToHex(hashroot);
  }

  /**
   * Get the count of unprocessed requests
   * @returns The number of unprocessed requests
   */
  public async getUnprocessedRequestCount(): Promise<bigint> {
    return await this.contract.getUnprocessedRequestCount();
  }

  /**
   * Get all unprocessed requests
   * @returns Array of unprocessed request IDs
   */
  public async getAllUnprocessedRequests(): Promise<bigint[]> {
    return await this.contract.getAllUnprocessedRequests();
  }

  /**
   * Check if a request is unprocessed
   * @param requestID The request ID to check
   * @returns Boolean indicating if the request is unprocessed
   */
  public async isRequestUnprocessed(requestID: bigint | string): Promise<boolean> {
    const id = typeof requestID === 'string' ? BigInt(requestID) : requestID;
    return await this.contract.isRequestUnprocessed(id);
  }

  /**
   * Get the number of votes for a specific hashroot in a batch
   * @param batchNumber The batch number
   * @param hashroot The hashroot to check
   * @returns The number of votes
   */
  public async getHashrootVoteCount(
    batchNumber: bigint | string,
    hashroot: string | Uint8Array,
  ): Promise<bigint> {
    const bn = typeof batchNumber === 'string' ? BigInt(batchNumber) : batchNumber;
    const hr = typeof hashroot === 'string' ? hexToBytes(hashroot) : hashroot;
    return await this.contract.getHashrootVoteCount(bn, hr);
  }

  /**
   * Adds a new trusted aggregator to the contract (only callable by owner)
   * @param aggregator The address of the new aggregator
   * @returns Transaction result
   */
  public async addAggregator(aggregator: string): Promise<TransactionResult> {
    return this.executeTransaction('addAggregator', [aggregator]);
  }

  /**
   * Removes a trusted aggregator from the contract (only callable by owner)
   * @param aggregator The address of the aggregator to remove
   * @returns Transaction result
   */
  public async removeAggregator(aggregator: string): Promise<TransactionResult> {
    return this.executeTransaction('removeAggregator', [aggregator]);
  }

  /**
   * Updates the required number of aggregator votes (only callable by owner)
   * @param newRequiredVotes The new required votes threshold
   * @returns Transaction result
   */
  public async updateRequiredVotes(newRequiredVotes: bigint | number): Promise<TransactionResult> {
    return this.executeTransaction('updateRequiredVotes', [newRequiredVotes]);
  }

  /**
   * Transfers ownership of the contract to a new owner (only callable by current owner)
   * @param newOwner The address of the new owner
   * @returns Transaction result
   */
  public async transferOwnership(newOwner: string): Promise<TransactionResult> {
    return this.executeTransaction('transferOwnership', [newOwner]);
  }

  /**
   * Execute a transaction with retry logic and extract any event data
   * @param method The contract method to call
   * @param args Arguments for the method
   * @returns Transaction result with additional event data for certain methods:
   *          - For submitCommitments: includes successCount from RequestsSubmitted event
   *          - For submitAndCreateBatch: includes successCount and batchNumber from events
   */
  // Transaction queue system for sequential processing
  private transactionQueue: Array<TransactionQueueEntry> = [];
  private isProcessingQueue = false;
  private pendingNonce: number | null = null;
  private queuedTransactions = new Map<string, boolean>(); // Track which transactions are already in the queue
  
  /**
   * Get the next nonce to use for a transaction
   * Always queries the blockchain for the most up-to-date nonce
   */
  private async getNextNonce(): Promise<number> {
    // Always get the current nonce from the blockchain
    const currentNonce = await this.provider.getTransactionCount(this.signer!.address);
    
    // If we have a pending nonce that's higher, use that instead
    if (this.pendingNonce !== null && this.pendingNonce > currentNonce) {
      console.log(`Using pending nonce: ${this.pendingNonce} (blockchain nonce: ${currentNonce})`);
      return this.pendingNonce;
    }
    
    console.log(`Using blockchain nonce: ${currentNonce}`);
    return currentNonce;
  }
  
  /**
   * Queue a transaction for sequential processing
   * @param txEntry Transaction entry to be queued
   * @returns Promise that resolves when the transaction is processed
   */
  protected queueTransaction(txEntry: TransactionQueueEntry): Promise<TransactionResult> {
    // Generate a unique ID if not provided
    const txId = txEntry.id || `${txEntry.method}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    // Check if this transaction is already in the queue (by ID)
    if (this.queuedTransactions.has(txId)) {
      console.log(`[TxQueue] Transaction ${txId} already queued, skipping duplicate`);
      return Promise.resolve({
        success: false,
        message: `Transaction ${txId} already in the queue`,
        error: new Error("Duplicate transaction")
      });
    }
    
    // Create a full entry with defaults
    const fullEntry: TransactionQueueEntry = {
      ...txEntry,
      id: txId,
      timestamp: Date.now(),
      type: txEntry.type || 'OTHER',
      confirmations: txEntry.confirmations ?? 1, // Default to 1 confirmation (included in a block)
    };
    
    console.log(`[TxQueue] Queueing ${fullEntry.type} transaction: ${fullEntry.method} (ID: ${fullEntry.id})`);
    
    // Create a promise that will resolve when this transaction is processed
    return new Promise((resolve) => {
      // Add the completion callback
      fullEntry.onComplete = (result: TransactionResult) => {
        resolve(result);
      };
      
      // Add to the queue
      this.transactionQueue.push(fullEntry);
      this.queuedTransactions.set(txId, true);
      
      // Start queue processing if not already processing
      if (!this.isProcessingQueue) {
        this.processTransactionQueue().catch(error => {
          console.error(`[TxQueue] Error processing transaction queue:`, error);
        });
      }
    });
  }
  
  /**
   * Process the transaction queue sequentially
   * This method continues until the queue is empty
   */
  private async processTransactionQueue(): Promise<void> {
    // If already processing, return
    if (this.isProcessingQueue) {
      return;
    }
    
    console.log(`[TxQueue] Starting transaction queue processor. Queue length: ${this.transactionQueue.length}`);
    
    // Check if queue is empty before acquiring the lock
    if (this.transactionQueue.length === 0) {
      console.log(`[TxQueue] Transaction queue is empty, nothing to process`);
      return;
    }
    
    // Add a safety timeout to prevent queue processor getting stuck
    const queueTimeoutMs = 15 * 60 * 1000; // 15 minutes max processing time
    let queueTimeout: NodeJS.Timeout | null = null;
    
    // Set safety timeout to release the lock if queue processing takes too long
    queueTimeout = setTimeout(() => {
      console.error(`[TxQueue] CRITICAL: Queue processor timed out after ${queueTimeoutMs/1000} seconds`);
      console.error(`[TxQueue] Forcibly releasing queue lock to prevent deadlock`);
      this.isProcessingQueue = false;
    }, queueTimeoutMs);
    
    this.isProcessingQueue = true;
    
    try {
      // Process queue until empty
      while (this.transactionQueue.length > 0) {
        // Get the next transaction from the queue (FIFO)
        const txEntry = this.transactionQueue[0];
        
        // Sanity check - make sure the entry is valid
        if (!txEntry || !txEntry.method) {
          console.error(`[TxQueue] ERROR: Invalid transaction entry found in queue, skipping`);
          this.transactionQueue.shift(); // Remove the invalid entry
          continue;
        }
        
        // Log the current queue status
        console.log(`[TxQueue] Processing ${txEntry.type} transaction: ${txEntry.method} (ID: ${txEntry.id})`);
        console.log(`[TxQueue] Remaining queue length: ${this.transactionQueue.length}`);
        
        try {
          // Process the transaction with confirmation
          const result = await this.executeTransactionWithConfirmation(
            txEntry.method, 
            txEntry.args, 
            txEntry.confirmations || 1
          );
          
          // Store the result
          txEntry.result = result;
          
          // Call the completion callback
          if (txEntry.onComplete) {
            txEntry.onComplete(result);
          }
          
          console.log(`[TxQueue] ${txEntry.type} transaction completed: ${txEntry.method} (ID: ${txEntry.id})`);
          console.log(`[TxQueue] Result: ${result.success ? 'SUCCESS' : 'FAILED'}, Hash: ${result.transactionHash || 'N/A'}`);
          
          // Remove from the tracked transactions
          this.queuedTransactions.delete(txEntry.id);
          
        } catch (error) {
          console.error(`[TxQueue] Error processing transaction ${txEntry.id}:`, error);
          
          // Create error result
          const errorResult: TransactionResult = {
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
            message: `Failed to execute transaction: ${error instanceof Error ? error.message : String(error)}`
          };
          
          // Store the result
          txEntry.result = errorResult;
          
          // Add detailed error logging for debugging
          console.error(`[TxQueue] DETAILED ERROR for transaction ${txEntry.id} (${txEntry.method}):`);
          console.error(`[TxQueue] - Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
          console.error(`[TxQueue] - Message: ${error instanceof Error ? error.message : String(error)}`);
          if (error instanceof Error && error.stack) {
            console.error(`[TxQueue] - Stack trace: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
          }
          
          // Add info about transaction parameters
          console.error(`[TxQueue] - Method: ${txEntry.method}`);
          
          // Safe handling of args with BigInt values
          try {
            // Custom serializer for BigInt
            const safeStringify = (obj: any) => {
              return JSON.stringify(obj, (_, value) => 
                typeof value === 'bigint' ? value.toString() + 'n' : value
              );
            };
            
            console.error(`[TxQueue] - Args: ${safeStringify(txEntry.args).substring(0, 100)}...`);
          } catch (serializeError) {
            console.error(`[TxQueue] - Args: [Could not serialize args: ${serializeError}]`);
            
            // Log args by using simple string conversion
            try {
              console.error(`[TxQueue] - Args (toString): ${txEntry.args.map(a => String(a)).join(', ')}`);
            } catch (e) {
              console.error(`[TxQueue] - Args: [Failed to convert args to string]`);
            }
          }
          
          // Call the completion callback with the error result
          if (txEntry.onComplete) {
            txEntry.onComplete(errorResult);
          }
          
          // Remove from the tracked transactions
          this.queuedTransactions.delete(txEntry.id);
        }
        
        // Remove the processed transaction from the queue
        this.transactionQueue.shift();
      }
      
      console.log(`[TxQueue] Transaction queue empty, processor stopped`);
    } finally {
      // Clear the safety timeout if it exists
      if (queueTimeout) {
        clearTimeout(queueTimeout);
        queueTimeout = null;
      }
      
      // Always release the processing flag
      this.isProcessingQueue = false;
      
      console.log(`[TxQueue] Queue processor completed, lock released`);
    }
  }
  
  /**
   * Execute a transaction with the specified confirmations
   * @param method Contract method to call
   * @param args Arguments for the method
   * @param confirmations Number of confirmations to wait for (default: 1)
   * @returns Transaction result
   */
  private async executeTransactionWithConfirmation(
    method: string, 
    args: any[], 
    confirmations: number = 1
  ): Promise<TransactionResult> {
    // Check if we're on a development network like Anvil/Hardhat where multiple
    // confirmations may cause issues since no blocks are mined automatically
    let isLocalNetwork = false;
    try {
      const network = await this.provider.getNetwork();
      const chainId = Number(network.chainId);
      // Typical development chain IDs
      isLocalNetwork = [31337, 1337, 1234].includes(chainId);
      
      if (isLocalNetwork && confirmations > 1) {
        console.log(`[TxExec] Detected local development network (chainId: ${chainId}), reducing confirmations to 1`);
        confirmations = 1;
      }
    } catch (error) {
      console.warn('[TxExec] Error checking network type, continuing with requested confirmations', error);
    }
    if (!this.signer) {
      return {
        success: false,
        error: new Error(
          'No signer available. Initialize client with privateKey to send transactions.',
        ),
      };
    }
    
    let lastError: Error | undefined;

    // Multiple retry attempts
    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
      try {
        console.log(`[TxExec] Transaction attempt ${attempt + 1}/${this.options.maxRetries} for method ${method}`);
        
        // Estimate gas for the transaction
        const gasEstimate = await this.contract[method].estimateGas(...args);
        console.log(`[TxExec] Gas estimate: ${gasEstimate}`);

        // Apply gas multiplier for safety
        const gasLimit = BigInt(Math.floor(Number(gasEstimate) * this.options.gasLimitMultiplier));
        console.log(`[TxExec] Gas limit with multiplier: ${gasLimit}`);
        
        // Get the next nonce from our helper method
        const nonce = await this.getNextNonce();
        console.log(`[TxExec] Using nonce: ${nonce}`);
        
        // Update our pending nonce
        this.pendingNonce = nonce + 1;

        // Send the transaction with explicit nonce
        console.log(`[TxExec] Sending transaction for method ${method}...`);
        const tx = await this.contract[method](...args, { 
          gasLimit,
          nonce: nonce
        });
        console.log(`[TxExec] Transaction sent with hash: ${tx.hash}`);

        // Wait for the transaction to be mined with specified confirmations
        console.log(`[TxExec] Waiting for ${confirmations} confirmation(s)...`);
        
        // For local development networks, we need special handling
        let receipt;
        if (isLocalNetwork) {
          // For Anvil, Hardhat, etc., just wait for the transaction to be mined
          // and then manually mine an additional block if needed to get confirmation
          receipt = await tx.wait(1);
          console.log(`[TxExec] Transaction ${tx.hash} mined in block ${receipt.blockNumber} on local network`);
          
          // If we need more than 1 confirmation (shouldn't happen due to our earlier check)
          // submit a dummy transaction to mine another block
          if (confirmations > 1) {
            console.log(`[TxExec] Local network detected - mining additional block for confirmation...`);
            try {
              // Send a tiny transaction to force a new block
              const dummyTx = await this.signer!.sendTransaction({
                to: this.signer!.address, 
                value: 1n
              });
              await dummyTx.wait(1);
              console.log(`[TxExec] Additional block mined for confirmation`);
            } catch (error) {
              console.warn(`[TxExec] Failed to mine additional block for confirmation:`, error);
            }
          }
        } else {
          // For regular networks, just wait for the specified number of confirmations
          receipt = await tx.wait(confirmations);
        }
        
        console.log(`[TxExec] Transaction ${tx.hash} confirmed in block ${receipt.blockNumber} with ${confirmations} confirmation(s)`);

        // Look for the event that contains the success count
        if (method === 'submitCommitments' || method === 'submitAndCreateBatch' || method === 'submitAndCreateBatchWithNumber') {
          // Find the RequestsSubmitted event in the receipt logs
          const iface = new ethers.Interface(this.options.abi || ABI);
          
          // First, collect all relevant event data
          let successCount;
          let batchNumber;
          
          for (const log of receipt.logs) {
            try {
              const parsedLog = iface.parseLog(log);
              
              // Extract success count from RequestsSubmitted events
              if (parsedLog && parsedLog.name === 'RequestsSubmitted') {
                successCount = parsedLog.args.successCount || BigInt(0);
              }
              
              // Extract batch number from BatchCreated events
              if (parsedLog && parsedLog.name === 'BatchCreated') {
                batchNumber = parsedLog.args.batchNumber || BigInt(0);
              }
            } catch (e) {
              // Skip logs that can't be parsed
              continue;
            }
          }
          
          // For submitAndCreateBatch or submitAndCreateBatchWithNumber we need both successCount and batchNumber
          if (method === 'submitAndCreateBatch' || method === 'submitAndCreateBatchWithNumber') {
            return {
              success: true,
              transactionHash: receipt.hash,
              blockNumber: receipt.blockNumber,
              gasUsed: receipt.gasUsed,
              successCount,
              batchNumber
            };
          }
          
          // For submitCommitments, we only need successCount
          if (method === 'submitCommitments' && successCount !== undefined) {
            return {
              success: true,
              transactionHash: receipt.hash,
              blockNumber: receipt.blockNumber,
              gasUsed: receipt.gasUsed,
              successCount
            };
          }
        }
        
        // Standard success response for other methods
        return {
          success: true,
          transactionHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          ...(receipt.batchNumber ? { batchNumber: receipt.batchNumber } : {})
        };
      } catch (error: any) {
        lastError = error;
        console.warn(`[TxExec] Transaction attempt ${attempt + 1} failed: ${error.message}`);

        // Enhanced error logging
        console.error(`[TxExec] DETAILED ERROR for attempt ${attempt + 1}:`);
        console.error(`[TxExec] - Error type: ${error.constructor.name || typeof error}`);
        console.error(`[TxExec] - Method: ${method}`);
        console.error(`[TxExec] - Full message: ${error.message}`);
        
        // Enhanced error categorization for better diagnostics
        if (error.message) {
          // Check for nonce issues
          if (error.message.includes("nonce too low") || 
              error.message.includes("nonce has already been used") ||
              error.message.includes("NONCE_EXPIRED") ||
              error.message.includes("nonce") ||
              error.message.includes("transaction sequence")) {
            
            console.log("[TxExec] Nonce error detected, resetting nonce tracking for retry");
            this.pendingNonce = null; // Reset nonce tracking to force a fresh query
          } 
          // Check for gas related errors
          else if (error.message.includes("gas") || 
                   error.message.includes("Gas") || 
                   error.message.includes("fee")) {
            
            console.error("[TxExec] Gas/fee error detected, may need higher limits");
          }
          // Check for contract revert errors
          else if (error.message.includes("revert") || 
                   error.message.includes("CALL_EXCEPTION") || 
                   error.message.includes("execution reverted")) {
            
            console.error("[TxExec] Contract revert detected, transaction rejected by contract logic");
            
            // Extract the revert reason if available
            const revertMatch = error.message.match(/reverted with reason string '([^']+)'/);
            if (revertMatch && revertMatch[1]) {
              console.error(`[TxExec] Revert reason: ${revertMatch[1]}`);
            }
          }
          // Check for network/connection issues
          else if (error.message.includes("network") || 
                   error.message.includes("timeout") || 
                   error.message.includes("SERVER_ERROR") ||
                   error.message.includes("CONNECTION_ERROR")) {
            
            console.error("[TxExec] Network or connection error detected, may retry with longer timeout");
          }
        }

        // Wait before retrying, with exponential backoff
        if (attempt < this.options.maxRetries - 1) {
          const delay = this.options.retryDelay * Math.pow(1.5, attempt);
          console.log(`[TxExec] Waiting ${Math.round(delay)}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    
    // If we get here, all attempts failed
    console.error(`[TxExec] TRANSACTION FAILURE SUMMARY after ${this.options.maxRetries} attempts:`);
    console.error(`[TxExec] - Method: ${method}`);
    
    // Safe handling of args with BigInt values
    try {
      // Custom serializer for BigInt
      const safeStringify = (obj: any) => {
        return JSON.stringify(obj, (_, value) => 
          typeof value === 'bigint' ? value.toString() + 'n' : value
        );
      };
      
      console.error(`[TxExec] - Args: ${safeStringify(args).substring(0, 100)}...`);
    } catch (serializeError) {
      console.error(`[TxExec] - Args: [Could not serialize args: ${serializeError}]`);
      
      // Log args by using simple string conversion
      try {
        console.error(`[TxExec] - Args (toString): ${args.map(a => String(a)).join(', ')}`);
      } catch (e) {
        console.error(`[TxExec] - Args: [Failed to convert args to string]`);
      }
    }
    
    console.error(`[TxExec] - Error: ${lastError?.message || 'Unknown error'}`);
    console.error(`[TxExec] - Error type: ${lastError instanceof Error ? lastError.constructor.name : typeof lastError}`);
    
    // Check for specific error types
    if (lastError?.message) {
      if (lastError.message.includes("nonce")) {
        console.error(`[TxExec] - Nonce-related failure detected`);
      } else if (lastError.message.includes("gas")) {
        console.error(`[TxExec] - Gas-related failure detected`);
      } else if (lastError.message.includes("revert")) {
        console.error(`[TxExec] - Contract revert detected`);
      }
    }
    
    return {
      success: false,
      error: lastError,
      message: `Failed after ${this.options.maxRetries} attempts: ${lastError?.message}`
    };
  }
  
  /**
   * Execute a transaction with retry logic and extract any event data
   * This is now a wrapper around queueTransaction for backward compatibility
   * @param method The contract method to call
   * @param args Arguments for the method
   * @returns Transaction result with additional event data for certain methods
   */
  protected async executeTransaction(method: string, args: any[]): Promise<TransactionResult> {
    // Determine the transaction type based on the method name
    let txType: 'HASHROOT_VOTE' | 'BATCH_CREATION' | 'COMMITMENT' | 'ADMIN' | 'OTHER' = 'OTHER';
    
    if (method === 'submitHashroot') {
      txType = 'HASHROOT_VOTE';
    } else if (method.includes('createBatch') || method === 'createEmptyBatch') {
      txType = 'BATCH_CREATION';
    } else if (method.includes('submit') && !method.includes('Hashroot')) {
      txType = 'COMMITMENT';
    } else if (method.includes('addAggregator') || method.includes('removeAggregator') || 
               method.includes('Ownership') || method.includes('RequiredVotes')) {
      txType = 'ADMIN';
    }
    
    // Create a transaction entry
    const txEntry: TransactionQueueEntry = {
      method,
      args,
      id: `${method}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      type: txType,
      timestamp: Date.now(),
      // For hashroot votes, require strict confirmation
      requireConfirmation: txType === 'HASHROOT_VOTE',
      // Default to 1 confirmation, but require more for important operations
      // Use only 1 confirmation for test networks and local development chains
      confirmations: process.env.NODE_ENV === 'test' || 
                     process.env.NETWORK === 'local' || 
                     process.env.NETWORK === 'anvil' ? 1 : 
                     (txType === 'HASHROOT_VOTE' ? 2 : 1)
    };
    
    // Queue the transaction and return the result
    return this.queueTransaction(txEntry);
  }
}
