
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
 *  - requestID - uint256 integer representing unique request id
 *  - payload - a byte sequence value
 *  - authenticator - a byte sequence arbitrary value
 **/

interface IAggregatorBatches {
    /**
     * @dev Struct for representing a commitment request
     */
    struct CommitmentRequest {
        uint256 requestID;
        bytes payload;
        bytes authenticator;
    }

    /**
     * @dev Struct for representing a batch of commitment requests
     */
    struct Batch {
        uint256 batchNumber;
        CommitmentRequest[] requests;
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
    function submitCommitment(uint256 requestID, bytes calldata payload, bytes calldata authenticator) external;

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
    function createBatchForRequests(uint256[] calldata requestIDs) external returns (uint256 batchNumber);

    /**
     * @dev Returns the latest unprocessed batch
     * @return batchNumber The number of the latest unprocessed batch
     * @return requests Array of commitment requests in the batch
     */
    function getLatestUnprocessedBatch() external view returns (uint256 batchNumber, CommitmentRequest[] memory requests);

    /**
     * @dev Returns a batch by its number
     * @param batchNumber The number of the batch to retrieve
     * @return requests Array of commitment requests in the batch
     * @return processed Boolean indicating if the batch has been processed
     * @return hashroot The SMT hashroot of the batch (if processed)
     */
    function getBatch(uint256 batchNumber) external view returns (CommitmentRequest[] memory requests, bool processed, bytes memory hashroot);

    /**
     * @dev Returns the number of the latest processed batch
     * @return batchNumber The number of the latest processed batch
     */
    function getLatestProcessedBatchNumber() external view returns (uint256 batchNumber);

    /**
     * @dev Returns the number of the latest batch
     * @return batchNumber The number of the latest batch
     */
    function getLatestBatchNumber() external view returns (uint256 batchNumber);

    /**
     * @dev Returns the hashroot for a specific batch
     * @param batchNumber The number of the batch
     * @return hashroot The SMT hashroot of the batch
     */
    function getBatchHashroot(uint256 batchNumber) external view returns (bytes memory hashroot);

    /**
     * @dev Submits an updated hashroot after processing a batch.
     *  Majority of aggregators must submit same hashroot for the given batch in order the batch to be considered processed.
     * @param batchNumber The number of the batch that was processed
     * @param hashroot The new SMT hashroot after processing the batch
     * @return success Boolean indicating if the submission was successful
     */
    function submitHashroot(uint256 batchNumber, bytes calldata hashroot) external returns (bool success);

    /**
     * @dev Event emitted when a new commitment request is added to the pool
     */
    event RequestSubmitted(uint256 indexed requestID, bytes payload);

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