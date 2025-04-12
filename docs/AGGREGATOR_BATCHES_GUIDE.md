# Ethereum Unicity Anchor: AggregatorBatches Contract Guide

This document provides a comprehensive technical guide for the AggregatorBatches contract, detailing its functionality, behavior, and how to properly integrate with it.

## 1. Overview

The AggregatorBatches contract serves as a coordination layer between users submitting commitments and trusted aggregators that process these commitments into Sparse Merkle Trees. It handles the entire lifecycle of commitment requests from submission to batch creation and consensus-based processing.

### 1.1 Core Entities

- **Commitment Requests**: Individual data items with a unique requestID submitted by users
- **Batches**: Collections of commitment requests grouped together for processing
- **Hashroots**: The merkle root of a batch after processing by SMT aggregators
- **Trusted Aggregators**: Authorized entities that can submit commitments, create batches, and vote on hashroots

### 1.2 Key Workflows

1. **Commitment submission**: Trusted aggregators submit commitments on behalf of users
2. **Batch creation**: Commitments are organized into batches (either with auto-numbering or explicit numbering)
3. **Batch processing**: Aggregators process batches and submit hashroots
4. **Consensus**: When enough aggregators agree on a hashroot, the batch is marked as processed

## 2. Commitment Request Management

### 2.1 Submission and Modification Rules

- Each commitment is uniquely identified by its `requestID`
- Commitments can be submitted individually or in batches
- Modification rules:
  - Commitments can be freely modified while in the unprocessed pool
  - Once included in a batch, a commitment cannot be modified
  - Exact duplicates of already processed commitments are accepted silently
  - Attempted modifications of processed commitments will revert

### 2.2 Code Examples

```solidity
// Submit a single commitment
aggregator.submitCommitment(
    123456,                     // requestID
    bytes("payload data"),      // payload
    bytes("authenticator data") // authenticator
);

// Submit multiple commitments in one transaction
IAggregatorBatches.CommitmentRequest[] memory requests = new IAggregatorBatches.CommitmentRequest[](2);
requests[0] = IAggregatorBatches.CommitmentRequest({
    requestID: 101,
    payload: bytes("payload 1"),
    authenticator: bytes("auth 1")
});
requests[1] = IAggregatorBatches.CommitmentRequest({
    requestID: 102,
    payload: bytes("payload 2"),
    authenticator: bytes("auth 2")
});
uint256 successCount = aggregator.submitCommitments(requests);
```

### 2.3 Edge Cases

#### Handling Duplicate Submissions
- If the exact same commitment (same requestID, payload, and authenticator) is submitted twice:
  - The second submission is silently accepted but doesn't modify the existing commitment
  - There is no error and no state change

```solidity
// Original submission
aggregator.submitCommitment(100, bytes("payload"), bytes("auth"));
// Exact duplicate - silently accepted
aggregator.submitCommitment(100, bytes("payload"), bytes("auth"));
```

#### Handling Modified Resubmissions
- If a commitment is modified and resubmitted:
  - If the commitment is still in the unprocessed pool, it will be updated
  - If the commitment has been in a batch, the transaction will revert

```solidity
// Original submission
aggregator.submitCommitment(100, bytes("original"), bytes("auth"));
// Modified submission while unprocessed - successfully updates
aggregator.submitCommitment(100, bytes("updated"), bytes("auth"));

// After being included in a batch:
// This will revert with "Cannot modify a commitment that was previously in a batch"
aggregator.submitCommitment(100, bytes("trying to modify"), bytes("auth"));
```

## 3. Batch Management

### 3.1 Batch Numbering System

The contract supports two types of batch numbering:

#### Auto-numbering (Implicit)
- Auto-numbered batches always fill the first available gap in the sequence
- The contract tracks the first gap using the `firstGapIndex` variable
- Auto-numbered batches are created using:
  - `createBatch()`
  - `createBatchForRequests()`
  - `submitAndCreateBatch()`

#### Explicit Numbering
- Batches can be created with explicitly specified numbers using:
  - `createBatchForRequestsWithNumber()`
  - `submitAndCreateBatchWithNumber()`
- This allows creating batches with non-sequential numbers, potentially creating gaps

### 3.2 Gap Tracking and Filling

The contract carefully tracks and fills gaps in the batch numbering sequence:

1. `firstGapIndex`: Always points to the first available gap in the sequence
2. `highestBatchNumber`: Tracks the highest batch number that exists

When a batch is created with explicit numbering:
- If it creates a new gap, the `firstGapIndex` remains unchanged
- If it fills the current `firstGapIndex`, the index is updated to the next gap

When a batch is created with auto-numbering:
- It always uses the current `firstGapIndex` value
- After creation, `firstGapIndex` is updated to the next gap

#### Gap Finding Algorithm

The contract uses the `_findNextGap` function to find the next available gap after the current gap is filled:

```solidity
function _findNextGap(uint256 startIndex) private view returns (uint256) {
    uint256 nextIndex = startIndex + 1;
    
    // Find the next gap
    while (batches[nextIndex].batchNumber != 0) {
        nextIndex++;
    }
    
    return nextIndex;
}
```

### 3.3 Batch Creation Examples

```solidity
// Create a batch with all unprocessed commitments (auto-numbered)
uint256 batchNumber = aggregator.createBatch();

// Create a batch with specific requests (auto-numbered)
uint256[] memory requestIDs = new uint256[](2);
requestIDs[0] = 101;
requestIDs[1] = 102;
uint256 batchNumber = aggregator.createBatchForRequests(requestIDs);

// Create a batch with specific number
uint256[] memory requestIDs = new uint256[](2);
requestIDs[0] = 201;
requestIDs[1] = 202;
uint256 explicitBatchNumber = 5; // Create batch #5 specifically
uint256 batchNumber = aggregator.createBatchForRequestsWithNumber(requestIDs, explicitBatchNumber);

// Submit commitments and create a batch in one operation (auto-numbered)
(uint256 batchNumber, uint256 successCount) = aggregator.submitAndCreateBatch(commitmentRequests);
```

### 3.4 Edge Cases

#### Creating Batches with Duplicate Numbers

- If a batch with the specified number already exists, the transaction will revert:

```solidity
// Create batch #5
aggregator.createBatchForRequestsWithNumber(requestIDs, 5);

// This will revert with "Batch number already exists"
aggregator.createBatchForRequestsWithNumber(otherRequestIDs, 5);
```

#### Creating Batches with No Valid Requests

- If no valid unprocessed requests are provided, the transaction will revert:

```solidity
// This will revert with "No valid unprocessed request IDs provided"
aggregator.createBatchForRequests(alreadyProcessedIDs);
```

#### Creating Batch with Zero Number

- Attempting to create a batch with number 0 will revert:

```solidity
// This will revert with "Batch number must be greater than 0"
aggregator.createBatchForRequestsWithNumber(requestIDs, 0);
```

#### Overlapping Batches

- If trying to include a request that's already in another batch, it will be silently skipped:

```solidity
// Create first batch with requests 101, 102
requestIDs1[0] = 101;
requestIDs1[1] = 102;
aggregator.createBatchForRequests(requestIDs1);

// Create second batch that tries to include 102 again plus 103
requestIDs2[0] = 102; // Already in a batch
requestIDs2[1] = 103; // New request
// This succeeds but only includes 103, silently skipping 102
aggregator.createBatchForRequests(requestIDs2);
```

## 4. Batch Processing and Consensus

### 4.1 Sequential Processing Requirement

The most important rule for batch processing:

**Batches MUST be processed in strict sequential order, regardless of how they were created.**

For example, if batches 1, 3, 5, and 10 exist, they must be processed in that exact order (1, then 3, then 5, then 10).

### 4.2 Validation Order

When trying to process a batch, the contract performs validation in this order:

1. Validates the batch number is valid (`> 0` and `<= highestBatchNumber`)
2. Checks if the batch exists
3. Confirms the batch isn't already processed
4. Verifies the batch is the next one to be processed (`batchNumber == latestProcessedBatchNumber + 1`)

### 4.3 Hashroot Voting System

- Each trusted aggregator can vote on a hashroot for a specific batch
- An aggregator can only vote for one hashroot per batch
- When a hashroot receives enough votes (reaching the required threshold), the batch is marked as processed
- The required vote threshold is configurable by the contract owner

### 4.4 Processing Examples

```solidity
// Submit a hashroot vote for batch #1
aggregator.submitHashroot(1, bytes("hashroot data"));

// When enough votes are received for the same hashroot, the batch is processed
```

### 4.5 Edge Cases

#### Processing Non-existent Batches

- Attempting to process a batch that doesn't exist will revert:

```solidity
// If batch #4, #6, #7, etc. don't exist:
// This will revert with "Batch does not exist"
aggregator.submitHashroot(4, bytes("hashroot"));
```

#### Processing Batches Out of Order

- Attempting to process batches out of sequence will revert:

```solidity
// If batch #1 is not yet processed:
// This will revert with "Batches must be processed in sequence; can't skip batches"
aggregator.submitHashroot(2, bytes("hashroot"));
```

#### Double Voting

- If the same aggregator submits the same hashroot twice for the same batch:
  - The second submission is accepted but doesn't increase the vote count
  - No error is thrown, and the vote count remains the same

```solidity
// First vote
aggregator.submitHashroot(1, bytes("hashroot"));
// Second vote for same hashroot - accepted but doesn't increase count
aggregator.submitHashroot(1, bytes("hashroot"));
```

#### Conflicting Votes

- If an aggregator tries to vote for a different hashroot for the same batch after already voting:
  - The transaction will revert

```solidity
// First vote
aggregator.submitHashroot(1, bytes("hashroot1"));
// This will revert with "Aggregator already voted for a different hashroot for this batch"
aggregator.submitHashroot(1, bytes("hashroot2"));
```

#### Processing Already Processed Batches

- Attempting to process a batch that's already processed will revert:

```solidity
// After batch #1 is processed:
// This will revert with "Batch already processed"
aggregator.submitHashroot(1, bytes("hashroot"));
```

## 5. Practical Integration Guidelines

### 5.1 Recommended Workflow for Client Applications

1. **Commitment Submission**:
   - Collect user commitments
   - Submit through trusted aggregators
   - Track submission status

2. **Batch Management**:
   - Monitor unprocessed commitment pool
   - Trigger batch creation when sufficient commitments are available
   - For auto-numbered batches, use `getNextAutoNumberedBatch()` to check the next batch number

3. **Batch Processing**:
   - Process batches in sequential order
   - Check `getLatestProcessedBatchNumber()` to determine the next batch to process
   - Submit hashroots for consensus

### 5.2 Handling Common Scenarios

#### Determining Next Batch to Process

```javascript
// In client code:
const latestProcessed = await aggregator.getLatestProcessedBatchNumber();
const nextBatchToProcess = latestProcessed + 1;

// Check if this batch exists
try {
  const batchInfo = await aggregator.getBatch(nextBatchToProcess);
  // Batch exists, process it
  processAndSubmitHashroot(nextBatchToProcess);
} catch {
  // Batch doesn't exist, wait or create it
}
```

#### Creating Batches Efficiently

```javascript
// Fill gaps in batch numbering
async function createBatchInNextGap() {
  const nextGap = await aggregator.getNextAutoNumberedBatch();
  console.log(`Creating batch at next gap: ${nextGap}`);
  return aggregator.createBatch();
}

// Create batch with specific number
async function createBatchWithExplicitNumber(batchNum, requestIDs) {
  // Validate batch number doesn't exist
  try {
    await aggregator.getBatch(batchNum);
    console.error(`Batch ${batchNum} already exists`);
    return false;
  } catch {
    // Batch doesn't exist, we can create it
    return aggregator.createBatchForRequestsWithNumber(requestIDs, batchNum);
  }
}
```

### 5.3 Monitoring and Troubleshooting

#### Key Metrics to Monitor

1. **Unprocessed Request Count**:
   - Use `getUnprocessedRequestCount()` to track backlog
   - Create batches when count exceeds threshold

2. **Batch Processing Status**:
   - Track gap between `getLatestBatchNumber()` and `getLatestProcessedBatchNumber()`
   - Large gaps might indicate processing delays

3. **Hashroot Consensus Progress**:
   - Use `getHashrootVoteCount()` to monitor voting progress
   - Use `getSubmittedHashrootCount()` to detect potential consensus issues

#### Common Issues and Solutions

1. **Batch Processing Stalls**:
   - Problem: Batches aren't being processed sequentially
   - Solution: Focus aggregator resources on processing the next batch in sequence

2. **Missing Batch Numbers**:
   - Problem: Gaps in batch sequence preventing processing of later batches
   - Solution: Create missing batches with explicit numbering to fill gaps

3. **Hashroot Disagreements**:
   - Problem: Aggregators submitting different hashroots for the same batch
   - Solution: Investigate divergence in SMT construction or batch content

## 6. Advanced Topics

### 6.1 Gas Optimization Strategies

- **Batch commitment submissions** using `submitCommitments()` instead of individual calls
- **Use selective batch creation** with `createBatchForRequests()` for optimal batch sizes
- **Combine submission and batch creation** with `submitAndCreateBatch()` to save gas

### 6.2 Security Considerations

- Only trusted aggregators should be granted permission to submit commitments and hashroots
- The required vote threshold should be set to an appropriate value based on the total number of aggregators
- Regular monitoring for unusual patterns in commitment submissions or hashroot voting
- Consider the aggregator incentive structure to prevent collusion or neglect

### 6.3 Scaling Considerations

- For high-volume applications, implement commitment batching at the API level
- Consider gas costs when determining optimal batch sizes
- Implement efficient off-chain tracking of commitment status
- For extremely large systems, consider sharding commitments across multiple instances

## 7. Conclusion

The AggregatorBatches contract provides a robust framework for commitment submission, batching, and consensus-based processing. By understanding its behavior in detail, especially around batch numbering, gap filling, and sequential processing requirements, integrators can build reliable and efficient systems that leverage this contract effectively.

Key takeaways:
1. Batches must be processed in strict sequential order
2. Auto-numbered batches automatically fill gaps in the sequence
3. Explicit batch numbering allows for flexible batch organization
4. Hashroot consensus ensures all aggregators maintain a unified view
5. Clear edge case handling ensures predictable contract behavior