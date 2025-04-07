// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, console} from "forge-std/Test.sol";
import "../src/AggregatorBatches.sol";
import "../src/IAggregatorBatches.sol";

contract AggregatorBatchesTest is Test {
    AggregatorBatches public aggregator;
    address public owner;
    address[] public trustedAggregators;

    function setUp() public {
        // Setup test accounts
        owner = address(this);
        address aggregator1 = address(0x1);
        address aggregator2 = address(0x2);
        address aggregator3 = address(0x3);

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

        // Get batch and verify it contains our commitment
        (IAggregatorBatches.CommitmentRequest[] memory requests, bool processed, bytes memory hashroot) =
            aggregator.getBatch(batchNumber);

        assertEq(requests.length, 1, "Batch should contain 1 request");
        assertEq(requests[0].requestID, requestID, "Request ID should match");
        assertEq(string(requests[0].payload), string(payload), "Payload should match");
        assertEq(string(requests[0].authenticator), string(authenticator), "Authenticator should match");
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
        (IAggregatorBatches.CommitmentRequest[] memory requests2, bool processed2, bytes memory storedHashroot) =
            aggregator.getBatch(batchNumber);
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
        uint256 batchNumber = aggregator.createBatchForRequests(batchRequestIds);

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
}
