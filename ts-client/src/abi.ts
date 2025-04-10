/**
 * ABI for the IAggregatorBatches contract
 */
export const ABI = [
  // Events
  'event RequestSubmitted(uint256 indexed requestID, bytes payload)',
  'event RequestsSubmitted(uint256 count, uint256 successCount)',
  'event BatchCreated(uint256 indexed batchNumber, uint256 requestCount)',
  'event BatchProcessed(uint256 indexed batchNumber, bytes hashroot)',
  'event HashrootSubmitted(uint256 indexed batchNumber, address indexed aggregator, bytes hashroot)',

  // View functions
  'function getCommitment(uint256 requestID) view returns (tuple(uint256 requestID, bytes payload, bytes authenticator))',
  'function getLatestUnprocessedBatch() view returns (uint256 batchNumber, tuple(uint256 requestID, bytes payload, bytes authenticator)[] requests)',
  'function getBatch(uint256 batchNumber) view returns (tuple(uint256 requestID, bytes payload, bytes authenticator)[] requests, bool processed, bytes hashroot)',
  'function getLatestProcessedBatchNumber() view returns (uint256 batchNumber)',
  'function getLatestBatchNumber() view returns (uint256 batchNumber)',
  'function getBatchHashroot(uint256 batchNumber) view returns (bytes hashroot)',
  'function getUnprocessedRequestCount() view returns (uint256)',
  'function getUnprocessedRequestAtIndex(uint256 index) view returns (uint256)',
  'function isRequestUnprocessed(uint256 requestID) view returns (bool)',
  'function getAllUnprocessedRequests() view returns (uint256[])',
  'function getSubmittedHashrootCount(uint256 batchNumber) view returns (uint256 count)',
  'function getHashrootVoteCount(uint256 batchNumber, bytes hashroot) view returns (uint256 voteCount)',

  // Transaction functions
  'function submitCommitment(uint256 requestID, bytes calldata payload, bytes calldata authenticator) external',
  'function submitCommitments(tuple(uint256 requestID, bytes payload, bytes authenticator)[] calldata requests) external returns (uint256 successCount)',
  'function createBatch() external returns (uint256 batchNumber)',
  'function createBatchForRequests(uint256[] calldata requestIDs) external returns (uint256 batchNumber)',
  'function submitAndCreateBatch(tuple(uint256 requestID, bytes payload, bytes authenticator)[] calldata commitmentRequests) external returns (uint256 batchNumber, uint256 successCount)',
  'function submitHashroot(uint256 batchNumber, bytes calldata hashroot) external returns (bool success)',

  // Admin functions
  'function addAggregator(address aggregator) external',
  'function removeAggregator(address aggregator) external',
  'function updateRequiredVotes(uint256 newRequiredVotes) external',
  'function transferOwnership(address newOwner) external',
];
