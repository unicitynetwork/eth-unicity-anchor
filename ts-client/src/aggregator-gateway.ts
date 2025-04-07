import { UniCityAnchorClient } from './client';
import { GatewayConfig, CommitmentRequest, TransactionResult, EventType } from './types';
import { convertDtoToCommitment } from './utils';

/**
 * Client for aggregator gateway operations
 * Handles commitment collection and batch creation
 */
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
    requestID: bigint | string,
    payload: Uint8Array | string,
    authenticator: Uint8Array | string,
  ): Promise<TransactionResult> {
    const id = typeof requestID === 'string' ? BigInt(requestID) : requestID;

    // Convert string payloads to Uint8Array if needed
    const payloadBytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;

    const authBytes =
      typeof authenticator === 'string' ? new TextEncoder().encode(authenticator) : authenticator;

    return this.executeTransaction('submitCommitment', [id, payloadBytes, authBytes]);
  }

  /**
   * Create a new batch from all unprocessed commitments
   * @returns The created batch number and transaction result
   */
  public async createBatch(): Promise<{ batchNumber: bigint; result: TransactionResult }> {
    const result = await this.executeTransaction('createBatch', []);

    // Get the latest batch number to return
    // Note: If the transaction failed, this will be the previous batch number
    const batchNumber = await this.getLatestBatchNumber();

    return { batchNumber, result };
  }

  /**
   * Create a new batch with specific request IDs
   * @param requestIDs Array of request IDs to include in the batch
   * @returns The created batch number and transaction result
   */
  public async createBatchForRequests(
    requestIDs: (bigint | string)[],
  ): Promise<{ batchNumber: bigint; result: TransactionResult }> {
    // Convert string IDs to BigInt
    const ids = requestIDs.map((id) => (typeof id === 'string' ? BigInt(id) : id));

    const result = await this.executeTransaction('createBatchForRequests', [ids]);

    // Get the latest batch number to return
    const batchNumber = await this.getLatestBatchNumber();

    return { batchNumber, result };
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

        if (unprocessedCount >= BigInt(this.batchCreationThreshold)) {
          console.log(`Creating batch with ${unprocessedCount} unprocessed requests`);
          await this.createBatch();
        } else {
          console.log(
            `Not enough unprocessed requests (${unprocessedCount}) to create a batch (threshold: ${this.batchCreationThreshold})`,
          );
        }
      } catch (error) {
        console.error('Error in auto batch creation:', error);
      }
    }, this.batchCreationInterval);

    // Also listen for new commitment requests to create batches when threshold is reached
    this.on(EventType.RequestSubmitted, async () => {
      try {
        const unprocessedCount = await this.getUnprocessedRequestCount();

        if (unprocessedCount >= BigInt(this.batchCreationThreshold)) {
          console.log(`Threshold reached (${unprocessedCount} requests). Creating new batch.`);
          await this.createBatch();
        }
      } catch (error) {
        console.error('Error in request threshold batch creation:', error);
      }
    });
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
    // Basic validation:
    // - Request ID must be positive
    // - Payload and authenticator must not be empty
    if (request.requestID <= 0) {
      return false;
    }

    if (!request.payload || request.payload.length === 0) {
      return false;
    }

    if (!request.authenticator || request.authenticator.length === 0) {
      return false;
    }

    return true;
  }

  /**
   * Process multiple commitment requests in a batch
   * @param requests Array of commitment requests to submit
   * @returns Array of results for each submission
   */
  public async submitMultipleCommitments(
    requests: CommitmentRequest[],
  ): Promise<{ requestID: bigint; result: TransactionResult }[]> {
    const results: { requestID: bigint; result: TransactionResult }[] = [];

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
