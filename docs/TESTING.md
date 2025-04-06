# Ethereum Unicity Anchor: Test Specification

This document provides a detailed specification for testing the Ethereum Unicity Anchor system. It outlines the required test cases, expected behaviors, and validation strategies to ensure the proper functioning of the commitment management and batch processing system.

## 1. Core Functionality Tests

### 1.1 Commitment Submission Tests

| Test ID | Description | Steps | Expected Outcome |
|---------|-------------|-------|------------------|
| CS-01 | Basic commitment submission | 1. Submit a valid commitment with unique requestID<br>2. Retrieve the commitment | - Commitment successfully stored<br>- Retrieved data matches submitted data |
| CS-02 | Duplicate commitment submission | 1. Submit a commitment<br>2. Submit the exact same commitment again | - First submission succeeds<br>- Second submission is accepted (idempotent operation) |
| CS-03 | Commitment modification in unprocessed pool | 1. Submit a commitment<br>2. Submit modified commitment with same requestID | - First submission succeeds<br>- Second submission updates the commitment |
| CS-04 | Unauthorized submission attempt | Submit commitment from non-authorized address | Transaction reverts with authorization error |

### 1.2 Batch Creation Tests

| Test ID | Description | Steps | Expected Outcome |
|---------|-------------|-------|------------------|
| BC-01 | Create batch with all unprocessed commitments | 1. Submit multiple commitments<br>2. Call createBatch() | - Batch created with expected number<br>- All commitments included in batch<br>- Commitments removed from unprocessed pool |
| BC-02 | Create batch with specific commitments | 1. Submit multiple commitments<br>2. Call createBatchForRequests() with subset of IDs | - Batch created with specified commitments<br>- Only specified commitments removed from pool |
| BC-03 | Empty batch creation | Call createBatch() with no unprocessed commitments | Returns batch number 0 indicating no batch was created |
| BC-04 | Invalid requests in batch creation | Call createBatchForRequests() with non-existent request IDs | Successfully creates batch with only valid request IDs |

### 1.3 Batch Processing Tests

| Test ID | Description | Steps | Expected Outcome |
|---------|-------------|-------|------------------|
| BP-01 | Basic hashroot submission | 1. Create a batch<br>2. Submit hashroot from required number of aggregators | - Batch marked as processed<br>- Hashroot stored correctly<br>- Latest processed batch number updated |
| BP-02 | Insufficient votes | 1. Create a batch<br>2. Submit hashroot from fewer than required aggregators | Batch remains unprocessed |
| BP-03 | Conflicting hashroots | 1. Create a batch<br>2. Submit different hashroots from different aggregators | - Votes tracked correctly<br>- No processing until threshold met for single hashroot |
| BP-04 | Processing completed batch | 1. Process a batch<br>2. Attempt to submit hashroot for same batch | Transaction reverts with "already processed" error |

## 2. Rule Enforcement Tests

### 2.1 Commitment Modification Rule Tests

| Test ID | Description | Steps | Expected Outcome |
|---------|-------------|-------|------------------|
| CM-01 | Modification after batch inclusion | 1. Submit commitment<br>2. Include in batch<br>3. Attempt to modify | Transaction reverts with modification error |
| CM-02 | Duplicate submission after batch | 1. Submit commitment<br>2. Include in batch<br>3. Submit identical commitment | Operation succeeds but does not add to unprocessed pool |
| CM-03 | Multiple modifications before batch | 1. Submit commitment<br>2. Modify multiple times<br>3. Create batch | - All modifications succeed<br>- Only final version included in batch |

### 2.2 Sequential Processing Tests

| Test ID | Description | Steps | Expected Outcome |
|---------|-------------|-------|------------------|
| SP-01 | Process batches in sequence | 1. Create batches 1, 2, 3<br>2. Process in order 1, 2, 3 | All batches processed successfully |
| SP-02 | Attempt out-of-order processing | 1. Create batches 1, 2, 3<br>2. Attempt to process batch 2 first | Transaction reverts with sequence error |
| SP-03 | Attempt to skip batches | 1. Create batches 1, 2, 3<br>2. Process batch 1<br>3. Attempt to process batch 3 | Transaction reverts with sequence error |
| SP-04 | Continuous sequence processing | 1. Create and process batch 1<br>2. Create and process batch 2<br>3. Verify state | - Both batches processed<br>- Latest processed batch = 2 |

### 2.3 Voting Rule Tests

| Test ID | Description | Steps | Expected Outcome |
|---------|-------------|-------|------------------|
| VR-01 | Single vote per aggregator | 1. Create a batch<br>2. Submit hashroot from aggregator<br>3. Submit again from same aggregator | - First submission succeeds<br>- Second submission is ignored |
| VR-02 | Attempt to vote for different hashroots | 1. Create a batch<br>2. Submit hashroot A from aggregator<br>3. Submit hashroot B from same aggregator | - First submission succeeds<br>- Second submission reverts with already voted error |
| VR-03 | Consensus threshold test | 1. Configure with 3 aggregators, threshold 2<br>2. Submit from 2 aggregators | Batch processed after 2nd submission |
| VR-04 | Near-consensus test | 1. Configure with 5 aggregators, threshold 3<br>2. Submit 2 votes for hashroot A, 2 for hashroot B | - Batch remains unprocessed<br>- 3rd vote for either hashroot triggers processing |

## 3. Integration Tests

### 3.1 Full Processing Flow Tests

| Test ID | Description | Steps | Expected Outcome |
|---------|-------------|-------|------------------|
| FP-01 | Complete lifecycle test | 1. Submit multiple commitments<br>2. Create batches<br>3. Process sequentially<br>4. Verify final state | - All batches processed<br>- All hashroots stored correctly<br>- State variables consistent |
| FP-02 | Mixed processing test | 1. Submit commitments<br>2. Create batch 1<br>3. Submit more commitments<br>4. Create batch 2<br>5. Process both | - Both batches processed correctly<br>- All commitments in appropriate batches |

### 3.2 Administrative Function Tests

| Test ID | Description | Steps | Expected Outcome |
|---------|-------------|-------|------------------|
| AF-01 | Add aggregator | 1. Add new aggregator<br>2. Test functionality | - Aggregator added successfully<br>- New aggregator can submit commitments and hashroots |
| AF-02 | Remove aggregator | 1. Remove existing aggregator<br>2. Test functionality | - Aggregator removed successfully<br>- Former aggregator cannot submit |
| AF-03 | Update required votes | 1. Change vote threshold<br>2. Test batch processing | - Threshold updated<br>- New threshold enforced in processing |
| AF-04 | Transfer ownership | 1. Transfer to new owner<br>2. Test administrative functions | - Ownership transferred<br>- Only new owner can call admin functions |

## 4. Edge Case Tests

### 4.1 Boundary Tests

| Test ID | Description | Steps | Expected Outcome |
|---------|-------------|-------|------------------|
| BT-01 | Empty data handling | 1. Submit commitment with empty payload<br>2. Process normally | - Commitment accepted<br>- Processes correctly |
| BT-02 | Maximum data size | Submit and process commitment with maximum allowable data size | Processes correctly without errors |
| BT-03 | Batch with single commitment | Create and process batch with just one commitment | Processes correctly |

### 4.2 Recovery Tests

| Test ID | Description | Steps | Expected Outcome |
|---------|-------------|-------|------------------|
| RT-01 | Recovery after failed operations | 1. Cause transaction to fail<br>2. Continue with normal operations | System continues functioning correctly |
| RT-02 | Recovery from incomplete consensus | 1. Start batch processing with partial votes<br>2. Complete with additional votes later | Batch eventually processes correctly |

## 5. Performance Tests

### 5.1 Gas Optimization Tests

| Test ID | Description | Steps | Expected Outcome |
|---------|-------------|-------|------------------|
| GO-01 | Gas usage for commitments | Submit commitments of varying sizes and measure gas | Gas usage scales reasonably with data size |
| GO-02 | Gas usage for batch sizes | Create batches of different sizes and measure gas | Gas usage scales linearly with batch size |
| GO-03 | Gas usage for processing | Process batches of different sizes and measure gas | Gas usage remains within acceptable limits |

## 6. Implementation Notes

### 6.1 Test Environment Setup

For comprehensive testing, the following setup is recommended:

1. **Local Development Environment**:
   - Use Foundry's testing framework
   - Set up multiple test accounts for aggregators and users
   - Create test fixtures for common scenarios

2. **Test Data Generation**:
   - Create test sets of varying commitment sizes
   - Generate valid and invalid test cases
   - Prepare edge case inputs

### 6.2 Test Execution

The test suite should be executed:

1. After every significant code change
2. Before every deployment
3. As part of a continuous integration pipeline

### 6.3 Reporting

Test reports should include:

1. Pass/fail status for each test case
2. Gas usage metrics for key operations
3. Any performance regressions or improvements

## 7. Test Case Implementation

For each test case, implement a function with the following structure:

```solidity
function testCaseID() public {
    // Setup - create necessary preconditions
    
    // Action - perform the operation being tested
    
    // Verification - verify the expected outcomes
    assert(...); // Use appropriate assertions
}
```

In Foundry, take advantage of fuzzing capabilities for property-based testing where appropriate:

```solidity
function testFuzz_PropertyName(uint256 randomInput) public {
    // Property-based test that should hold for any valid input
    vm.assume(validationCondition(randomInput)); // Filter input if needed
    
    // Test logic
    
    assert(propertyHolds());
}
```

## 8. Conclusion

This test specification provides a comprehensive framework for validating the Ethereum Unicity Anchor system. By implementing and regularly executing these tests, the system's functionality, security, and performance can be assured across all aspects of operation.