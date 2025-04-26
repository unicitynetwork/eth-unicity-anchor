/**
 * ABI for the IAggregatorBatches contract
 */
export const ABI = [
  // Events
  'event RequestSubmitted(bytes indexed requestID, bytes payload)',
  'event RequestsSubmitted(uint256 count, uint256 successCount)',
  'event BatchCreated(uint256 indexed batchNumber, uint256 requestCount)',
  'event BatchProcessed(uint256 indexed batchNumber, bytes hashroot)',
  'event HashrootSubmitted(uint256 indexed batchNumber, address indexed aggregator, bytes hashroot)',

  // View functions
  'function getCommitment(bytes requestID) view returns (tuple(bytes requestID, bytes payload, bytes authenticator))',
  'function getLatestUnprocessedBatch() view returns (uint256 batchNumber, tuple(bytes requestID, bytes payload, bytes authenticator)[] requests)',
  'function getBatch(uint256 batchNumber) view returns (tuple(bytes requestID, bytes payload, bytes authenticator)[] requests, bool processed, bytes hashroot)',
  'function getLatestProcessedBatchNumber() view returns (uint256 batchNumber)',
  'function getLatestBatchNumber() view returns (uint256 batchNumber)',
  'function getNextAutoNumberedBatch() view returns (uint256 batchNumber)',
  'function getBatchHashroot(uint256 batchNumber) view returns (bytes hashroot)',
  'function getUnprocessedRequestCount() view returns (uint256)',
  'function getUnprocessedRequestAtIndex(uint256 index) view returns (bytes)',
  'function isRequestUnprocessed(bytes requestID) view returns (bool)',
  'function getAllUnprocessedRequests() view returns (bytes[])',
  'function getSubmittedHashrootCount(uint256 batchNumber) view returns (uint256 count)',
  'function getHashrootVoteCount(uint256 batchNumber, bytes hashroot) view returns (uint256 voteCount)',
  'function hasAggregatorVotedForHashroot(uint256 batchNumber, bytes hashroot, address aggregator) view returns (bool voted)',
  'function getAggregatorVoteForBatch(uint256 batchNumber, address aggregator) view returns (bool hasVoted, bytes votedHashroot)',

  // Transaction functions
  'function submitCommitment(bytes calldata requestID, bytes calldata payload, bytes calldata authenticator) external',
  'function submitCommitments(tuple(bytes requestID, bytes payload, bytes authenticator)[] calldata requests) external returns (uint256 successCount)',
  'function createBatch() external returns (uint256 batchNumber)',
  'function createBatchForRequests(bytes[] calldata requestIDs) external returns (uint256 batchNumber)',
  'function submitAndCreateBatch(tuple(bytes requestID, bytes payload, bytes authenticator)[] calldata commitmentRequests) external returns (uint256 batchNumber, uint256 successCount)',
  'function submitHashroot(uint256 batchNumber, bytes calldata hashroot) external returns (bool success)',

  // Admin functions
  'function addAggregator(address aggregator) external',
  'function removeAggregator(address aggregator) external',
  'function updateRequiredVotes(uint256 newRequiredVotes) external',
  'function transferOwnership(address newOwner) external',
];
