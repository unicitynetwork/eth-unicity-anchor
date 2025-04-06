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
        require(_requiredAggregatorVotes > 0 && _requiredAggregatorVotes <= _trustedAggregators.length, "Invalid votes threshold");
        
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
     * @dev Submit commitment into the pool of unprocessed commitment requests
     * @param requestID requestID of the commitment
     * @param payload The payload value
     * @param authenticator A byte sequence representing the authenticator
     */
    function submitCommitment(uint256 requestID, bytes calldata payload, bytes calldata authenticator) external override onlyTrustedAggregator {
        // Check if this requestID already exists in commitments
        bool alreadyExists = unprocessedRequestIds.contains(requestID);
        bool needToAdd = !alreadyExists;
        
        if (needToAdd) {
            // Add to commitments storage
            commitments[requestID] = CommitmentRequest({
                requestID: requestID,
                payload: payload,
                authenticator: authenticator
            });
            
            // Add to unprocessed set
            unprocessedRequestIds.add(requestID);
            
            emit RequestSubmitted(requestID, payload);
        }
    }
    
    /**
     * @dev Creates a new batch from the current pool of all unprocessed commitments
     * @return batchNumber The number of the newly created batch
     */
    function createBatch() external override onlyTrustedAggregator returns (uint256) {
        require(unprocessedRequestIds.length() > 0, "No unprocessed commitments to batch");
        
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
    function createBatchForRequests(uint256[] calldata requestIDs) external override onlyTrustedAggregator returns (uint256) {
        require(requestIDs.length > 0, "No request IDs provided");
        
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
     * @dev Internal function to create a batch from specified request IDs
     * @param requestIDs Array of request IDs to include in the batch
     * @return The new batch number
     */
    function _createBatchInternal(uint256[] memory requestIDs) private returns (uint256) {
        // Create a new batch
        latestBatchNumber++;
        uint256 newBatchNumber = latestBatchNumber;
        
        // Create array of requests for the batch
        CommitmentRequest[] memory batchRequests = new CommitmentRequest[](requestIDs.length);
        for (uint256 i = 0; i < requestIDs.length; i++) {
            batchRequests[i] = commitments[requestIDs[i]];
        }
        
        // Store the new batch
        batches[newBatchNumber] = Batch({
            batchNumber: newBatchNumber,
            requests: batchRequests,
            hashroot: bytes(""),
            processed: false
        });
        
        // Remove processed commitments from the unprocessed list
        _removeProcessedCommitments(requestIDs);
        
        emit BatchCreated(newBatchNumber, requestIDs.length);
        
        return newBatchNumber;
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
     * @dev Returns the latest unprocessed batch
     * @return batchNumber The number of the latest unprocessed batch
     * @return requests Array of commitment requests in the batch
     */
    function getLatestUnprocessedBatch() external view override returns (uint256 batchNumber, CommitmentRequest[] memory requests) {
        // Find the latest unprocessed batch
        for (uint256 i = latestBatchNumber; i > latestProcessedBatchNumber; i--) {
            if (!batches[i].processed) {
                return (i, batches[i].requests);
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
    function getBatch(uint256 batchNumber) external view override returns (CommitmentRequest[] memory requests, bool processed, bytes memory hashroot) {
        require(batchNumber > 0 && batchNumber <= latestBatchNumber, "Invalid batch number");
        
        Batch storage batch = batches[batchNumber];
        return (batch.requests, batch.processed, batch.hashroot);
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
     * @dev Submits an updated hashroot after processing a batch
     * @param batchNumber The number of the batch that was processed
     * @param hashroot The new SMT hashroot after processing the batch
     * @return success Boolean indicating if the submission was successful
     */
    function submitHashroot(uint256 batchNumber, bytes calldata hashroot) external override onlyTrustedAggregator returns (bool success) {
        require(batchNumber > 0 && batchNumber <= latestBatchNumber, "Invalid batch number");
        require(!batches[batchNumber].processed, "Batch already processed");
        
        // Check if this aggregator has already voted
        if (!batchHashrootVotes[batchNumber][hashroot][msg.sender]) {
            // Record the vote
            batchHashrootVotes[batchNumber][hashroot][msg.sender] = true;
            batchHashrootVoteCount[batchNumber][hashroot]++;
            
            emit HashrootSubmitted(batchNumber, msg.sender, hashroot);
            
            // Check if we have enough votes for this hashroot
            if (batchHashrootVoteCount[batchNumber][hashroot] >= requiredAggregatorVotes) {
                // Mark batch as processed and update hashroot
                batches[batchNumber].processed = true;
                batches[batchNumber].hashroot = hashroot;
                
                // Update latest processed batch number if needed
                if (batchNumber > latestProcessedBatchNumber) {
                    latestProcessedBatchNumber = batchNumber;
                }
                
                emit BatchProcessed(batchNumber, hashroot);
            }
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
        require(totalAggregators > requiredAggregatorVotes, "Cannot remove aggregator: would make required votes impossible");
        
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