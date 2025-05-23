// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

/**
 * Unicity Aggregator Batches Interface
 *
 * Manages global storage of commitment requests organized into sequence of batches, manages the queue of batches for the processing by the SMT aggregators.
 * SMT aggregators are external trusted servicies that aggregate commitment requests represented as leafs into the SMT data structure
 *
 * Mode of operation:
 *  - We have number of trusted aggregator gateway services that accept request commitment submissions from users and forward these request into the AggregatorBatches contract instance for the further storage and processing
 *  - Aggregator gateways generate tick calls for creating the next batch of unprocessed requests out of the current pool of the unprocessed requests
 *  - Trusted aggregators pick up the first unprocessed batch, process it and update their SMT hashroot respectively. If sufficient number of aggregators have submitted same updated hashroot for the same batch, then this hashroot is assigned to the batch and the batch is considered processed
 *
 * Specific functions:
 *  - collect requests into the pool of unprocessed commitment requests by a trusted aggregator gateway service
 *  - turns the current pool of commitments into a new batch of unprocessed commitment requests (the call is submitted periodically by the trusted aggregator gateway either for the whole pool or for specific requests)
 *  - returns the latest unprocessed batch (the batch number and set of commitment requests)
 *  - returns batch by number
 *  - returns the number of the latest processed batch
 *  - returns the number of the latest unprocessed batch
 *  - returns the hashroot for the batch number
 *  - submit updated hashroot of the aggregator tree from processing the batch with the number
 *
 * Request commitment fields
 *  - requestID - bytes type representing unique request id
 *  - payload - a byte sequence value
 *  - authenticator - a byte sequence arbitrary value
 *
 */
interface IAggregatorBatches {
    /**
     * @dev RequestId is represented as bytes for arbitrary length
     * We use bytes directly rather than a custom type since Solidity
     * doesn't allow user-defined value types to be based on reference types like bytes
     */
    
    /**
     * @dev HashRoot is represented as bytes for arbitrary length
     * We use bytes directly rather than a custom type
     */
    
    /**
     * @dev Struct for representing a commitment request
     */
    struct CommitmentRequest {
        bytes requestID;
        bytes payload;
        bytes authenticator;
    }

    /**
     * @dev Struct for representing a batch of commitment requests
     * Stores only the request IDs instead of the full commitment data
     * to save gas and storage space
     */
    struct Batch {
        uint256 batchNumber;
        bytes[] requestIds;
        bytes hashroot;
        bool processed;
    }

    /**
     * @dev Submit commitment into the pool of unprocessed commitment requests
     * @param requestID requestID of the commitment
     * @param payload The payload value (ex, hash of the respective transaction)
     * @param authenticator A byte sequence representing the authenticator
     * Reverts if the operation was not successful. You cannot submit commitments with the same requestId but different payloads and authenticators.
     *   However, exactly same request can be submitted multiple times, but added just once into the global commitment storage.
     */
    function submitCommitment(bytes calldata requestID, bytes calldata payload, bytes calldata authenticator) external;

    /**
     * @dev Submit multiple commitments into the pool of unprocessed commitment requests in a single transaction
     * @param requests Array of commitment requests to submit
     * @return successCount The number of successfully submitted commitments
     *
     * For each commitment, the same rules apply as in submitCommitment:
     * - If a requestID exists in a batch already with different payload/authenticator, that commitment is skipped
     * - If a requestID is new or in unprocessed pool, it is added/updated
     */
    function submitCommitments(CommitmentRequest[] calldata requests) external returns (uint256 successCount);

    /**
     * @dev Creates a new batch from the current pool of all unprocessed commitments
     * @return batchNumber The number of the newly created batch
     */
    function createBatch() external returns (uint256 batchNumber);

    /**
     * @dev Creates a new batch from the current pool of selected unprocessed commitments
     * @param requestIDs Array of specific request IDs to include in the batch
     * @return batchNumber The number of the newly created batch
     */
    function createBatchForRequests(bytes[] calldata requestIDs) external returns (uint256 batchNumber);

    /**
     * @dev Creates a new batch from the current pool of selected unprocessed commitments with an explicit batch number
     * @param requestIDs Array of specific request IDs to include in the batch
     * @param explicitBatchNumber The explicit batch number to use for this batch
     * @return batchNumber The number of the newly created batch
     *
     * This allows creating batches with specific numbers, potentially creating gaps in the batch sequence.
     * When gaps exist, the system will track both the highest batch number and the first available gap.
     * Auto-numbered batches will always use the first available gap, filling in gaps in the sequence.
     * Regardless of batch numbering, batch processing must still occur in strict sequential order.
     */
    function createBatchForRequestsWithNumber(bytes[] calldata requestIDs, uint256 explicitBatchNumber)
        external
        returns (uint256 batchNumber);

    /**
     * @dev Submit multiple commitments and create a batch containing them in a single transaction
     * @param commitmentRequests Array of commitment requests to submit
     * @return batchNumber The number of the newly created batch
     * @return successCount The number of successfully submitted commitments
     *
     * This function combines submitCommitments and createBatchForRequests in a single atomic operation.
     * First, it submits all the provided commitments, then creates a batch containing all successfully submitted requests.
     * If all submissions fail, no batch is created and the function returns batch number 0.
     */
    function submitAndCreateBatch(CommitmentRequest[] calldata commitmentRequests)
        external
        returns (uint256 batchNumber, uint256 successCount);

    /**
     * @dev Submit multiple commitments and create a batch containing them with an explicit batch number
     * @param commitmentRequests Array of commitment requests to submit
     * @param explicitBatchNumber The explicit batch number to use for this batch
     * @return batchNumber The number of the newly created batch
     * @return successCount The number of successfully submitted commitments
     *
     * This function combines submitCommitments and createBatchForRequestsWithNumber in a single atomic operation.
     * First, it submits all the provided commitments, then creates a batch with the specified number.
     * If all submissions fail, no batch is created and the function returns batch number 0.
     *
     * This allows creating batches with specific numbers, potentially creating gaps in the batch sequence.
     * When gaps exist, the system will track both the highest batch number and the first available gap.
     * Auto-numbered batches will always use the first available gap, filling in gaps in the sequence.
     * Regardless of batch numbering, batch processing must still occur in strict sequential order.
     */
    function submitAndCreateBatchWithNumber(
        CommitmentRequest[] calldata commitmentRequests,
        uint256 explicitBatchNumber
    ) external returns (uint256 batchNumber, uint256 successCount);

    /**
     * @dev Returns the latest unprocessed batch
     * @return batchNumber The number of the latest unprocessed batch
     * @return requests Array of commitment requests in the batch
     */
    function getLatestUnprocessedBatch()
        external
        view
        returns (uint256 batchNumber, CommitmentRequest[] memory requests);

    /**
     * @dev Returns a batch by its number
     * @param batchNumber The number of the batch to retrieve
     * @return requests Array of commitment requests in the batch
     * @return processed Boolean indicating if the batch has been processed
     * @return hashroot The SMT hashroot of the batch (if processed)
     */
    function getBatch(uint256 batchNumber)
        external
        view
        returns (CommitmentRequest[] memory requests, bool processed, bytes memory hashroot);

    /**
     * @dev Returns the number of the latest processed batch
     * @return batchNumber The number of the latest processed batch
     */
    function getLatestProcessedBatchNumber() external view returns (uint256 batchNumber);

    /**
     * @dev Returns the number of the latest batch (highest batch number created)
     * @return batchNumber The number of the latest batch
     */
    function getLatestBatchNumber() external view returns (uint256 batchNumber);

    /**
     * @dev Returns the next available batch number for auto-numbering (first available gap)
     * @return batchNumber The next available batch number
     */
    function getNextAutoNumberedBatch() external view returns (uint256 batchNumber);

    /**
     * @dev Returns the hashroot for a specific batch
     * @param batchNumber The number of the batch
     * @return hashroot The SMT hashroot of the batch
     */
    function getBatchHashroot(uint256 batchNumber) external view returns (bytes memory hashroot);

    /**
     * @dev Returns a commitment request by its ID
     * @param requestID The ID of the commitment request to retrieve
     * @return request The commitment request data
     */
    function getCommitment(bytes calldata requestID) external view returns (CommitmentRequest memory request);

    /**
     * @dev Submits an updated hashroot after processing a batch.
     *  Majority of aggregators must submit same hashroot for the given batch in order the batch to be considered processed.
     * @param batchNumber The number of the batch that was processed
     * @param hashroot The new SMT hashroot after processing the batch
     * @return success Boolean indicating if the submission was successful
     */
    function submitHashroot(uint256 batchNumber, bytes calldata hashroot) external returns (bool success);

    /**
     * @dev Checks if a specific aggregator has voted for a specific hashroot in a batch
     * @param batchNumber The batch number to query
     * @param hashroot The hashroot to check
     * @param aggregator The address of the aggregator to check
     * @return voted True if the aggregator has voted for this hashroot, false otherwise
     */
    function hasAggregatorVotedForHashroot(uint256 batchNumber, bytes calldata hashroot, address aggregator) 
        external 
        view 
        returns (bool voted);

    /**
     * @dev Gets the hashroot that an aggregator has voted for in a batch (if any)
     * @param batchNumber The batch number to query
     * @param aggregator The address of the aggregator to check
     * @return hasVoted True if the aggregator has voted for any hashroot
     * @return votedHashroot The hashroot the aggregator voted for (empty if none)
     */
    function getAggregatorVoteForBatch(uint256 batchNumber, address aggregator)
        external
        view
        returns (bool hasVoted, bytes memory votedHashroot);

    /**
     * @dev Event emitted when a new commitment request is added to the pool
     */
    event RequestSubmitted(bytes indexed requestID, bytes payload);

    /**
     * @dev Event emitted when multiple commitment requests are added to the pool in a batch operation
     */
    event RequestsSubmitted(uint256 count, uint256 successCount);

    /**
     * @dev Event emitted when a new batch is created
     */
    event BatchCreated(uint256 indexed batchNumber, uint256 requestCount);

    /**
     * @dev Event emitted when a batch is processed (received enough aggregator submissions)
     */
    event BatchProcessed(uint256 indexed batchNumber, bytes hashroot);

    /**
     * @dev Event emitted when an aggregator submits a hashroot
     */
    event HashrootSubmitted(uint256 indexed batchNumber, address indexed aggregator, bytes hashroot);
}
