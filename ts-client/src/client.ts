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
    this.contract = new ethers.Contract(options.contractAddress, ABI, this.provider);

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
   * Execute a transaction with retry logic
   * @param method The contract method to call
   * @param args Arguments for the method
   * @returns Transaction result
   */
  protected async executeTransaction(method: string, args: any[]): Promise<TransactionResult> {
    if (!this.signer) {
      return {
        success: false,
        error: new Error(
          'No signer available. Initialize client with privateKey to send transactions.',
        ),
      };
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
      try {
        // Estimate gas for the transaction
        const gasEstimate = await this.contract[method].estimateGas(...args);

        // Apply gas multiplier for safety
        const gasLimit = BigInt(Math.floor(Number(gasEstimate) * this.options.gasLimitMultiplier));

        // Send the transaction
        const tx = await this.contract[method](...args, { gasLimit });

        // Wait for the transaction to be mined
        console.log(`Transaction ${tx.hash} sent, waiting for confirmation...`);
        const receipt = await tx.wait();
        console.log(`Transaction ${tx.hash} confirmed in block ${receipt.blockNumber}`);

        return {
          success: true,
          transactionHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
        };
      } catch (error: any) {
        lastError = error;
        console.warn(`Transaction attempt ${attempt + 1} failed: ${error.message}`);

        // Wait before retrying
        if (attempt < this.options.maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, this.options.retryDelay));
        }
      }
    }

    return {
      success: false,
      error: lastError,
    };
  }
}
