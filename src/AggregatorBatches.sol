// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "./IAggregatorBatches.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * Unicity Aggregator Batches Implementation
 */
contract AggregatorBatches is IAggregatorBatches {
    // Use OpenZeppelin's EnumerableSet for efficient set operations
    using EnumerableSet for EnumerableSet.UintSet;

    // Storage for commitment requests (all commitments, both processed and unprocessed)
    mapping(uint256 => CommitmentRequest) private commitments;

    // Set of unprocessed commitment request IDs (not yet in a batch)
    EnumerableSet.UintSet private unprocessedRequestIds;

    // Storage for batches
    mapping(uint256 => Batch) private batches;
    uint256 private latestBatchNumber;
    uint256 private latestProcessedBatchNumber;

    // Aggregator management
    mapping(address => bool) private trustedAggregators;
    mapping(uint256 => mapping(bytes => mapping(address => bool))) private batchHashrootVotes;
    mapping(uint256 => mapping(bytes => uint256)) private batchHashrootVoteCount;

    // Track all submitted hashroots for each batch
    // Store the actual bytes hashroots, not just the hash
    mapping(uint256 => bytes[]) private batchSubmittedHashroots;
    mapping(uint256 => mapping(bytes32 => bool)) private batchHashrootExists;

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

        latestBatchNumber = 0;
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
     * @dev Track all request IDs that have ever been in a batch
     */
    mapping(uint256 => bool) private requestAddedToBatch;

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
    function submitCommitment(uint256 requestID, bytes calldata payload, bytes calldata authenticator)
        external
        override
        onlyTrustedAggregator
    {
        // If this request has been in a batch before
        if (requestAddedToBatch[requestID]) {
            // Get the stored commitment data
            CommitmentRequest storage existingCommitment = commitments[requestID];

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
        commitments[requestID] =
            CommitmentRequest({requestID: requestID, payload: payload, authenticator: authenticator});
        if (!unprocessedRequestIds.contains(requestID)) {
            unprocessedRequestIds.add(requestID);
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

            // Check if this request has been in a batch before
            if (requestAddedToBatch[request.requestID]) {
                // Get the stored commitment data
                CommitmentRequest storage existingCommitment = commitments[request.requestID];

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
            commitments[request.requestID] = CommitmentRequest({
                requestID: request.requestID,
                payload: request.payload,
                authenticator: request.authenticator
            });

            if (!unprocessedRequestIds.contains(request.requestID)) {
                unprocessedRequestIds.add(request.requestID);
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
        //        require(unprocessedRequestIds.length() > 0, "No unprocessed commitments to batch");
        if (unprocessedRequestIds.length() == 0) return 0;

        // Convert set to array for batch creation
        uint256[] memory allRequestIds = new uint256[](unprocessedRequestIds.length());
        for (uint256 i = 0; i < unprocessedRequestIds.length(); i++) {
            allRequestIds[i] = unprocessedRequestIds.at(i);
        }

        return _createBatchInternal(allRequestIds);
    }

    /**
     * @dev Creates a new batch from the current pool of selected unprocessed commitments
     * @param requestIDs Array of specific request IDs to include in the batch
     * @return batchNumber The number of the newly created batch
     */
    function createBatchForRequests(uint256[] calldata requestIDs)
        external
        override
        onlyTrustedAggregator
        returns (uint256)
    {
        //        require(requestIDs.length > 0, "No request IDs provided");
        if (requestIDs.length == 0) return 0;

        // Filter only existing unprocessed requests
        uint256[] memory filteredRequestIDs = new uint256[](requestIDs.length);
        uint256 filteredCount = 0;

        for (uint256 i = 0; i < requestIDs.length; i++) {
            if (unprocessedRequestIds.contains(requestIDs[i])) {
                filteredRequestIDs[filteredCount] = requestIDs[i];
                filteredCount++;
            }
        }

        // Create a properly sized array with only valid IDs
        uint256[] memory validRequestIDs = new uint256[](filteredCount);
        for (uint256 i = 0; i < filteredCount; i++) {
            validRequestIDs[i] = filteredRequestIDs[i];
        }

        require(validRequestIDs.length > 0, "No valid unprocessed request IDs provided");
        return _createBatchInternal(validRequestIDs);
    }
    
    /**
     * @dev Creates a new batch from the current pool of selected unprocessed commitments with explicit batch number
     * @param requestIDs Array of specific request IDs to include in the batch
     * @param explicitBatchNumber The explicit batch number to use for this batch
     * @return batchNumber The number of the newly created batch
     */
    function createBatchForRequestsWithNumber(uint256[] calldata requestIDs, uint256 explicitBatchNumber)
        external
        override
        onlyTrustedAggregator
        returns (uint256)
    {
        if (requestIDs.length == 0) return 0;
        require(explicitBatchNumber > 0, "Batch number must be greater than 0");

        // Filter only existing unprocessed requests
        uint256[] memory filteredRequestIDs = new uint256[](requestIDs.length);
        uint256 filteredCount = 0;

        for (uint256 i = 0; i < requestIDs.length; i++) {
            if (unprocessedRequestIds.contains(requestIDs[i])) {
                filteredRequestIDs[filteredCount] = requestIDs[i];
                filteredCount++;
            }
        }

        // Create a properly sized array with only valid IDs
        uint256[] memory validRequestIDs = new uint256[](filteredCount);
        for (uint256 i = 0; i < filteredCount; i++) {
            validRequestIDs[i] = filteredRequestIDs[i];
        }

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
        uint256[] memory successfulRequestIds = new uint256[](commitmentRequests.length);

        for (uint256 i = 0; i < commitmentRequests.length; i++) {
            CommitmentRequest calldata request = commitmentRequests[i];

            // Check if this request has been in a batch before
            if (requestAddedToBatch[request.requestID]) {
                // Get the stored commitment data
                CommitmentRequest storage existingCommitment = commitments[request.requestID];

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
            commitments[request.requestID] = CommitmentRequest({
                requestID: request.requestID,
                payload: request.payload,
                authenticator: request.authenticator
            });

            if (!unprocessedRequestIds.contains(request.requestID)) {
                unprocessedRequestIds.add(request.requestID);
            }

            emit RequestSubmitted(request.requestID, request.payload);
            successfulRequestIds[successCount] = request.requestID;
            successCount++;
        }

        emit RequestsSubmitted(commitmentRequests.length, successCount);

        // If no commitments were successfully submitted, return early
        if (successCount == 0) return (0, 0);

        // Create properly sized array of request IDs for batch creation
        uint256[] memory requestIds = new uint256[](successCount);
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
    function submitAndCreateBatchWithNumber(CommitmentRequest[] calldata commitmentRequests, uint256 explicitBatchNumber)
        external
        override
        onlyTrustedAggregator
        returns (uint256, uint256)
    {
        if (commitmentRequests.length == 0) return (0, 0);
        require(explicitBatchNumber > 0, "Batch number must be greater than 0");

        // Process each commitment locally without using the external submitCommitments function
        uint256 successCount = 0;
        uint256[] memory successfulRequestIds = new uint256[](commitmentRequests.length);

        for (uint256 i = 0; i < commitmentRequests.length; i++) {
            CommitmentRequest calldata request = commitmentRequests[i];

            // Check if this request has been in a batch before
            if (requestAddedToBatch[request.requestID]) {
                // Get the stored commitment data
                CommitmentRequest storage existingCommitment = commitments[request.requestID];

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
            commitments[request.requestID] = CommitmentRequest({
                requestID: request.requestID,
                payload: request.payload,
                authenticator: request.authenticator
            });

            if (!unprocessedRequestIds.contains(request.requestID)) {
                unprocessedRequestIds.add(request.requestID);
            }

            emit RequestSubmitted(request.requestID, request.payload);
            successfulRequestIds[successCount] = request.requestID;
            successCount++;
        }

        emit RequestsSubmitted(commitmentRequests.length, successCount);

        // If no commitments were successfully submitted, return early
        if (successCount == 0) return (0, 0);

        // Create properly sized array of request IDs for batch creation
        uint256[] memory requestIds = new uint256[](successCount);
        for (uint256 i = 0; i < successCount; i++) {
            requestIds[i] = successfulRequestIds[i];
        }

        // Create a batch with these request IDs and the explicit batch number
        uint256 batchNumber = _createBatchWithExplicitNumber(requestIds, explicitBatchNumber);

        return (batchNumber, successCount);
    }

    /**
     * @dev Internal function to create a batch from specified request IDs
     * @param requestIDs Array of request IDs to include in the batch
     * @return The new batch number
     */
    function _createBatchInternal(uint256[] memory requestIDs) private returns (uint256) {
        // Create a new batch with auto-incremented number
        latestBatchNumber++;
        uint256 newBatchNumber = latestBatchNumber;

        return _createBatchWithExplicitNumber(requestIDs, newBatchNumber);
    }
    
    /**
     * @dev Internal function to create a batch with an explicit batch number
     * @param requestIDs Array of request IDs to include in the batch
     * @param explicitBatchNumber The explicit batch number to use
     * @return The created batch number (same as explicitBatchNumber if successful)
     */
    function _createBatchWithExplicitNumber(uint256[] memory requestIDs, uint256 explicitBatchNumber) private returns (uint256) {
        require(explicitBatchNumber > 0, "Batch number must be greater than 0");
        require(batches[explicitBatchNumber].batchNumber == 0, "Batch number already exists");
        
        // Update latestBatchNumber if the explicit number is greater
        if (explicitBatchNumber > latestBatchNumber) {
            latestBatchNumber = explicitBatchNumber;
        }
        
        // Mark all requests as having been added to a batch
        for (uint256 i = 0; i < requestIDs.length; i++) {
            // This prevents future modifications to the commitment
            requestAddedToBatch[requestIDs[i]] = true;
        }

        // Store the new batch
        batches[explicitBatchNumber] = Batch({
            batchNumber: explicitBatchNumber,
            requestIds: requestIDs,
            hashroot: bytes(""),
            processed: false
        });

        // Remove processed commitments from the unprocessed list
        _removeProcessedCommitments(requestIDs);

        emit BatchCreated(explicitBatchNumber, requestIDs.length);

        return explicitBatchNumber;
    }

    /**
     * @dev Remove processed commitments from the unprocessed list
     * @param processedIds Array of request IDs that have been processed
     */
    function _removeProcessedCommitments(uint256[] memory processedIds) private {
        // Remove each processed ID from the unprocessed set
        for (uint256 i = 0; i < processedIds.length; i++) {
            // Only remove if it exists in the set
            if (unprocessedRequestIds.contains(processedIds[i])) {
                unprocessedRequestIds.remove(processedIds[i]);
            }
        }
    }

    /**
     * @dev Returns a commitment by request ID
     * @param requestID The ID of the commitment to retrieve
     * @return request The commitment request data
     */
    function getCommitment(uint256 requestID) external view returns (CommitmentRequest memory request) {
        return commitments[requestID];
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
        for (uint256 i = latestBatchNumber; i > latestProcessedBatchNumber; i--) {
            if (!batches[i].processed) {
                // Convert the request IDs to full commitment data
                uint256[] storage requestIds = batches[i].requestIds;
                CommitmentRequest[] memory batchRequests = new CommitmentRequest[](requestIds.length);

                for (uint256 j = 0; j < requestIds.length; j++) {
                    batchRequests[j] = commitments[requestIds[j]];
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
        require(batchNumber > 0 && batchNumber <= latestBatchNumber, "Invalid batch number");

        Batch storage batch = batches[batchNumber];

        // Convert the request IDs to full commitment data
        uint256[] storage requestIds = batch.requestIds;
        CommitmentRequest[] memory batchRequests = new CommitmentRequest[](requestIds.length);

        for (uint256 i = 0; i < requestIds.length; i++) {
            batchRequests[i] = commitments[requestIds[i]];
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
     * @dev Returns the number of the latest batch
     * @return batchNumber The number of the latest batch
     */
    function getLatestBatchNumber() external view override returns (uint256 batchNumber) {
        return latestBatchNumber;
    }

    /**
     * @dev Returns the hashroot for a specific batch
     * @param batchNumber The number of the batch
     * @return hashroot The SMT hashroot of the batch
     */
    function getBatchHashroot(uint256 batchNumber) external view override returns (bytes memory hashroot) {
        require(batchNumber > 0 && batchNumber <= latestBatchNumber, "Invalid batch number");

        return batches[batchNumber].hashroot;
    }

    /**
     * @dev Returns the count of unprocessed request IDs in the pool
     * @return count The number of unprocessed request IDs
     */
    function getUnprocessedRequestCount() external view returns (uint256) {
        return unprocessedRequestIds.length();
    }

    /**
     * @dev Returns a specific unprocessed request ID by its index
     * @param index The index in the unprocessed request IDs set
     * @return requestID The request ID at the specified index
     */
    function getUnprocessedRequestAtIndex(uint256 index) external view returns (uint256) {
        require(index < unprocessedRequestIds.length(), "Index out of bounds");
        return unprocessedRequestIds.at(index);
    }

    /**
     * @dev Checks if a request ID is in the unprocessed pool
     * @param requestID The request ID to check
     * @return isUnprocessed True if the request ID is unprocessed, false otherwise
     */
    function isRequestUnprocessed(uint256 requestID) external view returns (bool) {
        return unprocessedRequestIds.contains(requestID);
    }

    /**
     * @dev Returns all unprocessed request IDs
     * @return requestIDs Array of all unprocessed request IDs
     */
    function getAllUnprocessedRequests() external view returns (uint256[] memory) {
        uint256 length = unprocessedRequestIds.length();
        uint256[] memory result = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            result[i] = unprocessedRequestIds.at(i);
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
        return batchHashrootVoteCount[batchNumber][hashroot];
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
     */
    function submitHashroot(uint256 batchNumber, bytes calldata hashroot)
        external
        override
        onlyTrustedAggregator
        returns (bool success)
    {
        // Basic validation
        require(batchNumber > 0 && batchNumber <= latestBatchNumber, "Invalid batch number");
        require(!batches[batchNumber].processed, "Batch already processed");

        // Ensure batch processing happens sequentially
        // The batch to be processed must be exactly the next one after the last processed batch
        require(
            batchNumber == latestProcessedBatchNumber + 1, "Batches must be processed in sequence; can't skip batches"
        );

        // Check if this aggregator has already voted for this specific hashroot
        bool alreadyVotedForThisHashroot = batchHashrootVotes[batchNumber][hashroot][msg.sender];

        // If already voted for this specific hashroot, no need to proceed
        if (alreadyVotedForThisHashroot) {
            return true;
        }

        // Check if the aggregator has already voted for ANY other hashroot for this batch
        bytes[] memory allSubmittedHashroots = getSubmittedHashrootsForBatch(batchNumber);

        // Track if we found a different hashroot vote for this aggregator
        bool hasVotedForDifferentHashroot = false;

        // Check each submitted hashroot to see if this aggregator has voted for it
        for (uint256 i = 0; i < allSubmittedHashroots.length; i++) {
            bytes memory submittedHashroot = allSubmittedHashroots[i];

            // Skip if this is the current hashroot we're voting on
            if (keccak256(submittedHashroot) == keccak256(hashroot)) {
                continue;
            }

            // Check if the aggregator voted for this different hashroot
            if (batchHashrootVotes[batchNumber][submittedHashroot][msg.sender]) {
                hasVotedForDifferentHashroot = true;
                break;
            }
        }

        // If aggregator already voted for a different hashroot for this batch, revert
        if (hasVotedForDifferentHashroot) {
            revert("Aggregator already voted for a different hashroot for this batch");
        }

        // Record the vote
        batchHashrootVotes[batchNumber][hashroot][msg.sender] = true;
        batchHashrootVoteCount[batchNumber][hashroot]++;

        // Track this hashroot if it's new
        bytes32 hashrootHash = keccak256(hashroot);
        if (!batchHashrootExists[batchNumber][hashrootHash]) {
            batchSubmittedHashroots[batchNumber].push(hashroot);
            batchHashrootExists[batchNumber][hashrootHash] = true;
        }

        emit HashrootSubmitted(batchNumber, msg.sender, hashroot);

        // Check if we have enough votes for this hashroot to consider the batch processed
        if (batchHashrootVoteCount[batchNumber][hashroot] >= requiredAggregatorVotes) {
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
}
