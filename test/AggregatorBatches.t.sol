// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, console} from "forge-std/Test.sol";
import "../src/AggregatorBatches.sol";
import "../src/IAggregatorBatches.sol";

contract AggregatorBatchesTest is Test {
    AggregatorBatches public aggregator;
    address public owner;
    address[] public trustedAggregators;
    address public nonAggregator;

    function setUp() public {
        // Setup test accounts
        owner = address(this);
        address aggregator1 = address(0x1);
        address aggregator2 = address(0x2);
        address aggregator3 = address(0x3);
        nonAggregator = address(0x999);

        // Set up trusted aggregators
        trustedAggregators = new address[](3);
        trustedAggregators[0] = aggregator1;
        trustedAggregators[1] = aggregator2;
        trustedAggregators[2] = aggregator3;

        // Deploy contract with 2 out of 3 required votes
        aggregator = new AggregatorBatches(trustedAggregators, 2);

        // Give the test contract some ether
        vm.deal(owner, 10 ether);
    }

    function testSubmitCommitment() public {
        // Prepare test data
        uint256 requestID = 1;
        bytes memory payload = bytes("test payload");
        bytes memory authenticator = bytes("test authenticator");

        // Submit as aggregator1
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(requestID, payload, authenticator);

        // Create batch
        vm.prank(trustedAggregators[0]);
        uint256 batchNumber = aggregator.createBatch();

        // Verify batch was created
        assertEq(batchNumber, 1, "Batch number should be 1");
    }

    function testSubmitCommitments() public {
        // Prepare multiple test commitments
        IAggregatorBatches.CommitmentRequest[] memory requests = new IAggregatorBatches.CommitmentRequest[](3);

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

        requests[2] = IAggregatorBatches.CommitmentRequest({
            requestID: 103,
            payload: bytes("payload 3"),
            authenticator: bytes("auth 3")
        });

        // Submit as aggregator1
        vm.prank(trustedAggregators[0]);
        uint256 successCount = aggregator.submitCommitments(requests);

        // Verify all commitments were submitted successfully
        assertEq(successCount, 3, "All three commitments should be submitted successfully");

        // Create batch
        vm.prank(trustedAggregators[0]);
        uint256 batchNumber = aggregator.createBatch();

        // Verify batch was created
        assertEq(batchNumber, 1, "Batch number should be 1");

        // Get batch contents
        (IAggregatorBatches.CommitmentRequest[] memory batchRequests, bool processed, bytes memory hashroot) =
            aggregator.getBatch(batchNumber);
        // Verify batch contains our commitments
        assertEq(batchRequests.length, 3, "Batch should contain 3 commitments");
        assertEq(batchRequests[0].requestID, 101, "First commitment should be requestID 101");
        assertEq(batchRequests[1].requestID, 102, "Second commitment should be requestID 102");
        assertEq(batchRequests[2].requestID, 103, "Third commitment should be requestID 103");
    }

    function testSubmitAndCreateBatch() public {
        // Prepare multiple test commitments
        IAggregatorBatches.CommitmentRequest[] memory requests = new IAggregatorBatches.CommitmentRequest[](3);

        requests[0] = IAggregatorBatches.CommitmentRequest({
            requestID: 201,
            payload: bytes("payload 1"),
            authenticator: bytes("auth 1")
        });

        requests[1] = IAggregatorBatches.CommitmentRequest({
            requestID: 202,
            payload: bytes("payload 2"),
            authenticator: bytes("auth 2")
        });

        requests[2] = IAggregatorBatches.CommitmentRequest({
            requestID: 203,
            payload: bytes("payload 3"),
            authenticator: bytes("auth 3")
        });

        // Submit commitments and create batch in one transaction
        vm.prank(trustedAggregators[0]);
        (uint256 batchNumber, uint256 successCount) = aggregator.submitAndCreateBatch(requests);

        // Verify all commitments were submitted successfully and batch was created
        assertEq(successCount, 3, "All three commitments should be submitted successfully");
        assertEq(batchNumber, 1, "Batch number should be 1");

        // Get batch contents
        (IAggregatorBatches.CommitmentRequest[] memory batchRequests, bool processed, bytes memory hashroot) =
            aggregator.getBatch(batchNumber);
        // Verify batch contains our commitments
        assertEq(batchRequests.length, 3, "Batch should contain 3 commitments");
        assertEq(batchRequests[0].requestID, 201, "First commitment should be requestID 201");
        assertEq(batchRequests[1].requestID, 202, "Second commitment should be requestID 202");
        assertEq(batchRequests[2].requestID, 203, "Third commitment should be requestID 203");
        assertEq(processed, false, "Batch should not be processed yet");
        assertEq(hashroot.length, 0, "Hashroot should be empty");
    }

    function testSubmitHashroot() public {
        // Submit a commitment and create a batch
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(1, bytes("test payload"), bytes("test authenticator"));

        vm.prank(trustedAggregators[0]);
        uint256 batchNumber = aggregator.createBatch();

        // Submit hashroot from two aggregators
        bytes memory hashroot = bytes("test hashroot");

        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(batchNumber, hashroot);

        // Check batch is not processed yet (only 1 vote)
        (, bool processed,) = aggregator.getBatch(batchNumber);
        assertEq(processed, false, "Batch should not be processed with only 1 vote");

        // Submit second vote
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(batchNumber, hashroot);

        // Now batch should be processed
        (, bool processed2, bytes memory storedHashroot) = aggregator.getBatch(batchNumber);
        assertEq(processed2, true, "Batch should be processed after 2 votes");
        assertEq(string(storedHashroot), string(hashroot), "Hashroot should match");

        // Check latest processed batch number
        uint256 latestProcessed = aggregator.getLatestProcessedBatchNumber();
        assertEq(latestProcessed, batchNumber, "Latest processed batch should be updated");
    }

    function testHashrootVoting() public {
        // Create a batch
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(50, bytes("payload 50"), bytes("auth 50"));

        vm.prank(trustedAggregators[0]);
        uint256 batchNumber = aggregator.createBatch();

        // Aggregators submit different hashroots
        bytes memory hashroot1 = bytes("hashroot 1");
        bytes memory hashroot2 = bytes("hashroot 2");

        // First aggregator votes for hashroot1
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(batchNumber, hashroot1);

        // Check vote count for hashroot1
        uint256 votes = aggregator.getHashrootVoteCount(batchNumber, hashroot1);
        assertEq(votes, 1, "Hashroot1 should have 1 vote");

        // Second aggregator votes for hashroot2
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(batchNumber, hashroot2);

        // Check vote counts
        votes = aggregator.getHashrootVoteCount(batchNumber, hashroot1);
        assertEq(votes, 1, "Hashroot1 should still have 1 vote");
        votes = aggregator.getHashrootVoteCount(batchNumber, hashroot2);
        assertEq(votes, 1, "Hashroot2 should have 1 vote");

        // Check number of submitted hashroots
        uint256 hashrootCount = aggregator.getSubmittedHashrootCount(batchNumber);
        assertEq(hashrootCount, 2, "Should have 2 different hashroots submitted");

        // Try to have aggregator0 vote for hashroot2 when they already voted for hashroot1
        vm.expectRevert("Aggregator already voted for a different hashroot for this batch");
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(batchNumber, hashroot2);

        // Third aggregator votes for hashroot1 - now hashroot1 has 2 votes (enough to process)
        vm.prank(trustedAggregators[2]);
        aggregator.submitHashroot(batchNumber, hashroot1);

        // Check batch is processed with hashroot1
        (, bool processed, bytes memory storedHashroot) = aggregator.getBatch(batchNumber);
        assertEq(processed, true, "Batch should be processed");
        assertEq(string(storedHashroot), string(hashroot1), "Batch should use hashroot1");
    }

    function testSequentialBatchProcessing() public {
        // Create 3 batches
        vm.startPrank(trustedAggregators[0]);

        // First batch
        aggregator.submitCommitment(10, bytes("payload 10"), bytes("auth 10"));
        uint256 batch1 = aggregator.createBatch();

        // Second batch
        aggregator.submitCommitment(20, bytes("payload 20"), bytes("auth 20"));
        uint256 batch2 = aggregator.createBatch();

        // Third batch
        aggregator.submitCommitment(30, bytes("payload 30"), bytes("auth 30"));
        uint256 batch3 = aggregator.createBatch();
        vm.stopPrank();

        // Verify batches were created
        assertEq(batch1, 1, "First batch should be 1");
        assertEq(batch2, 2, "Second batch should be 2");
        assertEq(batch3, 3, "Third batch should be 3");

        // Try to process the second batch before the first one - should revert
        bytes memory hashroot = bytes("test hashroot");

        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Batches must be processed in sequence; can't skip batches");
        aggregator.submitHashroot(2, hashroot);

        // Try to process the third batch before the others - should revert
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Batches must be processed in sequence; can't skip batches");
        aggregator.submitHashroot(3, hashroot);

        // Process batches in the correct sequence
        // Process batch 1
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitHashroot(1, hashroot);
        vm.stopPrank();

        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(1, hashroot);

        // Verify batch 1 is processed
        uint256 latestProcessed = aggregator.getLatestProcessedBatchNumber();
        assertEq(latestProcessed, 1, "Batch 1 should be processed");

        // Now we can process batch 2
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitHashroot(2, hashroot);
        vm.stopPrank();

        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(2, hashroot);

        // Verify batch 2 is processed
        latestProcessed = aggregator.getLatestProcessedBatchNumber();
        assertEq(latestProcessed, 2, "Batch 2 should be processed");

        // Now we can process batch 3
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitHashroot(3, hashroot);
        vm.stopPrank();

        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(3, hashroot);

        // Verify batch 3 is processed
        latestProcessed = aggregator.getLatestProcessedBatchNumber();
        assertEq(latestProcessed, 3, "Batch 3 should be processed");
    }

    function testMultipleBatches() public {
        // Create 3 commitments
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitCommitment(1, bytes("payload 1"), bytes("auth 1"));
        aggregator.submitCommitment(2, bytes("payload 2"), bytes("auth 2"));
        aggregator.submitCommitment(3, bytes("payload 3"), bytes("auth 3"));
        vm.stopPrank();

        // Create first batch with specific requests
        uint256[] memory requestIDs = new uint256[](2);
        requestIDs[0] = 1;
        requestIDs[1] = 2;

        vm.prank(trustedAggregators[0]);
        uint256 batch1 = aggregator.createBatchForRequests(requestIDs);

        // Create second batch with remaining requests
        vm.prank(trustedAggregators[0]);
        uint256 batch2 = aggregator.createBatch();

        // Verify batches
        (IAggregatorBatches.CommitmentRequest[] memory requests1,,) = aggregator.getBatch(batch1);
        (IAggregatorBatches.CommitmentRequest[] memory requests2,,) = aggregator.getBatch(batch2);

        assertEq(requests1.length, 2, "First batch should have 2 requests");
        assertEq(requests2.length, 1, "Second batch should have 1 request");

        assertEq(requests1[0].requestID, 1, "First batch should contain request 1");
        assertEq(requests1[1].requestID, 2, "First batch should contain request 2");
        assertEq(requests2[0].requestID, 3, "Second batch should contain request 3");
    }

    function testCommitmentModificationRules() public {
        // Submit a new commitment
        uint256 testId = 500;
        bytes memory originalPayload = bytes("original payload");
        bytes memory originalAuth = bytes("original auth");

        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(testId, originalPayload, originalAuth);

        // Commitment should be in the unprocessed pool
        bool isUnprocessed = aggregator.isRequestUnprocessed(testId);
        assertTrue(isUnprocessed, "Request should be in unprocessed pool");

        // We can modify the commitment while it's in the unprocessed pool
        bytes memory updatedPayload = bytes("updated payload");
        bytes memory updatedAuth = bytes("updated auth");

        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(testId, updatedPayload, updatedAuth);

        // Create a batch with this commitment
        uint256[] memory batchRequestIds = new uint256[](1);
        batchRequestIds[0] = testId;

        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequests(batchRequestIds);

        // Request should no longer be in the unprocessed pool
        isUnprocessed = aggregator.isRequestUnprocessed(testId);
        assertFalse(isUnprocessed, "Request should not be in unprocessed pool after batching");

        // Trying to resubmit the exact same commitment should be ignored (no revert)
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(testId, updatedPayload, updatedAuth);

        // Commitment should still not be in the unprocessed pool
        isUnprocessed = aggregator.isRequestUnprocessed(testId);
        assertFalse(isUnprocessed, "Request should not be added back to unprocessed pool");

        // Trying to modify a commitment that was in a batch should revert
        bytes memory differentPayload = bytes("different payload");

        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Cannot modify a commitment that was previously in a batch");
        aggregator.submitCommitment(testId, differentPayload, updatedAuth);

        // Same test with different authenticator
        bytes memory differentAuth = bytes("different auth");

        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Cannot modify a commitment that was previously in a batch");
        aggregator.submitCommitment(testId, updatedPayload, differentAuth);
    }

    function testUnprocessedPoolManagement() public {
        // Create a few commitments
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitCommitment(101, bytes("payload 101"), bytes("auth 101"));
        aggregator.submitCommitment(102, bytes("payload 102"), bytes("auth 102"));
        aggregator.submitCommitment(103, bytes("payload 103"), bytes("auth 103"));
        aggregator.submitCommitment(104, bytes("payload 104"), bytes("auth 104"));
        aggregator.submitCommitment(105, bytes("payload 105"), bytes("auth 105"));
        vm.stopPrank();

        // Test unprocessed request count
        uint256 count = aggregator.getUnprocessedRequestCount();
        assertEq(count, 5, "Should have 5 unprocessed requests");

        // Test accessing unprocessed requests by index
        uint256 requestId = aggregator.getUnprocessedRequestAtIndex(0);
        assertTrue(requestId >= 101 && requestId <= 105, "Should return a valid request ID");

        // Test checking if a request is unprocessed
        bool isUnprocessed = aggregator.isRequestUnprocessed(101);
        assertTrue(isUnprocessed, "Request 101 should be unprocessed");

        isUnprocessed = aggregator.isRequestUnprocessed(999);
        assertFalse(isUnprocessed, "Request 999 should not exist");

        // Test getting all unprocessed requests
        uint256[] memory allRequests = aggregator.getAllUnprocessedRequests();
        assertEq(allRequests.length, 5, "Should return all 5 unprocessed requests");

        // Create a batch with some requests
        uint256[] memory batchRequestIds = new uint256[](3);
        batchRequestIds[0] = 101;
        batchRequestIds[1] = 103;
        batchRequestIds[2] = 105;

        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequests(batchRequestIds);

        // Check that the used requests are no longer unprocessed
        count = aggregator.getUnprocessedRequestCount();
        assertEq(count, 2, "Should have 2 unprocessed requests remaining");

        isUnprocessed = aggregator.isRequestUnprocessed(101);
        assertFalse(isUnprocessed, "Request 101 should be processed now");

        isUnprocessed = aggregator.isRequestUnprocessed(102);
        assertTrue(isUnprocessed, "Request 102 should still be unprocessed");

        // Get all remaining unprocessed requests
        allRequests = aggregator.getAllUnprocessedRequests();
        assertEq(allRequests.length, 2, "Should return 2 unprocessed requests");

        // Check the specific remaining request IDs
        bool found102 = false;
        bool found104 = false;

        for (uint256 i = 0; i < allRequests.length; i++) {
            if (allRequests[i] == 102) found102 = true;
            if (allRequests[i] == 104) found104 = true;
        }

        assertTrue(found102, "Request 102 should be in the unprocessed pool");
        assertTrue(found104, "Request 104 should be in the unprocessed pool");
    }

    // New tests to increase coverage

    function testEmptyBatchCreation() public {
        // Test with no commitments in the pool
        vm.prank(trustedAggregators[0]);
        uint256 batchNumber = aggregator.createBatch();

        // Should return 0 if no unprocessed commitments exist
        assertEq(batchNumber, 0, "Should return 0 for empty pool");

        // Test with empty request array
        uint256[] memory emptyRequests = new uint256[](0);
        vm.prank(trustedAggregators[0]);
        batchNumber = aggregator.createBatchForRequests(emptyRequests);

        // Should return 0 if no requests provided
        assertEq(batchNumber, 0, "Should return 0 for empty request array");
    }

    function testCreateBatchWithInvalidRequests() public {
        // Add some valid commitments
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(100, bytes("test"), bytes("test"));

        // Create array with both valid and invalid request IDs
        uint256[] memory requestIDs = new uint256[](3);
        requestIDs[0] = 100; // valid
        requestIDs[1] = 999; // invalid - doesn't exist
        requestIDs[2] = 888; // invalid - doesn't exist

        // Try to create batch - should only include valid requests
        vm.prank(trustedAggregators[0]);
        uint256 batchNumber = aggregator.createBatchForRequests(requestIDs);

        // Verify batch was created with only the valid request
        assertEq(batchNumber, 1, "Batch should be created with just the valid request");

        // Get batch and verify it contains only our valid commitment
        (IAggregatorBatches.CommitmentRequest[] memory requests,,) = aggregator.getBatch(batchNumber);
        assertEq(requests.length, 1, "Batch should contain only 1 valid request");
        assertEq(requests[0].requestID, 100, "Only valid request ID should be included");
    }

    /**
     * @dev Test creating batches with overlapping request IDs
     * Verifies the specific behavior when attempting to include the same request in two different batches
     */
    function testOverlappingBatches() public {
        // Create several test commitments
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitCommitment(601, bytes("payload 601"), bytes("auth 601"));
        aggregator.submitCommitment(602, bytes("payload 602"), bytes("auth 602"));
        aggregator.submitCommitment(603, bytes("payload 603"), bytes("auth 603"));
        aggregator.submitCommitment(604, bytes("payload 604"), bytes("auth 604"));
        aggregator.submitCommitment(605, bytes("payload 605"), bytes("auth 605"));
        vm.stopPrank();

        // Create the first batch with the first 3 requests (601, 602, 603)
        uint256[] memory firstBatchRequestIDs = new uint256[](3);
        firstBatchRequestIDs[0] = 601;
        firstBatchRequestIDs[1] = 602;
        firstBatchRequestIDs[2] = 603;

        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequests(firstBatchRequestIDs);

        // Verify the unprocessed pool no longer contains the first 3 requests
        assertFalse(aggregator.isRequestUnprocessed(601), "Request 601 should no longer be in unprocessed pool");
        assertFalse(aggregator.isRequestUnprocessed(602), "Request 602 should no longer be in unprocessed pool");
        assertFalse(aggregator.isRequestUnprocessed(603), "Request 603 should no longer be in unprocessed pool");
        assertTrue(aggregator.isRequestUnprocessed(604), "Request 604 should still be in unprocessed pool");
        assertTrue(aggregator.isRequestUnprocessed(605), "Request 605 should still be in unprocessed pool");

        // Now try to create a second batch that tries to include some already batched requests
        // Specifically, requests 603, 604, 605 (where 603 is already in batch1)
        uint256[] memory secondBatchRequestIDs = new uint256[](3);
        secondBatchRequestIDs[0] = 603; // Already in batch1
        secondBatchRequestIDs[1] = 604; // Not yet in a batch
        secondBatchRequestIDs[2] = 605; // Not yet in a batch

        vm.prank(trustedAggregators[0]);
        uint256 batch2 = aggregator.createBatchForRequests(secondBatchRequestIDs);

        // Verify the second batch only contains the valid unprocessed requests (604, 605)
        (IAggregatorBatches.CommitmentRequest[] memory batch2Requests,,) = aggregator.getBatch(batch2);
        assertEq(batch2Requests.length, 2, "Second batch should only contain 2 requests (604, 605)");

        // Verify the specific requests in batch2
        bool found604 = false;
        bool found605 = false;

        for (uint256 i = 0; i < batch2Requests.length; i++) {
            if (batch2Requests[i].requestID == 604) found604 = true;
            if (batch2Requests[i].requestID == 605) found605 = true;
        }

        assertTrue(found604, "Batch 2 should contain request 604");
        assertTrue(found605, "Batch 2 should contain request 605");

        // Verify we can now resubmit the exact same commitment without modifying it
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(601, bytes("payload 601"), bytes("auth 601"));

        // It should NOT be added back to the unprocessed pool
        assertFalse(aggregator.isRequestUnprocessed(601), "Request 601 should not be added back to unprocessed pool");

        // Try to modify a commitment that was in a batch
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Cannot modify a commitment that was previously in a batch");
        aggregator.submitCommitment(601, bytes("different payload"), bytes("auth 601"));
    }

    function testGetLatestUnprocessedBatch() public {
        // Create 3 batches
        vm.startPrank(trustedAggregators[0]);

        // First batch
        aggregator.submitCommitment(10, bytes("payload 10"), bytes("auth 10"));
        aggregator.createBatch();

        // Second batch
        aggregator.submitCommitment(20, bytes("payload 20"), bytes("auth 20"));
        aggregator.createBatch();

        // Third batch
        aggregator.submitCommitment(30, bytes("payload 30"), bytes("auth 30"));
        uint256 batch3 = aggregator.createBatch();
        vm.stopPrank();

        // Get latest unprocessed batch
        (uint256 latestBatchNum, IAggregatorBatches.CommitmentRequest[] memory requests) =
            aggregator.getLatestUnprocessedBatch();

        // Should return the latest batch (batch3)
        assertEq(latestBatchNum, batch3, "Should return the latest unprocessed batch");
        assertEq(requests.length, 1, "Batch should contain 1 request");
        assertEq(requests[0].requestID, 30, "Latest batch should contain request 30");

        // Process batches 1 and 2
        bytes memory hashroot = bytes("test hashroot");

        // Process batch 1
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(1, hashroot);
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(1, hashroot);

        // Process batch 2
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(2, hashroot);
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(2, hashroot);

        // Check latest unprocessed batch again - should still be batch 3
        (latestBatchNum, requests) = aggregator.getLatestUnprocessedBatch();
        assertEq(latestBatchNum, batch3, "Should still return batch 3");

        // Process batch 3
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(3, hashroot);
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(3, hashroot);

        // Now all batches are processed, getLatestUnprocessedBatch should return 0
        (latestBatchNum, requests) = aggregator.getLatestUnprocessedBatch();
        assertEq(latestBatchNum, 0, "Should return 0 when no unprocessed batches exist");
        assertEq(requests.length, 0, "Should return empty array when no unprocessed batches exist");
    }

    function testGetBatchInvalidBatchNumber() public {
        // Try to get non-existent batch
        vm.expectRevert("Invalid batch number");
        aggregator.getBatch(999);

        // Try to get batch 0
        vm.expectRevert("Invalid batch number");
        aggregator.getBatch(0);
    }

    function testGetBatchHashrootInvalidBatchNumber() public {
        // Try to get hashroot for non-existent batch
        vm.expectRevert("Invalid batch number");
        aggregator.getBatchHashroot(999);

        // Try to get hashroot for batch 0
        vm.expectRevert("Invalid batch number");
        aggregator.getBatchHashroot(0);
    }

    function testGetUnprocessedRequestAtIndexOutOfBounds() public {
        // Try to access an out-of-bounds index
        vm.expectRevert("Index out of bounds");
        aggregator.getUnprocessedRequestAtIndex(999);
    }

    function testSubmitCommitmentAsNonAggregator() public {
        // Try to submit commitment as non-aggregator
        vm.prank(nonAggregator);
        vm.expectRevert("Caller is not a trusted aggregator");
        aggregator.submitCommitment(1, bytes("test"), bytes("test"));
    }

    function testCreateBatchAsNonAggregator() public {
        // Try to create batch as non-aggregator
        vm.prank(nonAggregator);
        vm.expectRevert("Caller is not a trusted aggregator");
        aggregator.createBatch();
    }

    function testCreateBatchForRequestsAsNonAggregator() public {
        uint256[] memory requestIDs = new uint256[](1);
        requestIDs[0] = 1;

        // Try to create batch as non-aggregator
        vm.prank(nonAggregator);
        vm.expectRevert("Caller is not a trusted aggregator");
        aggregator.createBatchForRequests(requestIDs);
    }

    function testSubmitHashrootAsNonAggregator() public {
        // Setup a batch
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(1, bytes("test"), bytes("test"));

        vm.prank(trustedAggregators[0]);
        uint256 batchNumber = aggregator.createBatch();

        // Try to submit hashroot as non-aggregator
        vm.prank(nonAggregator);
        vm.expectRevert("Caller is not a trusted aggregator");
        aggregator.submitHashroot(batchNumber, bytes("test"));
    }

    function testSubmitHashrootForProcessedBatch() public {
        // Setup and process a batch
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(1, bytes("test"), bytes("test"));

        vm.prank(trustedAggregators[0]);
        uint256 batchNumber = aggregator.createBatch();

        bytes memory hashroot = bytes("test hashroot");

        // Process the batch
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(batchNumber, hashroot);
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(batchNumber, hashroot);

        // Try to submit hashroot for already processed batch
        vm.prank(trustedAggregators[2]);
        vm.expectRevert("Batch already processed");
        aggregator.submitHashroot(batchNumber, hashroot);
    }

    function testVoteSameHashrootTwice() public {
        // Setup a batch
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(1, bytes("test"), bytes("test"));

        vm.prank(trustedAggregators[0]);
        uint256 batchNumber = aggregator.createBatch();

        bytes memory hashroot = bytes("test hashroot");

        // Submit hashroot first time
        vm.prank(trustedAggregators[0]);
        bool result = aggregator.submitHashroot(batchNumber, hashroot);
        assertTrue(result, "First submission should succeed");

        // Submit same hashroot again - should return true but not increase vote count
        vm.prank(trustedAggregators[0]);
        result = aggregator.submitHashroot(batchNumber, hashroot);
        assertTrue(result, "Second submission of same hashroot should succeed");

        // Verify vote count is still 1
        uint256 votes = aggregator.getHashrootVoteCount(batchNumber, hashroot);
        assertEq(votes, 1, "Vote count should still be 1");
    }

    // Tests for administrative functions

    function testAddAggregator() public {
        address newAggregator = address(0x4);

        // Add new aggregator
        aggregator.addAggregator(newAggregator);

        // Verify the new aggregator can perform trusted actions
        vm.prank(newAggregator);
        aggregator.submitCommitment(1, bytes("test"), bytes("test"));

        // Try to add an existing aggregator - should revert
        vm.expectRevert("Aggregator already exists");
        aggregator.addAggregator(trustedAggregators[0]);
    }

    function testRemoveAggregator() public {
        // Remove an existing aggregator
        aggregator.removeAggregator(trustedAggregators[2]);

        // Verify the removed aggregator can no longer perform trusted actions
        vm.prank(trustedAggregators[2]);
        vm.expectRevert("Caller is not a trusted aggregator");
        aggregator.submitCommitment(1, bytes("test"), bytes("test"));

        // Try to remove a non-existent aggregator - should revert
        vm.expectRevert("Aggregator does not exist");
        aggregator.removeAggregator(address(0x999));

        // Try to remove when it would make required votes impossible
        // Currently 2 aggregators with 2 required votes - removing one more would make it impossible
        vm.expectRevert("Cannot remove aggregator: would make required votes impossible");
        aggregator.removeAggregator(trustedAggregators[0]);
    }

    function testUpdateRequiredVotes() public {
        // Update to require only 1 vote
        aggregator.updateRequiredVotes(1);

        // Verify a batch can be processed with just 1 vote now
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(1, bytes("test"), bytes("test"));

        vm.prank(trustedAggregators[0]);
        uint256 batchNumber = aggregator.createBatch();

        // Submit just one vote
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(batchNumber, bytes("test"));

        // Batch should be processed with just 1 vote now
        (, bool processed,) = aggregator.getBatch(batchNumber);
        assertTrue(processed, "Batch should be processed with just 1 vote after updating requirement");

        // Try to set an invalid vote threshold (higher than total aggregators)
        vm.expectRevert("Invalid votes threshold");
        aggregator.updateRequiredVotes(4);

        // Try to set votes to zero
        vm.expectRevert("Invalid votes threshold");
        aggregator.updateRequiredVotes(0);
    }

    function testTransferOwnership() public {
        address newOwner = address(0x123);

        // Transfer ownership
        aggregator.transferOwnership(newOwner);

        // Owner functions should now be restricted to the new owner
        vm.prank(newOwner);
        aggregator.addAggregator(address(0x456));

        // Original owner should no longer have access
        vm.expectRevert("Caller is not the owner");
        aggregator.addAggregator(address(0x789));

        // Try to transfer to zero address - should revert
        vm.prank(newOwner);
        vm.expectRevert("New owner cannot be zero address");
        aggregator.transferOwnership(address(0));
    }

    function testNonOwnerAdminFunctions() public {
        address nonOwner = address(0x999);

        // Try admin functions as non-owner
        vm.startPrank(nonOwner);

        vm.expectRevert("Caller is not the owner");
        aggregator.addAggregator(address(0x123));

        vm.expectRevert("Caller is not the owner");
        aggregator.removeAggregator(trustedAggregators[0]);

        vm.expectRevert("Caller is not the owner");
        aggregator.updateRequiredVotes(1);

        vm.expectRevert("Caller is not the owner");
        aggregator.transferOwnership(address(0x123));

        vm.stopPrank();
    }

    function testCreateBatchForRequestsWithNoValidRequests() public {
        // Try to create batch with only invalid request IDs
        uint256[] memory invalidRequests = new uint256[](2);
        invalidRequests[0] = 999;
        invalidRequests[1] = 888;

        // Should revert because there are no valid unprocessed request IDs
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("No valid unprocessed request IDs provided");
        aggregator.createBatchForRequests(invalidRequests);
    }

    // Tests for remaining untested functions and branches

    function testGetCommitment() public {
        // Submit a commitment
        uint256 requestID = 123;
        bytes memory payload = bytes("test payload");
        bytes memory authenticator = bytes("test authenticator");

        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(requestID, payload, authenticator);

        // Get the commitment and verify its data
        IAggregatorBatches.CommitmentRequest memory request = aggregator.getCommitment(requestID);

        assertEq(request.requestID, requestID, "Request ID should match");
        assertEq(string(request.payload), string(payload), "Payload should match");
        assertEq(string(request.authenticator), string(authenticator), "Authenticator should match");

        // Check non-existent commitment
        IAggregatorBatches.CommitmentRequest memory emptyRequest = aggregator.getCommitment(999);
        assertEq(emptyRequest.requestID, 0, "Non-existent request should have ID 0");
        assertEq(emptyRequest.payload.length, 0, "Non-existent request should have empty payload");
        assertEq(emptyRequest.authenticator.length, 0, "Non-existent request should have empty authenticator");
    }

    function testGetLatestBatchNumber() public {
        // Initially should be 0
        uint256 latestBatch = aggregator.getLatestBatchNumber();
        assertEq(latestBatch, 0, "Initial latest batch should be 0");

        // Create some batches
        vm.startPrank(trustedAggregators[0]);

        // First batch
        aggregator.submitCommitment(10, bytes("payload 10"), bytes("auth 10"));
        aggregator.createBatch();

        // Check latest batch number updated
        latestBatch = aggregator.getLatestBatchNumber();
        assertEq(latestBatch, 1, "Latest batch should be 1");

        // Create more batches
        aggregator.submitCommitment(20, bytes("payload 20"), bytes("auth 20"));
        aggregator.createBatch();

        aggregator.submitCommitment(30, bytes("payload 30"), bytes("auth 30"));
        aggregator.createBatch();

        vm.stopPrank();

        // Check latest batch number updated
        latestBatch = aggregator.getLatestBatchNumber();
        assertEq(latestBatch, 3, "Latest batch should be 3");
    }

    function testConstructorValidation() public {
        // Test with empty aggregator list
        address[] memory noAggregators = new address[](0);
        vm.expectRevert("At least one aggregator required");
        new AggregatorBatches(noAggregators, 1);

        // Test with invalid vote threshold (greater than total aggregators)
        address[] memory singleAggregator = new address[](1);
        singleAggregator[0] = address(0x1);
        vm.expectRevert("Invalid votes threshold");
        new AggregatorBatches(singleAggregator, 2);

        // Test with zero vote threshold
        vm.expectRevert("Invalid votes threshold");
        new AggregatorBatches(singleAggregator, 0);
    }

    function testGetBatchHashrootValidation() public {
        // Test with valid batch that has no hashroot
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(1, bytes("test payload"), bytes("test authenticator"));

        vm.prank(trustedAggregators[0]);
        uint256 batchNumber = aggregator.createBatch();

        bytes memory emptyHashroot = aggregator.getBatchHashroot(batchNumber);
        assertEq(emptyHashroot.length, 0, "Hashroot should be empty for unprocessed batch");

        // Test with batch number 0
        vm.expectRevert("Invalid batch number");
        aggregator.getBatchHashroot(0);

        // Test with non-existent batch
        uint256 nonExistentBatch = 999;
        vm.expectRevert("Invalid batch number");
        aggregator.getBatchHashroot(nonExistentBatch);
    }

    function testGetLatestUnprocessedBatchWithSkippedBatches() public {
        // Create 3 batches with different processing states
        vm.startPrank(trustedAggregators[0]);

        // First batch
        aggregator.submitCommitment(10, bytes("payload 10"), bytes("auth 10"));
        aggregator.createBatch();

        // Process first batch to make latestProcessedBatchNumber > 0
        bytes memory hashroot = bytes("test hashroot");
        aggregator.submitHashroot(1, hashroot);
        vm.stopPrank();

        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(1, hashroot);

        // Continue creating more batches
        vm.startPrank(trustedAggregators[0]);

        // Second batch
        aggregator.submitCommitment(20, bytes("payload 20"), bytes("auth 20"));
        aggregator.createBatch();

        // Third batch
        aggregator.submitCommitment(30, bytes("payload 30"), bytes("auth 30"));
        uint256 batch3 = aggregator.createBatch();
        vm.stopPrank();

        // Process batch 2
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(2, hashroot);
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(2, hashroot);

        // Create batch 4
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(40, bytes("payload 40"), bytes("auth 40"));
        vm.prank(trustedAggregators[0]);
        uint256 batch4 = aggregator.createBatch();

        // Now batch 3 and 4 are unprocessed
        // The latest unprocessed batch should be batch 4
        (uint256 latestBatchNum, IAggregatorBatches.CommitmentRequest[] memory requests) =
            aggregator.getLatestUnprocessedBatch();

        assertEq(latestBatchNum, batch4, "Latest unprocessed batch should be batch 4");
        assertEq(requests.length, 1, "Batch should contain 1 request");
        assertEq(requests[0].requestID, 40, "Request should be ID 40");

        // If we try to process batch 4 before batch 3, it should revert
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Batches must be processed in sequence; can't skip batches");
        aggregator.submitHashroot(batch4, hashroot);

        // Process batch 3
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(batch3, hashroot);
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(batch3, hashroot);

        // Now try to process batch 3 again - should revert with "already processed"
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Batch already processed");
        aggregator.submitHashroot(batch3, hashroot);
    }
}
