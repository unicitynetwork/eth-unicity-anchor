// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "./IAggregatorBatches.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title Unicity Aggregator Batches
 * @dev A contract for managing the collection, batching, and validation of commitment requests
 * in the Unicity protocol. This contract works as a coordination layer between
 * users submitting commitments and trusted aggregators processing these commitments
 * into Sparse Merkle Trees (SMTs) and validating their integrity.
 *
 * == Overview ==
 *
 * The contract handles three main entities:
 * 1. Commitment Requests: Individual data items with a unique requestID submitted by users.
 * 2. Batches: Collections of commitment requests grouped together for processing.
 * 3. Hashroots: The merkle root of a batch after processing by SMT aggregators.
 *
 * The typical flow is:
 * - Users submit commitment requests through trusted aggregators
 * - Aggregators create batches from these requests (either automatically numbered or with explicit batch numbers)
 * - Aggregators process these batches, generating SMT hashroots
 * - Multiple aggregators vote on hashroots to achieve consensus
 * - Once enough aggregators agree on a hashroot, the batch is considered processed
 *
 * == Batch Numbering System ==
 *
 * The contract supports two batch numbering approaches:
 *
 * 1. Auto-numbering (implicit): When creating a batch without specifying a number, the contract
 *    assigns the next available number, filling gaps in the sequence. Methods:
 *    - createBatch()
 *    - createBatchForRequests()
 *    - submitAndCreateBatch()
 *
 * 2. Explicit numbering: Batches can be created with specific numbers, potentially
 *    creating gaps in the sequence. Methods:
 *    - createBatchForRequestsWithNumber()
 *    - submitAndCreateBatchWithNumber()
 *
 * The contract tracks:
 * - highestBatchNumber: The largest batch number that exists
 * - firstGapIndex: The first available gap in the batch numbering sequence
 *
 * When auto-numbering, the contract always uses firstGapIndex to fill the earliest gap.
 *
 * == Batch Processing ==
 *
 * IMPORTANT: Regardless of how batches are numbered, they MUST be processed in strict
 * sequential order. For example, if batches 1, 3, 5, and 10 exist, they must be
 * processed in that exact order. The contract prevents processing batch 3 until batch 1
 * is processed, and so on.
 *
 * == Commitment Request Management ==
 *
 * - Each commitment has a unique requestID
 * - Once a commitment is included in a batch, it cannot be modified
 * - Commitments can be modified while still in the unprocessed pool
 * - Exact duplicate submissions are silently ignored (same requestID, payload and authenticator)
 * - Attempting to modify a commitment that was in a batch will cause a revert
 *
 * == Hashroot Voting System ==
 *
 * - Each trusted aggregator can vote on a hashroot for a batch
 * - An aggregator cannot vote for different hashroots for the same batch
 * - When the number of votes for a specific hashroot reaches the required threshold,
 *   the batch is marked as processed
 * - The contract tracks all submitted hashroots and their vote counts
 *
 * == Edge Cases ==
 *
 * 1. Double voting: If the same aggregator votes for the same hashroot twice, the second
 *    vote is accepted but doesn't increase the vote count.
 *
 * 2. Conflicting votes: If an aggregator tries to vote for a different hashroot for the
 *    same batch after already voting, the transaction reverts.
 *
 * 3. Duplicate batch numbers: Attempting to create a batch with a number that already
 *    exists will revert.
 *
 * 4. Duplicate commitments: Submitting the exact same commitment (same requestID, payload,
 *    and authenticator) is silently accepted without modifying the existing commitment.
 *
 * 5. Modified commitments: Attempting to modify a commitment (same requestID, different
 *    payload/authenticator) that was previously included in a batch will revert.
 *
 * 6. Batch processing order: Attempting to process batches out of sequence will revert,
 *    even if trying to process a batch that exists.
 *
 * 7. Overlapping batches: If trying to include a commitment in a batch that's already in another
 *    batch, that commitment will be silently skipped.
 *
 * 8. Non-existent batches: Attempting to process a batch that doesn't exist will revert.
 *
 * == Usage ==
 *
 * For Commitment Submission:
 * - submitCommitment(requestID, payload, authenticator) - Submit a single commitment
 * - submitCommitments(requests) - Submit multiple commitments at once
 *
 * For Batch Creation:
 * - createBatch() - Creates a batch from all unprocessed commitments
 * - createBatchForRequests(requestIDs) - Creates a batch from specific commitment requests
 * - createBatchForRequestsWithNumber(requestIDs, explicitBatchNumber) - Creates a batch with specific number
 * - submitAndCreateBatch(commitmentRequests) - Submits commitments and creates a batch in one operation
 * - submitAndCreateBatchWithNumber(commitmentRequests, explicitBatchNumber) - Same with explicit number
 *
 * For Batch Processing:
 * - submitHashroot(batchNumber, hashroot) - Submit a vote for a batch's hashroot
 *
 * For Batch Information:
 * - getBatch(batchNumber) - Get full batch information
 * - getBatchHashroot(batchNumber) - Get the hashroot for a processed batch
 * - getLatestBatchNumber() - Get the highest batch number in the system
 * - getLatestProcessedBatchNumber() - Get the highest processed batch number
 * - getNextAutoNumberedBatch() - Get the next batch number for auto-numbering (first gap)
 *
 * For Commitment Information:
 * - getCommitment(requestID) - Get commitment details
 * - isRequestUnprocessed(requestID) - Check if a request is still unprocessed
 * - getUnprocessedRequestCount() - Get total count of unprocessed requests
 * - getAllUnprocessedRequests() - Get all unprocessed request IDs
 *
 * For Hashroot Information:
 * - getHashrootVoteCount(batchNumber, hashroot) - Get votes for a specific hashroot
 * - getSubmittedHashrootCount(batchNumber) - Get count of unique hashroots submitted
 *
 * Administrative Functions:
 * - addAggregator(aggregator) - Add a trusted aggregator
 * - removeAggregator(aggregator) - Remove a trusted aggregator
 * - updateRequiredVotes(newRequiredVotes) - Update required vote threshold
 * - transferOwnership(newOwner) - Transfer contract ownership
 */
contract AggregatorBatches is IAggregatorBatches {
    // Use OpenZeppelin's EnumerableSet for efficient set operations
    using EnumerableSet for EnumerableSet.AddressSet;

    // Define a custom set for bytes request IDs, since we can't use EnumerableSet directly with bytes
    struct BytesSet {
        bytes[] values;
        mapping(bytes32 => uint256) indices; // hash of bytes -> index in values array + 1 (0 means not in set)
    }

    // Storage for commitment requests (all commitments, both processed and unprocessed)
    mapping(bytes32 => CommitmentRequest) private commitments; // hash of requestId -> CommitmentRequest

    // Set of unprocessed commitment request IDs (not yet in a batch)
    BytesSet private unprocessedRequestIds;

    // Storage for batches
    mapping(uint256 => Batch) private batches;
    uint256 private firstGapIndex; // Tracks the first available gap in batch numbering
    uint256 private highestBatchNumber; // Tracks the highest batch number created
    uint256 private latestProcessedBatchNumber;

    // Aggregator management
    mapping(address => bool) private trustedAggregators;
    mapping(uint256 => mapping(bytes32 => mapping(address => bool))) private batchHashrootVotes; // batch# -> hashroot hash -> aggregator -> voted
    mapping(uint256 => mapping(bytes32 => uint256)) private batchHashrootVoteCount; // batch# -> hashroot hash -> vote count

    // Track all submitted hashroots for each batch
    // Store the actual hashroots, not just the hash
    mapping(uint256 => bytes[]) private batchSubmittedHashroots;
    mapping(uint256 => mapping(bytes32 => bool)) private batchHashrootExists; // batch# -> hashroot hash -> exists

    uint256 private requiredAggregatorVotes;
    uint256 private totalAggregators;

    // Owner for administrative functions
    address private owner;

    // Events (already defined in interface)

    /**
     * @dev Constructor
     * @param _trustedAggregators List of initial trusted aggregator addresses
     * @param _requiredAggregatorVotes Number of votes required to consider a batch processed
     */
    constructor(address[] memory _trustedAggregators, uint256 _requiredAggregatorVotes) {
        require(_trustedAggregators.length > 0, "At least one aggregator required");
        require(
            _requiredAggregatorVotes > 0 && _requiredAggregatorVotes <= _trustedAggregators.length,
            "Invalid votes threshold"
        );

        owner = msg.sender;
        requiredAggregatorVotes = _requiredAggregatorVotes;

        for (uint256 i = 0; i < _trustedAggregators.length; i++) {
            trustedAggregators[_trustedAggregators[i]] = true;
        }
        totalAggregators = _trustedAggregators.length;

        firstGapIndex = 1; // First gap starts at index 1
        highestBatchNumber = 0; // No batches created yet
        latestProcessedBatchNumber = 0;
    }

    /**
     * @dev Modifier to ensure only trusted aggregators can call certain functions
     */
    modifier onlyTrustedAggregator() {
        require(trustedAggregators[msg.sender], "Caller is not a trusted aggregator");
        _;
    }

    /**
     * @dev Modifier to ensure only owner can call administrative functions
     */
    modifier onlyOwner() {
        require(msg.sender == owner, "Caller is not the owner");
        _;
    }

    /**
     * @dev Helper functions for BytesSet
     */
    function _contains(BytesSet storage set, bytes memory value) private view returns (bool) {
        return set.indices[keccak256(value)] != 0;
    }

    function _add(BytesSet storage set, bytes memory value) private returns (bool) {
        bytes32 hash = keccak256(value);
        if (set.indices[hash] == 0) {
            set.values.push(value);
            set.indices[hash] = set.values.length;
            return true;
        }
        return false;
    }

    function _remove(BytesSet storage set, bytes memory value) private returns (bool) {
        bytes32 hash = keccak256(value);
        uint256 index = set.indices[hash];
        
        if (index == 0) return false;
        
        index -= 1; // Adjust for 1-based indexing
        
        // If this is not the last element, move the last element to this position
        if (index != set.values.length - 1) {
            bytes memory lastValue = set.values[set.values.length - 1];
            set.values[index] = lastValue;
            set.indices[keccak256(lastValue)] = index + 1; // Update index for moved element
        }
        
        // Remove the last element
        set.values.pop();
        delete set.indices[hash];
        
        return true;
    }

    function _length(BytesSet storage set) private view returns (uint256) {
        return set.values.length;
    }

    function _at(BytesSet storage set, uint256 index) private view returns (bytes memory) {
        require(index < set.values.length, "Index out of bounds");
        return set.values[index];
    }

    /**
     * @dev Track all request IDs that have ever been in a batch
     */
    mapping(bytes32 => bool) private requestAddedToBatch; // hash of requestId -> was in batch

    /**
     * @dev Submit commitment into the pool of unprocessed commitment requests
     * @param requestID requestID of the commitment
     * @param payload The payload value
     * @param authenticator A byte sequence representing the authenticator
     *
     * Rules:
     * 1. If requestID exists in a batch already:
     *    a. If payload/authenticator match exactly → Skip
     *    b. If payload/authenticator differ → Revert
     * 2. If requestID is in unprocessed pool (never in a batch):
     *    a. Update it with new payload/authenticator
     * 3. If requestID is new:
     *    a. Add it to the unprocessed pool
     */
    function submitCommitment(bytes calldata requestID, bytes calldata payload, bytes calldata authenticator)
        external
        override
        onlyTrustedAggregator
    {
        bytes32 requestIdHash = keccak256(requestID);
        
        // If this request has been in a batch before
        if (requestAddedToBatch[requestIdHash]) {
            // Get the stored commitment data
            CommitmentRequest storage existingCommitment = commitments[requestIdHash];

            // Check if payload and authenticator match exactly
            bytes32 existingPayloadHash = keccak256(existingCommitment.payload);
            bytes32 newPayloadHash = keccak256(payload);
            bytes32 existingAuthHash = keccak256(existingCommitment.authenticator);
            bytes32 newAuthHash = keccak256(authenticator);

            // If either payload or authenticator differ, revert
            if (existingPayloadHash != newPayloadHash || existingAuthHash != newAuthHash) {
                revert("Cannot modify a commitment that was previously in a batch");
            }

            // If they match exactly, skip (don't add back to the pool)
            return;
        }

        // Request is either in the unprocessed pool or brand new
        commitments[requestIdHash] =
            CommitmentRequest({requestID: requestID, payload: payload, authenticator: authenticator});
        if (!_contains(unprocessedRequestIds, requestID)) {
            _add(unprocessedRequestIds, requestID);
        }

        emit RequestSubmitted(requestID, payload);
    }

    /**
     * @dev Submit multiple commitments into the pool of unprocessed commitment requests in a single transaction
     * @param requests Array of commitment requests to submit
     * @return successCount The number of successfully submitted commitments
     */
    function submitCommitments(CommitmentRequest[] calldata requests)
        external
        override
        onlyTrustedAggregator
        returns (uint256)
    {
        uint256 successCount = 0;

        for (uint256 i = 0; i < requests.length; i++) {
            CommitmentRequest calldata request = requests[i];
            bytes32 requestIdHash = keccak256(request.requestID);

            // Check if this request has been in a batch before
            if (requestAddedToBatch[requestIdHash]) {
                // Get the stored commitment data
                CommitmentRequest storage existingCommitment = commitments[requestIdHash];

                // Check if payload and authenticator match exactly
                bytes32 existingPayloadHash = keccak256(existingCommitment.payload);
                bytes32 newPayloadHash = keccak256(request.payload);
                bytes32 existingAuthHash = keccak256(existingCommitment.authenticator);
                bytes32 newAuthHash = keccak256(request.authenticator);

                // If either payload or authenticator differ, skip this request
                if (existingPayloadHash != newPayloadHash || existingAuthHash != newAuthHash) {
                    continue; // Skip this request but continue processing others
                }

                // If they match exactly, skip (don't add back to the pool)
                successCount++;
                continue;
            }

            // Request is either in the unprocessed pool or brand new
            commitments[requestIdHash] = CommitmentRequest({
                requestID: request.requestID,
                payload: request.payload,
                authenticator: request.authenticator
            });

            if (!_contains(unprocessedRequestIds, request.requestID)) {
                _add(unprocessedRequestIds, request.requestID);
            }

            emit RequestSubmitted(request.requestID, request.payload);
            successCount++;
        }

        emit RequestsSubmitted(requests.length, successCount);
        return successCount;
    }

    /**
     * @dev Creates a new batch from the current pool of all unprocessed commitments
     * @return batchNumber The number of the newly created batch
     */
    function createBatch() external override onlyTrustedAggregator returns (uint256) {
        if (_length(unprocessedRequestIds) == 0) return 0;

        // Convert set to array for batch creation
        bytes[] memory allRequestIds = new bytes[](_length(unprocessedRequestIds));
        for (uint256 i = 0; i < _length(unprocessedRequestIds); i++) {
            allRequestIds[i] = _at(unprocessedRequestIds, i);
        }

        return _createBatchInternal(allRequestIds);
    }

    /**
     * @dev Creates a new batch from the current pool of selected unprocessed commitments
     * @param requestIDs Array of specific request IDs to include in the batch
     * @return batchNumber The number of the newly created batch
     */
    function createBatchForRequests(bytes[] calldata requestIDs)
        external
        override
        onlyTrustedAggregator
        returns (uint256)
    {
        if (requestIDs.length == 0) return 0;

        // Use centralized filtering function to get valid request IDs
        bytes[] memory validRequestIDs = _filterValidRequestsForBatch(requestIDs);

        require(validRequestIDs.length > 0, "No valid unprocessed request IDs provided");
        return _createBatchInternal(validRequestIDs);
    }

    /**
     * @dev Creates a new batch from the current pool of selected unprocessed commitments with explicit batch number
     * @param requestIDs Array of specific request IDs to include in the batch
     * @param explicitBatchNumber The explicit batch number to use for this batch
     * @return batchNumber The number of the newly created batch
     */
    function createBatchForRequestsWithNumber(bytes[] calldata requestIDs, uint256 explicitBatchNumber)
        external
        override
        onlyTrustedAggregator
        returns (uint256)
    {
        if (requestIDs.length == 0) return 0;
        require(explicitBatchNumber > 0, "Batch number must be greater than 0");

        // Use centralized filtering function to get valid request IDs
        bytes[] memory validRequestIDs = _filterValidRequestsForBatch(requestIDs);

        require(validRequestIDs.length > 0, "No valid unprocessed request IDs provided");
        return _createBatchWithExplicitNumber(validRequestIDs, explicitBatchNumber);
    }

    /**
     * @dev Submit multiple commitments and create a batch containing them in a single transaction
     * @param commitmentRequests Array of commitment requests to submit
     * @return batchNumber The number of the newly created batch
     * @return successCount The number of successfully submitted commitments
     */
    function submitAndCreateBatch(CommitmentRequest[] calldata commitmentRequests)
        external
        override
        onlyTrustedAggregator
        returns (uint256, uint256)
    {
        if (commitmentRequests.length == 0) return (0, 0);

        // Process each commitment locally without using the external submitCommitments function
        uint256 successCount = 0;
        bytes[] memory successfulRequestIds = new bytes[](commitmentRequests.length);

        for (uint256 i = 0; i < commitmentRequests.length; i++) {
            CommitmentRequest calldata request = commitmentRequests[i];
            bytes32 requestIdHash = keccak256(request.requestID);

            // Check if this request has been in a batch before
            if (requestAddedToBatch[requestIdHash]) {
                // Get the stored commitment data
                CommitmentRequest storage existingCommitment = commitments[requestIdHash];

                // Check if payload and authenticator match exactly
                bytes32 existingPayloadHash = keccak256(existingCommitment.payload);
                bytes32 newPayloadHash = keccak256(request.payload);
                bytes32 existingAuthHash = keccak256(existingCommitment.authenticator);
                bytes32 newAuthHash = keccak256(request.authenticator);

                // If either payload or authenticator differ, skip this request
                if (existingPayloadHash != newPayloadHash || existingAuthHash != newAuthHash) {
                    continue; // Skip this request but continue processing others
                }

                // If they match exactly, mark as success but don't add to unprocessed
                successfulRequestIds[successCount] = request.requestID;
                successCount++;
                continue;
            }

            // Request is either in the unprocessed pool or brand new
            commitments[requestIdHash] = CommitmentRequest({
                requestID: request.requestID,
                payload: request.payload,
                authenticator: request.authenticator
            });

            if (!_contains(unprocessedRequestIds, request.requestID)) {
                _add(unprocessedRequestIds, request.requestID);
            }

            emit RequestSubmitted(request.requestID, request.payload);
            successfulRequestIds[successCount] = request.requestID;
            successCount++;
        }

        emit RequestsSubmitted(commitmentRequests.length, successCount);

        // If no commitments were successfully submitted, return early
        if (successCount == 0) return (0, 0);

        // Create properly sized array of request IDs for batch creation
        bytes[] memory requestIds = new bytes[](successCount);
        for (uint256 i = 0; i < successCount; i++) {
            requestIds[i] = successfulRequestIds[i];
        }

        // Create a batch with these request IDs
        uint256 batchNumber = _createBatchInternal(requestIds);

        return (batchNumber, successCount);
    }

    /**
     * @dev Submit multiple commitments and create a batch containing them with an explicit batch number
     * @param commitmentRequests Array of commitment requests to submit
     * @param explicitBatchNumber The explicit batch number to use for this batch
     * @return batchNumber The number of the newly created batch
     * @return successCount The number of successfully submitted commitments
     */
    function submitAndCreateBatchWithNumber(
        CommitmentRequest[] calldata commitmentRequests,
        uint256 explicitBatchNumber
    ) external override onlyTrustedAggregator returns (uint256, uint256) {
        if (commitmentRequests.length == 0) return (0, 0);
        require(explicitBatchNumber > 0, "Batch number must be greater than 0");

        // Process each commitment locally without using the external submitCommitments function
        uint256 successCount = 0;
        bytes[] memory successfulRequestIds = new bytes[](commitmentRequests.length);

        for (uint256 i = 0; i < commitmentRequests.length; i++) {
            CommitmentRequest calldata request = commitmentRequests[i];
            bytes32 requestIdHash = keccak256(request.requestID);

            // Check if this request has been in a batch before
            if (requestAddedToBatch[requestIdHash]) {
                // Get the stored commitment data
                CommitmentRequest storage existingCommitment = commitments[requestIdHash];

                // Check if payload and authenticator match exactly
                bytes32 existingPayloadHash = keccak256(existingCommitment.payload);
                bytes32 newPayloadHash = keccak256(request.payload);
                bytes32 existingAuthHash = keccak256(existingCommitment.authenticator);
                bytes32 newAuthHash = keccak256(request.authenticator);

                // If either payload or authenticator differ, skip this request
                if (existingPayloadHash != newPayloadHash || existingAuthHash != newAuthHash) {
                    continue; // Skip this request but continue processing others
                }

                // If they match exactly, mark as success but don't add to unprocessed
                successfulRequestIds[successCount] = request.requestID;
                successCount++;
                continue;
            }

            // Request is either in the unprocessed pool or brand new
            commitments[requestIdHash] = CommitmentRequest({
                requestID: request.requestID,
                payload: request.payload,
                authenticator: request.authenticator
            });

            if (!_contains(unprocessedRequestIds, request.requestID)) {
                _add(unprocessedRequestIds, request.requestID);
            }

            emit RequestSubmitted(request.requestID, request.payload);
            successfulRequestIds[successCount] = request.requestID;
            successCount++;
        }

        emit RequestsSubmitted(commitmentRequests.length, successCount);

        // If no commitments were successfully submitted, return early
        if (successCount == 0) return (0, 0);

        // Create properly sized array of request IDs for batch creation
        bytes[] memory requestIds = new bytes[](successCount);
        for (uint256 i = 0; i < successCount; i++) {
            requestIds[i] = successfulRequestIds[i];
        }

        // Create a batch with these request IDs and the explicit batch number
        uint256 batchNumber = _createBatchWithExplicitNumber(requestIds, explicitBatchNumber);

        return (batchNumber, successCount);
    }

    /**
     * @dev Filters a list of request IDs to only include valid ones for batching
     * This is a centralized function to ensure consistent rules are applied for all batch operations
     *
     * @param requestIDs Array of request IDs to filter
     * @return filteredIDs Array of valid request IDs that can be added to a batch
     */
    function _filterValidRequestsForBatch(bytes[] memory requestIDs) private view returns (bytes[] memory) {
        // First pass: count valid requests
        uint256 validCount = 0;
        for (uint256 i = 0; i < requestIDs.length; i++) {
            bytes32 requestIdHash = keccak256(requestIDs[i]);
            
            // A valid request must:
            // 1. Be in the unprocessed pool
            // 2. Not already be marked as added to a batch
            // This double-check protects against edge cases where a request might somehow
            // remain in the unprocessed pool despite being marked as batched
            if (_contains(unprocessedRequestIds, requestIDs[i]) && !requestAddedToBatch[requestIdHash]) {
                validCount++;
            }
        }

        // Second pass: create properly sized array and fill it
        bytes[] memory validRequestIDs = new bytes[](validCount);
        uint256 validIndex = 0;

        for (uint256 i = 0; i < requestIDs.length; i++) {
            bytes32 requestIdHash = keccak256(requestIDs[i]);
            
            if (_contains(unprocessedRequestIds, requestIDs[i]) && !requestAddedToBatch[requestIdHash]) {
                validRequestIDs[validIndex] = requestIDs[i];
                validIndex++;
            }
        }

        return validRequestIDs;
    }

    /**
     * @dev Internal function to create a batch from specified request IDs
     * @param requestIDs Array of request IDs to include in the batch
     * @return The new batch number
     */
    function _createBatchInternal(bytes[] memory requestIDs) private returns (uint256) {
        // Use the first available gap for the new batch number
        uint256 newBatchNumber = firstGapIndex;

        return _createBatchWithExplicitNumber(requestIDs, newBatchNumber);
    }

    /**
     * @dev Find the next gap in batch numbering after the given index
     * @param startIndex The index to start searching from
     * @return The next available batch number (gap)
     */
    function _findNextGap(uint256 startIndex) private view returns (uint256) {
        uint256 nextIndex = startIndex + 1;

        // Find the next gap
        while (batches[nextIndex].batchNumber != 0) {
            nextIndex++;
        }

        return nextIndex;
    }

    /**
     * @dev Internal function to create a batch with an explicit batch number
     * @param requestIDs Array of request IDs to include in the batch
     * @param explicitBatchNumber The explicit batch number to use
     * @return The created batch number (same as explicitBatchNumber if successful)
     */
    function _createBatchWithExplicitNumber(bytes[] memory requestIDs, uint256 explicitBatchNumber)
        private
        returns (uint256)
    {
        require(explicitBatchNumber > 0, "Batch number must be greater than 0");
        require(batches[explicitBatchNumber].batchNumber == 0, "Batch number already exists");

        // Update highestBatchNumber if the explicit number is greater
        if (explicitBatchNumber > highestBatchNumber) {
            highestBatchNumber = explicitBatchNumber;
        }

        // If we're filling the current firstGapIndex, update it to the next gap
        if (explicitBatchNumber == firstGapIndex) {
            firstGapIndex = _findNextGap(firstGapIndex);
        }

        // Mark all requests as having been added to a batch
        for (uint256 i = 0; i < requestIDs.length; i++) {
            // This prevents future modifications to the commitment
            bytes32 requestIdHash = keccak256(requestIDs[i]);
            requestAddedToBatch[requestIdHash] = true;
        }

        // Create an empty hashroot
        bytes memory emptyHashroot = bytes("");
        
        // Store the new batch
        batches[explicitBatchNumber] =
            Batch({batchNumber: explicitBatchNumber, requestIds: requestIDs, hashroot: emptyHashroot, processed: false});

        // Remove processed commitments from the unprocessed list
        _removeProcessedCommitments(requestIDs);

        emit BatchCreated(explicitBatchNumber, requestIDs.length);

        return explicitBatchNumber;
    }

    /**
     * @dev Remove processed commitments from the unprocessed list
     * @param processedIds Array of request IDs that have been processed
     */
    function _removeProcessedCommitments(bytes[] memory processedIds) private {
        // Remove each processed ID from the unprocessed set
        for (uint256 i = 0; i < processedIds.length; i++) {
            // Only remove if it exists in the set
            if (_contains(unprocessedRequestIds, processedIds[i])) {
                _remove(unprocessedRequestIds, processedIds[i]);
            }
        }
    }

    /**
     * @dev Returns a commitment by request ID
     * @param requestID The ID of the commitment to retrieve
     * @return request The commitment request data
     */
    function getCommitment(bytes calldata requestID) external view override returns (CommitmentRequest memory request) {
        bytes32 requestIdHash = keccak256(requestID);
        return commitments[requestIdHash];
    }

    /**
     * @dev Returns the latest unprocessed batch
     * @return batchNumber The number of the latest unprocessed batch
     * @return requests Array of commitment requests in the batch
     */
    function getLatestUnprocessedBatch()
        external
        view
        override
        returns (uint256 batchNumber, CommitmentRequest[] memory requests)
    {
        // Find the latest unprocessed batch
        for (uint256 i = highestBatchNumber; i > latestProcessedBatchNumber; i--) {
            if (batches[i].batchNumber != 0 && !batches[i].processed) {
                // Convert the request IDs to full commitment data
                bytes[] storage requestIds = batches[i].requestIds;
                CommitmentRequest[] memory batchRequests = new CommitmentRequest[](requestIds.length);

                for (uint256 j = 0; j < requestIds.length; j++) {
                    bytes32 requestIdHash = keccak256(requestIds[j]);
                    batchRequests[j] = commitments[requestIdHash];
                }

                return (i, batchRequests);
            }
        }

        // Return empty if no unprocessed batch found
        CommitmentRequest[] memory emptyRequests = new CommitmentRequest[](0);
        return (0, emptyRequests);
    }

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
        override
        returns (CommitmentRequest[] memory requests, bool processed, bytes memory hashroot)
    {
        require(batchNumber > 0 && batchNumber <= highestBatchNumber, "Invalid batch number");
        require(batches[batchNumber].batchNumber != 0, "Batch does not exist");

        Batch storage batch = batches[batchNumber];

        // Convert the request IDs to full commitment data
        bytes[] storage requestIds = batch.requestIds;
        CommitmentRequest[] memory batchRequests = new CommitmentRequest[](requestIds.length);

        for (uint256 i = 0; i < requestIds.length; i++) {
            bytes32 requestIdHash = keccak256(requestIds[i]);
            batchRequests[i] = commitments[requestIdHash];
        }

        return (batchRequests, batch.processed, batch.hashroot);
    }

    /**
     * @dev Returns the number of the latest processed batch
     * @return batchNumber The number of the latest processed batch
     */
    function getLatestProcessedBatchNumber() external view override returns (uint256 batchNumber) {
        return latestProcessedBatchNumber;
    }

    /**
     * @dev Returns the number of the latest batch (highest batch number)
     * @return batchNumber The number of the latest batch
     */
    function getLatestBatchNumber() external view override returns (uint256 batchNumber) {
        return highestBatchNumber;
    }

    /**
     * @dev Returns the next available batch number for auto-numbering (first gap)
     * @return batchNumber The next available batch number
     */
    function getNextAutoNumberedBatch() external view returns (uint256 batchNumber) {
        return firstGapIndex;
    }

    /**
     * @dev Returns the hashroot for a specific batch
     * @param batchNumber The number of the batch
     * @return hashroot The SMT hashroot of the batch
     */
    function getBatchHashroot(uint256 batchNumber) external view override returns (bytes memory hashroot) {
        require(batchNumber > 0 && batchNumber <= highestBatchNumber, "Invalid batch number");
        require(batches[batchNumber].batchNumber != 0, "Batch does not exist");

        return batches[batchNumber].hashroot;
    }

    /**
     * @dev Returns the count of unprocessed request IDs in the pool
     * @return count The number of unprocessed request IDs
     */
    function getUnprocessedRequestCount() external view returns (uint256) {
        return _length(unprocessedRequestIds);
    }

    /**
     * @dev Returns a specific unprocessed request ID by its index
     * @param index The index in the unprocessed request IDs set
     * @return requestID The request ID at the specified index
     */
    function getUnprocessedRequestAtIndex(uint256 index) external view returns (bytes memory) {
        require(index < _length(unprocessedRequestIds), "Index out of bounds");
        return _at(unprocessedRequestIds, index);
    }

    /**
     * @dev Checks if a request ID is in the unprocessed pool
     * @param requestID The request ID to check
     * @return isUnprocessed True if the request ID is unprocessed, false otherwise
     */
    function isRequestUnprocessed(bytes calldata requestID) external view returns (bool) {
        return _contains(unprocessedRequestIds, requestID);
    }

    /**
     * @dev Returns all unprocessed request IDs
     * @return requestIDs Array of all unprocessed request IDs
     */
    function getAllUnprocessedRequests() external view returns (bytes[] memory) {
        uint256 length = _length(unprocessedRequestIds);
        bytes[] memory result = new bytes[](length);

        for (uint256 i = 0; i < length; i++) {
            result[i] = _at(unprocessedRequestIds, i);
        }

        return result;
    }

    /**
     * @dev Returns all submitted hashroots for a specific batch (internal function)
     * @param batchNumber The batch number to query
     * @return hashroots Array of submitted hashroots for the batch
     */
    function getSubmittedHashrootsForBatch(uint256 batchNumber) internal view returns (bytes[] memory) {
        return batchSubmittedHashroots[batchNumber];
    }

    /**
     * @dev Returns all submitted hashroots for a specific batch (public function)
     * @param batchNumber The batch number to query
     * @return count The number of unique hashroots submitted for the batch
     */
    function getSubmittedHashrootCount(uint256 batchNumber) external view returns (uint256 count) {
        return batchSubmittedHashroots[batchNumber].length;
    }

    /**
     * @dev Returns the number of votes for a specific hashroot in a batch
     * @param batchNumber The batch number to query
     * @param hashroot The hashroot to check
     * @return voteCount The number of votes for this hashroot
     */
    function getHashrootVoteCount(uint256 batchNumber, bytes calldata hashroot)
        external
        view
        returns (uint256 voteCount)
    {
        bytes32 hashrootHash = keccak256(hashroot);
        return batchHashrootVoteCount[batchNumber][hashrootHash];
    }

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
        override
        returns (bool voted) 
    {
        // Basic validation
        require(batchNumber > 0 && batchNumber <= highestBatchNumber, "Invalid batch number");
        require(batches[batchNumber].batchNumber != 0, "Batch does not exist");
        
        // Check if the aggregator has voted for this hashroot
        bytes32 hashrootHash = keccak256(hashroot);
        return batchHashrootVotes[batchNumber][hashrootHash][aggregator];
    }

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
        override
        returns (bool hasVoted, bytes memory votedHashroot)
    {
        // Basic validation
        require(batchNumber > 0 && batchNumber <= highestBatchNumber, "Invalid batch number");
        require(batches[batchNumber].batchNumber != 0, "Batch does not exist");
        
        // Get all submitted hashroots for this batch
        bytes[] memory allSubmittedHashroots = getSubmittedHashrootsForBatch(batchNumber);
        
        // Check if the aggregator has voted for any of these hashroots
        for (uint256 i = 0; i < allSubmittedHashroots.length; i++) {
            bytes memory submittedHashroot = allSubmittedHashroots[i];
            bytes32 submittedHashrootHash = keccak256(submittedHashroot);
            
            // Check if the aggregator voted for this hashroot
            if (batchHashrootVotes[batchNumber][submittedHashrootHash][aggregator]) {
                return (true, submittedHashroot);
            }
        }
        
        // Aggregator hasn't voted for any hashroot
        return (false, "");
    }

    /**
     * @dev Submits an updated hashroot after processing a batch
     * @param batchNumber The number of the batch that was processed
     * @param hashroot The new SMT hashroot after processing the batch
     * @return success Boolean indicating if the submission was successful
     *
     * Rules:
     * 1. Batches must be processed sequentially; can't skip any batch
     * 2. Each aggregator can vote only once per (batch, hashroot) combination
     * 3. Batch is processed when requiredAggregatorVotes is reached for the same hashroot
     * 4. If the batch is already processed but with the same hashroot, accept silently
     */
    function submitHashroot(uint256 batchNumber, bytes calldata hashroot)
        external
        override
        onlyTrustedAggregator
        returns (bool success)
    {
        // Basic validation
        require(batchNumber > 0 && batchNumber <= highestBatchNumber, "Invalid batch number");
        require(batches[batchNumber].batchNumber != 0, "Batch does not exist");

        // If batch is processed, check if it has the same hashroot we're trying to submit
        if (batches[batchNumber].processed) {
            // Compare the existing hashroot with what we're trying to submit
            // If it's the same, accept silently (useful for retries and redundant submissions)
            // If different, revert with a clear error message
            bytes memory existingHashroot = batches[batchNumber].hashroot;
            bytes32 existingHashrootHash = keccak256(existingHashroot);
            bytes32 newHashrootHash = keccak256(hashroot);
            bool isSameHashroot = existingHashrootHash == newHashrootHash;
            
            // If same hashroot, silently accept the submission - supporting retries and fault tolerance
            if (isSameHashroot) {
                return true;
            } else {
                // Different hashroot - this is a serious issue, reject clearly
                revert("Cannot submit different hashroot for already processed batch");
            }
        }

        // Ensure batch processing happens sequentially
        // The batch to be processed must be exactly the next one after the last processed batch
        require(
            batchNumber == latestProcessedBatchNumber + 1, "Batches must be processed in sequence; can't skip batches"
        );

        // Convert hashroot to bytes32 hash for storage mappings
        bytes32 hashrootHash = keccak256(hashroot);
        
        // Check if this aggregator has already voted for this specific hashroot
        bool alreadyVotedForThisHashroot = batchHashrootVotes[batchNumber][hashrootHash][msg.sender];

        // If already voted for this specific hashroot, no need to proceed
        if (alreadyVotedForThisHashroot) {
            return true;
        }

        // Check if the aggregator has already voted for ANY other hashroot for this batch
        bytes[] memory allSubmittedHashroots = batchSubmittedHashroots[batchNumber];

        // Track if we found a different hashroot vote for this aggregator
        bool hasVotedForDifferentHashroot = false;

        // Check each submitted hashroot to see if this aggregator has voted for it
        for (uint256 i = 0; i < allSubmittedHashroots.length; i++) {
            bytes memory submittedHashroot = allSubmittedHashroots[i];
            bytes32 submittedHashrootHash = keccak256(submittedHashroot);

            // Skip if this is the current hashroot we're voting on
            if (submittedHashrootHash == hashrootHash) {
                continue;
            }

            // Check if the aggregator voted for this different hashroot
            if (batchHashrootVotes[batchNumber][submittedHashrootHash][msg.sender]) {
                hasVotedForDifferentHashroot = true;
                break;
            }
        }

        // If aggregator already voted for a different hashroot for this batch, revert
        if (hasVotedForDifferentHashroot) {
            revert("Aggregator already voted for a different hashroot for this batch");
        }

        // Record the vote
        batchHashrootVotes[batchNumber][hashrootHash][msg.sender] = true;
        batchHashrootVoteCount[batchNumber][hashrootHash]++;

        // Track this hashroot if it's new
        if (!batchHashrootExists[batchNumber][hashrootHash]) {
            batchSubmittedHashroots[batchNumber].push(hashroot);
            batchHashrootExists[batchNumber][hashrootHash] = true;
        }

        emit HashrootSubmitted(batchNumber, msg.sender, hashroot);

        // Check if we have enough votes for this hashroot to consider the batch processed
        if (batchHashrootVoteCount[batchNumber][hashrootHash] >= requiredAggregatorVotes) {
            // Mark batch as processed and update hashroot
            batches[batchNumber].processed = true;
            batches[batchNumber].hashroot = hashroot;

            // Update latest processed batch number
            latestProcessedBatchNumber = batchNumber;

            emit BatchProcessed(batchNumber, hashroot);
        }

        return true;
    }

    // Administrative functions

    /**
     * @dev Add a new trusted aggregator
     * @param aggregator Address of the new aggregator
     */
    function addAggregator(address aggregator) external onlyOwner {
        require(!trustedAggregators[aggregator], "Aggregator already exists");

        trustedAggregators[aggregator] = true;
        totalAggregators++;
    }

    /**
     * @dev Remove a trusted aggregator
     * @param aggregator Address of the aggregator to remove
     */
    function removeAggregator(address aggregator) external onlyOwner {
        require(trustedAggregators[aggregator], "Aggregator does not exist");
        require(
            totalAggregators > requiredAggregatorVotes, "Cannot remove aggregator: would make required votes impossible"
        );

        trustedAggregators[aggregator] = false;
        totalAggregators--;
    }

    /**
     * @dev Update required number of aggregator votes
     * @param newRequiredVotes New threshold for required votes
     */
    function updateRequiredVotes(uint256 newRequiredVotes) external onlyOwner {
        require(newRequiredVotes > 0 && newRequiredVotes <= totalAggregators, "Invalid votes threshold");

        requiredAggregatorVotes = newRequiredVotes;
    }

    /**
     * @dev Transfer ownership of the contract
     * @param newOwner Address of the new owner
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner cannot be zero address");

        owner = newOwner;
    }

    /**
     * @dev TEST ONLY FUNCTION - DO NOT USE IN PRODUCTION
     * This function exists only for unit testing edge cases
     *
     * Allows tests to force a requestID into the unprocessed pool even if
     * it has already been marked as added to a batch. This helps test the
     * defensive programming against edge cases where a request is both
     * in the unprocessed pool and marked as batched.
     *
     * @param requestID The request ID to force into the unprocessed pool
     */
    function _testOnlyForceAddToUnprocessedPool(bytes calldata requestID) external onlyOwner {
        // Add the requestID to the unprocessed pool without changing requestAddedToBatch
        _add(unprocessedRequestIds, requestID);
    }
}
