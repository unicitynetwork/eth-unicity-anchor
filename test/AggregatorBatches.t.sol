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

    /**
     * @dev Helper function to forcibly add a request ID to the unprocessed pool
     * This is used to test edge cases where a request is both marked as batched
     * and somehow remains in or gets added back to the unprocessed pool
     */
    function _forceAddToUnprocessedPool(bytes memory requestID) internal {
        // To directly add to the unprocessed pool, we need to:
        // 1. Get the address of the aggregator contract
        // 2. Call a specially crafted function that does the operation

        // Call a function on the contract that will add the ID to the unprocessed pool
        bytes memory callData = abi.encodeWithSignature("_testOnlyForceAddToUnprocessedPool(bytes)", requestID);

        // Execute the call as a prank from the contract owner
        vm.prank(owner);
        (bool success,) = address(aggregator).call(callData);

        // If this fails, the contract doesn't have our test helper
        require(success, "Force add to unprocessed pool failed");
    }

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
        bytes memory requestID = bytes("request_1");
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
            requestID: bytes("request_101"),
            payload: bytes("payload 1"),
            authenticator: bytes("auth 1")
        });

        requests[1] = IAggregatorBatches.CommitmentRequest({
            requestID: bytes("request_102"),
            payload: bytes("payload 2"),
            authenticator: bytes("auth 2")
        });

        requests[2] = IAggregatorBatches.CommitmentRequest({
            requestID: bytes("request_103"),
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
        assertEq(keccak256(batchRequests[0].requestID), keccak256(bytes("request_101")), "First commitment should be requestID 101");
        assertEq(keccak256(batchRequests[1].requestID), keccak256(bytes("request_102")), "Second commitment should be requestID 102");
        assertEq(keccak256(batchRequests[2].requestID), keccak256(bytes("request_103")), "Third commitment should be requestID 103");
    }

    function testSubmitAndCreateBatch() public {
        // Prepare multiple test commitments
        IAggregatorBatches.CommitmentRequest[] memory requests = new IAggregatorBatches.CommitmentRequest[](3);

        requests[0] = IAggregatorBatches.CommitmentRequest({
            requestID: bytes("request_201"),
            payload: bytes("payload 1"),
            authenticator: bytes("auth 1")
        });

        requests[1] = IAggregatorBatches.CommitmentRequest({
            requestID: bytes("request_202"),
            payload: bytes("payload 2"),
            authenticator: bytes("auth 2")
        });

        requests[2] = IAggregatorBatches.CommitmentRequest({
            requestID: bytes("request_203"),
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
        assertEq(keccak256(batchRequests[0].requestID), keccak256(bytes("request_201")), "First commitment should be requestID 201");
        assertEq(keccak256(batchRequests[1].requestID), keccak256(bytes("request_202")), "Second commitment should be requestID 202");
        assertEq(keccak256(batchRequests[2].requestID), keccak256(bytes("request_203")), "Third commitment should be requestID 203");
        assertEq(processed, false, "Batch should not be processed yet");
        assertEq(hashroot.length, 0, "Hashroot should be empty");
    }

    function testSubmitHashroot() public {
        // Submit a commitment and create a batch
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(bytes("request_1"), bytes("test payload"), bytes("test authenticator"));

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
        aggregator.submitCommitment(bytes("request_50"), bytes("payload 50"), bytes("auth 50"));

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
    
    /**
     * @dev Test submitting hashroots to already processed batches
     * This test verifies our logic for handling hashroot submissions for batches that are already processed:
     * 1. If the submitted hashroot matches the already-stored value, it should succeed silently
     * 2. If it's different, it should revert with a clear error
     */
    function testSubmitHashrootToProcessedBatch() public {
        // Submit a commitment and create a batch
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(bytes("request_999"), bytes("test payload"), bytes("test authenticator"));

        vm.prank(trustedAggregators[0]);
        uint256 batchNumber = aggregator.createBatch();

        // Process the batch with 2 aggregator votes
        bytes memory originalHashroot = bytes("original hashroot");
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(batchNumber, originalHashroot);
        
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(batchNumber, originalHashroot);

        // Verify the batch is now processed
        (, bool processed, bytes memory storedHashroot) = aggregator.getBatch(batchNumber);
        assertEq(processed, true, "Batch should be processed after 2 votes");
        assertEq(string(storedHashroot), string(originalHashroot), "Stored hashroot should match original");

        // CASE 1: Submit the same hashroot again to an already processed batch
        // This should silently succeed as a no-op
        vm.prank(trustedAggregators[0]);
        bool success = aggregator.submitHashroot(batchNumber, originalHashroot);
        assertEq(success, true, "Submitting same hashroot to processed batch should succeed");

        // Verify nothing changed
        (, bool stillProcessed, bytes memory stillSameHashroot) = aggregator.getBatch(batchNumber);
        assertEq(stillProcessed, true, "Batch should still be processed");
        assertEq(string(stillSameHashroot), string(originalHashroot), "Hashroot should still match original");

        // CASE 2: Submit a different hashroot to an already processed batch
        // This should revert with specific error message
        bytes memory differentHashroot = bytes("different hashroot");
        vm.expectRevert("Cannot submit different hashroot for already processed batch");
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(batchNumber, differentHashroot);

        // Verify the batch still has the original hashroot
        (, bool finalProcessed, bytes memory finalHashroot) = aggregator.getBatch(batchNumber);
        assertEq(finalProcessed, true, "Batch should be processed");
        assertEq(string(finalHashroot), string(originalHashroot), "Hashroot should remain unchanged");
    }
    
    /**
     * @dev Test the aggregator vote inspection functions
     * This test verifies the functionality of:
     * - hasAggregatorVotedForHashroot - checks if an aggregator voted for a specific hashroot
     * - getAggregatorVoteForBatch - gets the hashroot an aggregator voted for (if any)
     */
    function testAggregatorVoteInspection() public {
        // Submit a commitment and create a batch
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(bytes("request_888"), bytes("vote inspection test"), bytes("auth"));

        vm.prank(trustedAggregators[0]);
        uint256 batchNumber = aggregator.createBatch();

        // Define two different hashroots
        bytes memory hashroot1 = bytes("hashroot version 1");
        bytes memory hashroot2 = bytes("hashroot version 2");
        
        // Initial state: no aggregator has voted yet
        bool voted;
        bool hasVoted;
        bytes memory votedHashroot;
        
        // Check if aggregator0 has voted for hashroot1 (should be false)
        voted = aggregator.hasAggregatorVotedForHashroot(batchNumber, hashroot1, trustedAggregators[0]);
        assertEq(voted, false, "Aggregator0 should not have voted yet");
        
        // Check getAggregatorVoteForBatch (should return false, empty)
        (hasVoted, votedHashroot) = aggregator.getAggregatorVoteForBatch(batchNumber, trustedAggregators[0]);
        assertEq(hasVoted, false, "Aggregator0 should not have voted yet");
        assertEq(votedHashroot.length, 0, "Voted hashroot should be empty");
        
        // Now aggregator0 votes for hashroot1
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(batchNumber, hashroot1);
        
        // Verify aggregator0 voted for hashroot1
        voted = aggregator.hasAggregatorVotedForHashroot(batchNumber, hashroot1, trustedAggregators[0]);
        assertEq(voted, true, "Aggregator0 should have voted for hashroot1");
        
        // Verify aggregator0 did NOT vote for hashroot2
        voted = aggregator.hasAggregatorVotedForHashroot(batchNumber, hashroot2, trustedAggregators[0]);
        assertEq(voted, false, "Aggregator0 should not have voted for hashroot2");
        
        // Check getAggregatorVoteForBatch returns the correct vote
        (hasVoted, votedHashroot) = aggregator.getAggregatorVoteForBatch(batchNumber, trustedAggregators[0]);
        assertEq(hasVoted, true, "Aggregator0 should have voted");
        assertEq(string(votedHashroot), string(hashroot1), "Should return hashroot1 as the voted hashroot");
        
        // Now aggregator1 votes for hashroot2
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(batchNumber, hashroot2);
        
        // Verify aggregator1 voted for hashroot2
        voted = aggregator.hasAggregatorVotedForHashroot(batchNumber, hashroot2, trustedAggregators[1]);
        assertEq(voted, true, "Aggregator1 should have voted for hashroot2");
        
        // Check getAggregatorVoteForBatch for aggregator1
        (hasVoted, votedHashroot) = aggregator.getAggregatorVoteForBatch(batchNumber, trustedAggregators[1]);
        assertEq(hasVoted, true, "Aggregator1 should have voted");
        assertEq(string(votedHashroot), string(hashroot2), "Should return hashroot2 as the voted hashroot");
        
        // Aggregator2 votes for hashroot1, which should reach consensus
        vm.prank(trustedAggregators[2]);
        aggregator.submitHashroot(batchNumber, hashroot1);
        
        // Verify the batch is now processed with hashroot1
        (, bool processed, bytes memory finalHashroot) = aggregator.getBatch(batchNumber);
        assertEq(processed, true, "Batch should be processed");
        assertEq(string(finalHashroot), string(hashroot1), "Batch should use hashroot1");
        
        // Even though the batch is processed, we should still be able to check votes
        voted = aggregator.hasAggregatorVotedForHashroot(batchNumber, hashroot1, trustedAggregators[2]);
        assertEq(voted, true, "Aggregator2 should have voted for hashroot1");
        
        (hasVoted, votedHashroot) = aggregator.getAggregatorVoteForBatch(batchNumber, trustedAggregators[2]);
        assertEq(hasVoted, true, "Aggregator2 should have voted");
        assertEq(string(votedHashroot), string(hashroot1), "Should return hashroot1 as the voted hashroot");
    }

    function testSequentialBatchProcessing() public {
        // Create 3 batches
        vm.startPrank(trustedAggregators[0]);

        // First batch
        aggregator.submitCommitment(bytes("request_10"), bytes("payload 10"), bytes("auth 10"));
        uint256 batch1 = aggregator.createBatch();

        // Second batch
        aggregator.submitCommitment(bytes("request_20"), bytes("payload 20"), bytes("auth 20"));
        uint256 batch2 = aggregator.createBatch();

        // Third batch
        aggregator.submitCommitment(bytes("request_30"), bytes("payload 30"), bytes("auth 30"));
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
        aggregator.submitCommitment(bytes("request_1"), bytes("payload 1"), bytes("auth 1"));
        aggregator.submitCommitment(bytes("request_2"), bytes("payload 2"), bytes("auth 2"));
        aggregator.submitCommitment(bytes("request_3"), bytes("payload 3"), bytes("auth 3"));
        vm.stopPrank();

        // Create first batch with specific requests
        bytes[] memory requestIDs = new bytes[](2);
        requestIDs[0] = bytes("request_1");
        requestIDs[1] = bytes("request_2");

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

        assertEq(keccak256(requests1[0].requestID), keccak256(bytes("request_1")), "First batch should contain request 1");
        assertEq(keccak256(requests1[1].requestID), keccak256(bytes("request_2")), "First batch should contain request 2");
        assertEq(keccak256(requests2[0].requestID), keccak256(bytes("request_3")), "Second batch should contain request 3");
    }

    function testCommitmentModificationRules() public {
        // Submit a new commitment
        bytes memory testId = bytes("request_500");
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
        bytes[] memory batchRequestIds = new bytes[](1);
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
        aggregator.submitCommitment(bytes("request_101"), bytes("payload 101"), bytes("auth 101"));
        aggregator.submitCommitment(bytes("request_102"), bytes("payload 102"), bytes("auth 102"));
        aggregator.submitCommitment(bytes("request_103"), bytes("payload 103"), bytes("auth 103"));
        aggregator.submitCommitment(bytes("request_104"), bytes("payload 104"), bytes("auth 104"));
        aggregator.submitCommitment(bytes("request_105"), bytes("payload 105"), bytes("auth 105"));
        vm.stopPrank();

        // Test unprocessed request count
        uint256 count = aggregator.getUnprocessedRequestCount();
        assertEq(count, 5, "Should have 5 unprocessed requests");

        // Test accessing unprocessed requests by index
        bytes memory requestId = aggregator.getUnprocessedRequestAtIndex(0);
        // Check that the requestId starts with "request_"
        assertTrue(bytes(requestId).length > 0, "Should return a valid request ID");

        // Test checking if a request is unprocessed
        bool isUnprocessed = aggregator.isRequestUnprocessed(bytes("request_101"));
        assertTrue(isUnprocessed, "Request 101 should be unprocessed");

        isUnprocessed = aggregator.isRequestUnprocessed(bytes("request_999"));
        assertFalse(isUnprocessed, "Request 999 should not exist");

        // Test getting all unprocessed requests
        bytes[] memory allRequests = aggregator.getAllUnprocessedRequests();
        assertEq(allRequests.length, 5, "Should return all 5 unprocessed requests");

        // Create a batch with some requests
        bytes[] memory batchRequestIds = new bytes[](3);
        batchRequestIds[0] = bytes("request_101");
        batchRequestIds[1] = bytes("request_103");
        batchRequestIds[2] = bytes("request_105");

        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequests(batchRequestIds);

        // Check that the used requests are no longer unprocessed
        count = aggregator.getUnprocessedRequestCount();
        assertEq(count, 2, "Should have 2 unprocessed requests remaining");

        isUnprocessed = aggregator.isRequestUnprocessed(bytes("request_101"));
        assertFalse(isUnprocessed, "Request 101 should be processed now");

        isUnprocessed = aggregator.isRequestUnprocessed(bytes("request_102"));
        assertTrue(isUnprocessed, "Request 102 should still be unprocessed");

        // Get all remaining unprocessed requests
        allRequests = aggregator.getAllUnprocessedRequests();
        assertEq(allRequests.length, 2, "Should return 2 unprocessed requests");

        // Check the specific remaining request IDs
        bool found102 = false;
        bool found104 = false;

        for (uint256 i = 0; i < allRequests.length; i++) {
            if (keccak256(allRequests[i]) == keccak256(bytes("request_102"))) found102 = true;
            if (keccak256(allRequests[i]) == keccak256(bytes("request_104"))) found104 = true;
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
        bytes[] memory emptyRequests = new bytes[](0);
        vm.prank(trustedAggregators[0]);
        batchNumber = aggregator.createBatchForRequests(emptyRequests);

        // Should return 0 if no requests provided
        assertEq(batchNumber, 0, "Should return 0 for empty request array");
    }

    function testCreateBatchWithInvalidRequests() public {
        // Add some valid commitments
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(bytes("request_100"), bytes("test"), bytes("test"));

        // Create array with both valid and invalid request IDs
        bytes[] memory requestIDs = new bytes[](3);
        requestIDs[0] = bytes("request_100"); // valid
        requestIDs[1] = bytes("request_999"); // invalid - doesn't exist
        requestIDs[2] = bytes("request_888"); // invalid - doesn't exist

        // Try to create batch - should only include valid requests
        vm.prank(trustedAggregators[0]);
        uint256 batchNumber = aggregator.createBatchForRequests(requestIDs);

        // Verify batch was created with only the valid request
        assertEq(batchNumber, 1, "Batch should be created with just the valid request");

        // Get batch and verify it contains only our valid commitment
        (IAggregatorBatches.CommitmentRequest[] memory requests,,) = aggregator.getBatch(batchNumber);
        assertEq(requests.length, 1, "Batch should contain only 1 valid request");
        assertEq(keccak256(requests[0].requestID), keccak256(bytes("request_100")), "Only valid request ID should be included");
    }

    /**
     * @dev Test creating batches with overlapping request IDs
     * Verifies the specific behavior when attempting to include the same request in two different batches
     */
    function testOverlappingBatches() public {
        // Create several test commitments
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitCommitment(bytes("request_601"), bytes("payload 601"), bytes("auth 601"));
        aggregator.submitCommitment(bytes("request_602"), bytes("payload 602"), bytes("auth 602"));
        aggregator.submitCommitment(bytes("request_603"), bytes("payload 603"), bytes("auth 603"));
        aggregator.submitCommitment(bytes("request_604"), bytes("payload 604"), bytes("auth 604"));
        aggregator.submitCommitment(bytes("request_605"), bytes("payload 605"), bytes("auth 605"));
        vm.stopPrank();

        // Create the first batch with the first 3 requests (601, 602, 603)
        bytes[] memory firstBatchRequestIDs = new bytes[](3);
        firstBatchRequestIDs[0] = bytes("request_601");
        firstBatchRequestIDs[1] = bytes("request_602");
        firstBatchRequestIDs[2] = bytes("request_603");

        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequests(firstBatchRequestIDs);

        // Verify the unprocessed pool no longer contains the first 3 requests
        assertFalse(aggregator.isRequestUnprocessed(bytes("request_601")), "Request 601 should no longer be in unprocessed pool");
        assertFalse(aggregator.isRequestUnprocessed(bytes("request_602")), "Request 602 should no longer be in unprocessed pool");
        assertFalse(aggregator.isRequestUnprocessed(bytes("request_603")), "Request 603 should no longer be in unprocessed pool");
        assertTrue(aggregator.isRequestUnprocessed(bytes("request_604")), "Request 604 should still be in unprocessed pool");
        assertTrue(aggregator.isRequestUnprocessed(bytes("request_605")), "Request 605 should still be in unprocessed pool");

        // Now try to create a second batch that tries to include some already batched requests
        // Specifically, requests 603, 604, 605 (where 603 is already in batch1)
        bytes[] memory secondBatchRequestIDs = new bytes[](3);
        secondBatchRequestIDs[0] = bytes("request_603"); // Already in batch1
        secondBatchRequestIDs[1] = bytes("request_604"); // Not yet in a batch
        secondBatchRequestIDs[2] = bytes("request_605"); // Not yet in a batch

        vm.prank(trustedAggregators[0]);
        uint256 batch2 = aggregator.createBatchForRequests(secondBatchRequestIDs);

        // Verify the second batch only contains the valid unprocessed requests (604, 605)
        (IAggregatorBatches.CommitmentRequest[] memory batch2Requests,,) = aggregator.getBatch(batch2);
        assertEq(batch2Requests.length, 2, "Second batch should only contain 2 requests (604, 605)");

        // Verify the specific requests in batch2
        bool found604 = false;
        bool found605 = false;

        for (uint256 i = 0; i < batch2Requests.length; i++) {
            if (keccak256(batch2Requests[i].requestID) == keccak256(bytes("request_604"))) found604 = true;
            if (keccak256(batch2Requests[i].requestID) == keccak256(bytes("request_605"))) found605 = true;
        }

        assertTrue(found604, "Batch 2 should contain request 604");
        assertTrue(found605, "Batch 2 should contain request 605");

        // Verify we can now resubmit the exact same commitment without modifying it
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(bytes("request_601"), bytes("payload 601"), bytes("auth 601"));

        // It should NOT be added back to the unprocessed pool
        assertFalse(aggregator.isRequestUnprocessed(bytes("request_601")), "Request 601 should not be added back to unprocessed pool");

        // Special test for the critical edge case: test the robustness of our filtering
        // by simulating a request that is in the unprocessed pool but also marked as batched
        // This would normally not happen, but we want to verify our protection works

        // Instead of trying to manipulate storage, simply create a new test case that's cleaner
        // Create new test requests so we have a clean state to work with
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitCommitment(bytes("request_701"), bytes("edge payload 701"), bytes("edge auth 701"));
        aggregator.submitCommitment(bytes("request_702"), bytes("edge payload 702"), bytes("edge auth 702"));
        vm.stopPrank();

        // Create a batch with request 701 only, this properly marks it as batched
        bytes[] memory firstEdgeBatchIDs = new bytes[](1);
        firstEdgeBatchIDs[0] = bytes("request_701");

        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequests(firstEdgeBatchIDs);

        // Artificially add request 701 back to the unprocessed pool
        // To do this, we need to call submitCommitment again with exact same parameters
        // (This works because the contract only prevents modification, not exact resubmission)
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(bytes("request_701"), bytes("edge payload 701"), bytes("edge auth 701"));

        // Use an internal helper on the test contract to directly force 701 into the unprocessed pool
        _forceAddToUnprocessedPool(bytes("request_701"));

        // Now verify that our manipulation worked and 701 appears to be in the unprocessed pool
        assertTrue(aggregator.isRequestUnprocessed(bytes("request_701")), "Request 701 should appear in unprocessed pool for test");

        // Try to create a batch that includes the manipulated request
        bytes[] memory edgeCaseRequestIDs = new bytes[](2);
        edgeCaseRequestIDs[0] = bytes("request_701"); // Is now in unprocessed pool but also marked as batched
        edgeCaseRequestIDs[1] = bytes("request_702"); // Not yet in a batch

        vm.prank(trustedAggregators[0]);
        uint256 batch3 = aggregator.createBatchForRequests(edgeCaseRequestIDs);

        // Verify the edge case batch only contains request 702, filtering out 701 despite it being in unprocessed pool
        (IAggregatorBatches.CommitmentRequest[] memory batch3Requests,,) = aggregator.getBatch(batch3);
        assertEq(batch3Requests.length, 1, "Edge case batch should only contain 1 request (702)");
        assertEq(keccak256(batch3Requests[0].requestID), keccak256(bytes("request_702")), "Edge case batch should only contain request 702");

        // Try to modify a commitment that was in a batch
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Cannot modify a commitment that was previously in a batch");
        aggregator.submitCommitment(bytes("request_601"), bytes("different payload"), bytes("auth 601"));
    }

    function testGetLatestUnprocessedBatch() public {
        // Create 3 batches
        vm.startPrank(trustedAggregators[0]);

        // First batch
        aggregator.submitCommitment(bytes("request_10"), bytes("payload 10"), bytes("auth 10"));
        aggregator.createBatch();

        // Second batch
        aggregator.submitCommitment(bytes("request_20"), bytes("payload 20"), bytes("auth 20"));
        aggregator.createBatch();

        // Third batch
        aggregator.submitCommitment(bytes("request_30"), bytes("payload 30"), bytes("auth 30"));
        uint256 batch3 = aggregator.createBatch();
        vm.stopPrank();

        // Get latest unprocessed batch
        (uint256 latestBatchNum, IAggregatorBatches.CommitmentRequest[] memory requests) =
            aggregator.getLatestUnprocessedBatch();

        // Should return the latest batch (batch3)
        assertEq(latestBatchNum, batch3, "Should return the latest unprocessed batch");
        assertEq(requests.length, 1, "Batch should contain 1 request");
        assertEq(keccak256(requests[0].requestID), keccak256(bytes("request_30")), "Latest batch should contain request 30");

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
        aggregator.submitCommitment(bytes("request_1"), bytes("test"), bytes("test"));
    }

    function testCreateBatchAsNonAggregator() public {
        // Try to create batch as non-aggregator
        vm.prank(nonAggregator);
        vm.expectRevert("Caller is not a trusted aggregator");
        aggregator.createBatch();
    }

    function testCreateBatchForRequestsAsNonAggregator() public {
        bytes[] memory requestIDs = new bytes[](1);
        requestIDs[0] = bytes("request_1");

        // Try to create batch as non-aggregator
        vm.prank(nonAggregator);
        vm.expectRevert("Caller is not a trusted aggregator");
        aggregator.createBatchForRequests(requestIDs);
    }

    function testSubmitHashrootAsNonAggregator() public {
        // Setup a batch
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(bytes("request_1"), bytes("test"), bytes("test"));

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
        aggregator.submitCommitment(bytes("request_1"), bytes("test"), bytes("test"));

        vm.prank(trustedAggregators[0]);
        uint256 batchNumber = aggregator.createBatch();

        bytes memory hashroot = bytes("test hashroot");
        bytes memory differentHashroot = bytes("different hashroot");

        // Process the batch
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(batchNumber, hashroot);
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(batchNumber, hashroot);

        // Verify the batch is processed
        (, bool processed, bytes memory storedHashroot) = aggregator.getBatch(batchNumber);
        assertEq(processed, true, "Batch should be processed");
        assertEq(string(storedHashroot), string(hashroot), "Stored hashroot should match");

        // Try to submit same hashroot for already processed batch - should succeed silently
        vm.prank(trustedAggregators[2]);
        bool success = aggregator.submitHashroot(batchNumber, hashroot);
        assertEq(success, true, "Submitting same hashroot should succeed");

        // Try to submit different hashroot for already processed batch - should revert
        vm.prank(trustedAggregators[2]);
        vm.expectRevert("Cannot submit different hashroot for already processed batch");
        aggregator.submitHashroot(batchNumber, differentHashroot);
    }

    function testVoteSameHashrootTwice() public {
        // Setup a batch
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(bytes("request_1"), bytes("test"), bytes("test"));

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

    /**
     * @dev Test that batches must be processed in the correct sequence
     * This test verifies:
     * 1. Can't process a batch if previous batches aren't processed
     * 2. Can't process a non-existent batch
     * 3. Batches must be processed in ascending numerical order
     */
    function testSequentialBatchProcessingWithGaps() public {
        // Set up batches with gaps
        vm.startPrank(trustedAggregators[0]);

        // Create several commitments
        for (uint256 i = 1; i <= 10; i++) {
            aggregator.submitCommitment(
                bytes(abi.encodePacked("request_", 900+i)), 
                bytes(abi.encodePacked("test-payload-", i)), 
                bytes(abi.encodePacked("test-auth-", i))
            );
        }

        // Create batch 1
        bytes[] memory batch1Ids = new bytes[](2);
        batch1Ids[0] = bytes(abi.encodePacked("request_", uint256(901)));
        batch1Ids[1] = bytes(abi.encodePacked("request_", uint256(902)));
        uint256 batch1Number = aggregator.createBatchForRequests(batch1Ids);

        // Create batch 5 (with explicit number - creates a gap)
        bytes[] memory batch5Ids = new bytes[](2);
        batch5Ids[0] = bytes(abi.encodePacked("request_", uint256(905)));
        batch5Ids[1] = bytes(abi.encodePacked("request_", uint256(906)));
        uint256 batch5Number = 5;
        aggregator.createBatchForRequestsWithNumber(batch5Ids, batch5Number);

        // Create batch 10 (with explicit number - creates another gap)
        bytes[] memory batch10Ids = new bytes[](2);
        batch10Ids[0] = bytes(abi.encodePacked("request_", uint256(909)));
        batch10Ids[1] = bytes(abi.encodePacked("request_", uint256(910)));
        uint256 batch10Number = 10;
        aggregator.createBatchForRequestsWithNumber(batch10Ids, batch10Number);
        vm.stopPrank();

        // TEST CASE 1: Try to process batch 5 before batch 1
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Batches must be processed in sequence; can't skip batches");
        aggregator.submitHashroot(batch5Number, bytes("test-hashroot"));

        // TEST CASE 2: Try to process batch 10 before batches 1 and 5
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Batches must be processed in sequence; can't skip batches");
        aggregator.submitHashroot(batch10Number, bytes("test-hashroot"));

        // TEST CASE 3: Try to process a non-existent batch (batch 2)
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Batch does not exist");
        aggregator.submitHashroot(2, bytes("test-hashroot"));

        // TEST CASE 3b: Try to process a batch number larger than any existing batch
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Invalid batch number");
        aggregator.submitHashroot(999, bytes("test-hashroot"));

        // TEST CASE 4: Process batch 1 correctly
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitHashroot(batch1Number, bytes("test-hashroot"));
        vm.stopPrank();

        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(batch1Number, bytes("test-hashroot"));

        // Verify batch 1 is processed
        (, bool batch1Processed,) = aggregator.getBatch(batch1Number);
        assertTrue(batch1Processed, "Batch 1 should be processed");
        assertEq(aggregator.getLatestProcessedBatchNumber(), batch1Number, "Latest processed batch number should be 1");

        // TEST CASE 5: Try to process batch 10 before batch 5 (should still fail)
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Batches must be processed in sequence; can't skip batches");
        aggregator.submitHashroot(batch10Number, bytes("test-hashroot"));

        // TEST CASE 6: Create a batch between 1 and 5 (batch 3)
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(bytes(abi.encodePacked("request_", uint256(903))), bytes("test-payload-3"), bytes("test-auth-3"));

        bytes[] memory batch3Ids = new bytes[](1);
        batch3Ids[0] = bytes(abi.encodePacked("request_", uint256(903)));
        uint256 batch3Number = 3;

        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequestsWithNumber(batch3Ids, batch3Number);

        // Verify we can't skip to batch 5 now that batch 3 exists
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Batches must be processed in sequence; can't skip batches");
        aggregator.submitHashroot(batch5Number, bytes("test-hashroot"));

        // TEST CASE 7: Attempt to process batch 3 (should fail because batch 2 doesn't exist)
        vm.startPrank(trustedAggregators[0]);
        vm.expectRevert("Batches must be processed in sequence; can't skip batches");
        aggregator.submitHashroot(batch3Number, bytes("test-hashroot"));
        vm.stopPrank();

        // TEST CASE 8: Create and process batch 2 first (filling the gap)
        bytes[] memory batch2Ids = new bytes[](1);
        batch2Ids[0] = bytes(abi.encodePacked("request_", uint256(904))); // Use another request for batch 2
        uint256 batch2Number = 2;

        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequestsWithNumber(batch2Ids, batch2Number);

        // Process batch 2
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitHashroot(batch2Number, bytes("test-hashroot"));
        vm.stopPrank();

        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(batch2Number, bytes("test-hashroot"));

        // Verify batch 2 is processed
        (, bool batch2Processed,) = aggregator.getBatch(batch2Number);
        assertTrue(batch2Processed, "Batch 2 should be processed");
        assertEq(aggregator.getLatestProcessedBatchNumber(), batch2Number, "Latest processed batch number should be 2");

        // Now process batch 3 (should succeed now that batch 2 is processed)
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitHashroot(batch3Number, bytes("test-hashroot"));
        vm.stopPrank();

        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(batch3Number, bytes("test-hashroot"));

        // Verify batch 3 is processed
        (, bool batch3Processed,) = aggregator.getBatch(batch3Number);
        assertTrue(batch3Processed, "Batch 3 should be processed");
        assertEq(aggregator.getLatestProcessedBatchNumber(), batch3Number, "Latest processed batch number should be 3");

        // TEST CASE 9: Try to skip to batch 5 (should still fail because batch 4 is missing)
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Batches must be processed in sequence; can't skip batches");
        aggregator.submitHashroot(batch5Number, bytes("test-hashroot"));

        // Create and process batch 4
        bytes[] memory batch4Ids = new bytes[](1);
        batch4Ids[0] = bytes(abi.encodePacked("request_", uint256(907))); // Use another available request ID
        uint256 batch4Number = 4;

        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequestsWithNumber(batch4Ids, batch4Number);

        // Process batch 4
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitHashroot(batch4Number, bytes("test-hashroot"));
        vm.stopPrank();

        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(batch4Number, bytes("test-hashroot"));

        // TEST CASE 10: Now we can process batch 5
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitHashroot(batch5Number, bytes("test-hashroot"));
        vm.stopPrank();

        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(batch5Number, bytes("test-hashroot"));

        // Verify batch 5 is processed
        (, bool batch5Processed,) = aggregator.getBatch(batch5Number);
        assertTrue(batch5Processed, "Batch 5 should be processed");
        assertEq(aggregator.getLatestProcessedBatchNumber(), batch5Number, "Latest processed batch number should be 5");

        // Try to process batch 10 before processing batches 6 through 9 - should fail
        vm.startPrank(trustedAggregators[0]);
        vm.expectRevert("Batches must be processed in sequence; can't skip batches");
        aggregator.submitHashroot(batch10Number, bytes("test-hashroot"));
        vm.stopPrank();

        // Try to create batch 7 with the same request ID as batch 6 - should fail
        bytes[] memory sameRequestIds = new bytes[](1);
        sameRequestIds[0] = bytes(abi.encodePacked("request_", uint256(908)));

        // Create batch 6 first
        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequestsWithNumber(sameRequestIds, 6);

        // Process batch 6
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitHashroot(6, bytes("test-hashroot"));
        vm.stopPrank();

        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(6, bytes("test-hashroot"));

        // Try to reuse the same ID for batch 7 - should revert
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("No valid unprocessed request IDs provided");
        aggregator.createBatchForRequestsWithNumber(sameRequestIds, 7);

        // Create remaining batches with new request IDs
        // Create batch 7
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(bytes(abi.encodePacked("request_", uint256(1007))), bytes("batch-7"), bytes("auth-7"));
        bytes[] memory batch7Ids = new bytes[](1);
        batch7Ids[0] = bytes(abi.encodePacked("request_", uint256(1007)));
        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequestsWithNumber(batch7Ids, 7);

        // Process batch 7
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitHashroot(7, bytes("test-hashroot"));
        vm.stopPrank();
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(7, bytes("test-hashroot"));

        // Create batch 8
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(bytes(abi.encodePacked("request_", uint256(1008))), bytes("batch-8"), bytes("auth-8"));
        bytes[] memory batch8Ids = new bytes[](1);
        batch8Ids[0] = bytes(abi.encodePacked("request_", uint256(1008)));
        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequestsWithNumber(batch8Ids, 8);

        // Process batch 8
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitHashroot(8, bytes("test-hashroot"));
        vm.stopPrank();
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(8, bytes("test-hashroot"));

        // Create batch 9
        vm.prank(trustedAggregators[0]);
        bytes memory requestId9 = bytes(abi.encodePacked("request_", uint256(1009)));
        aggregator.submitCommitment(requestId9, bytes("batch-9"), bytes("auth-9"));
        bytes[] memory batch9Ids = new bytes[](1);
        batch9Ids[0] = requestId9;
        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequestsWithNumber(batch9Ids, 9);

        // Process batch 9
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitHashroot(9, bytes("test-hashroot"));
        vm.stopPrank();
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(9, bytes("test-hashroot"));

        // TEST CASE 9: Now we can finally process batch 10
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitHashroot(batch10Number, bytes("test-hashroot"));
        vm.stopPrank();

        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(batch10Number, bytes("test-hashroot"));

        // Verify batch 10 is processed
        (, bool batch10Processed,) = aggregator.getBatch(batch10Number);
        assertTrue(batch10Processed, "Batch 10 should be processed");
        assertEq(
            aggregator.getLatestProcessedBatchNumber(), batch10Number, "Latest processed batch number should be 10"
        );
    }

    /**
     * @dev Test that methods with implicit batch numbering fill gaps
     * This test verifies that when using methods that auto-assign batch numbers
     * (like createBatch and submitAndCreateBatch), they will fill in gaps in the sequence
     * created by explicit batch numbering.
     */
    /**
     * @dev Test that implicit batch numbering fills gaps
     * This test verifies that auto-numbering batch creation methods
     * fill in gaps in the batch sequence created by explicit batch numbering.
     */
    function testImplicitBatchNumberingFillsGaps() public {
        // Setup some initial data
        vm.startPrank(trustedAggregators[0]);

        // Create several commitments
        for (uint256 i = 1; i <= 15; i++) {
            aggregator.submitCommitment(
                bytes(abi.encodePacked("request_", 100 + i)), bytes(abi.encodePacked("payload-", i)), bytes(abi.encodePacked("auth-", i))
            );
        }

        // First, verify that the next auto-numbered batch is 1
        assertEq(aggregator.getNextAutoNumberedBatch(), 1, "Initial auto-numbered batch should be 1");

        // Create batch 1 (auto-assigned number)
        bytes[] memory batch1Ids = new bytes[](1);
        batch1Ids[0] = bytes(abi.encodePacked("request_", uint256(101)));
        uint256 batch1 = aggregator.createBatchForRequests(batch1Ids);
        assertEq(batch1, 1, "First batch should be number 1");

        // The next auto-numbered batch should now be 2
        assertEq(aggregator.getNextAutoNumberedBatch(), 2, "Next auto-numbered batch should be 2");

        // Now create batch 3 (skipping 2) with explicit numbering
        bytes[] memory batch3Ids = new bytes[](1);
        batch3Ids[0] = bytes(abi.encodePacked("request_", uint256(111)));
        uint256 batch3Number = 3;
        aggregator.createBatchForRequestsWithNumber(batch3Ids, batch3Number);

        // Check that firstGapIndex is still correctly pointing to gap 2
        assertEq(
            aggregator.getNextAutoNumberedBatch(), 2, "Next auto-numbered batch should still be 2 (gap not filled)"
        );

        // Create batch 5 with explicit numbering (creating a gap)
        bytes[] memory batch5Ids = new bytes[](1);
        batch5Ids[0] = bytes(abi.encodePacked("request_", uint256(102)));
        uint256 batch5 = 5;
        aggregator.createBatchForRequestsWithNumber(batch5Ids, batch5);

        // Verify both tracking variables
        assertEq(aggregator.getLatestBatchNumber(), 5, "Highest batch number should be 5");
        assertEq(aggregator.getNextAutoNumberedBatch(), 2, "Next auto-numbered batch should still be 2");

        // Now create a batch with auto-numbering - should be batch 2 (filling the gap)
        bytes[] memory batch2Ids = new bytes[](1);
        batch2Ids[0] = bytes(abi.encodePacked("request_", uint256(103)));
        uint256 batch2 = aggregator.createBatchForRequests(batch2Ids);
        assertEq(batch2, 2, "Auto-numbered batch should fill gap with number 2");

        // The next auto-numbered batch should be 4 (since batch 3 already exists)
        assertEq(
            aggregator.getNextAutoNumberedBatch(), 4, "Next auto-numbered batch should be 4 (since batch 3 exists)"
        );

        // Create another auto-numbered batch - should be batch 4
        bytes[] memory autoNumBatch4Ids = new bytes[](1);
        autoNumBatch4Ids[0] = bytes(abi.encodePacked("request_", uint256(104)));
        uint256 batch4 = aggregator.createBatchForRequests(autoNumBatch4Ids);
        assertEq(batch4, 4, "Auto-numbered batch should be 4");

        // Create batch 10 with explicit numbering (creating another gap)
        bytes[] memory batch10Ids = new bytes[](1);
        batch10Ids[0] = bytes(abi.encodePacked("request_", uint256(105)));
        uint256 batch10 = 10;
        aggregator.createBatchForRequestsWithNumber(batch10Ids, batch10);

        // Verify tracking variables
        assertEq(aggregator.getLatestBatchNumber(), 10, "Highest batch number should be 10");
        assertEq(aggregator.getNextAutoNumberedBatch(), 6, "Next auto-numbered batch should be 6 (gaps at 6,7,8,9)");

        // Create more commitments for the remaining batches
        for (uint256 i = 0; i < 10; i++) {
            aggregator.submitCommitment(
                bytes(abi.encodePacked("request_", 200 + i)), bytes(abi.encodePacked("new-payload-", i)), bytes(abi.encodePacked("new-auth-", i))
            );
        }

        // Fill the remaining gaps (6,7,8,9) with auto-numbered batches
        for (uint256 i = 6; i <= 9; i++) {
            bytes[] memory ids = new bytes[](1);
            ids[0] = bytes(abi.encodePacked("request_", 200 + (i - 6))); // Use the new request IDs
            uint256 batchNum = aggregator.createBatchForRequests(ids);
            assertEq(batchNum, i, string(abi.encodePacked("Auto-numbered batch should be ", i)));

            // Next gap should be i+1, unless it's 10 which already exists
            uint256 expectedNextGap = (i == 9) ? 11 : i + 1;
            assertEq(
                aggregator.getNextAutoNumberedBatch(),
                expectedNextGap,
                string(abi.encodePacked("Next auto-numbered batch should be ", expectedNextGap))
            );
        }

        // Create one more batch - should be 11 (after all gaps are filled)
        bytes[] memory batch11Ids = new bytes[](1);
        batch11Ids[0] = bytes(abi.encodePacked("request_", uint256(209))); // Use the last new request ID
        uint256 batch11 = aggregator.createBatchForRequests(batch11Ids);
        assertEq(batch11, 11, "Next auto-numbered batch after all gaps filled should be 11");

        vm.stopPrank();
    }

    /**
     * @dev Test all three auto-numbering batch creation methods fill gaps correctly
     * This tests each of the auto-numbering methods:
     * 1. createBatch() - creates a batch with all unprocessed requests
     * 2. createBatchForRequests() - creates a batch with specified request IDs
     * 3. submitAndCreateBatch() - submits and batches commitments in one operation
     */
    function testAllAutoNumberingMethodsFillGaps() public {
        vm.startPrank(trustedAggregators[0]);

        // Verify initial state
        assertEq(aggregator.getNextAutoNumberedBatch(), 1, "Initial auto-numbered batch should be 1");
        assertEq(aggregator.getLatestBatchNumber(), 0, "No batches yet, latest should be 0");

        // Create batches with explicit numbering to create gaps

        // Group 1: For explicit batch 2, 4, 7, 9
        for (uint256 i = 1; i <= 4; i++) {
            aggregator.submitCommitment(
                bytes(abi.encodePacked("request_", 1000 + i)), bytes(abi.encodePacked("group1-payload-", i)), bytes(abi.encodePacked("group1-auth-", i))
            );
        }

        // Create batch 2
        bytes[] memory batch2Ids = new bytes[](1);
        batch2Ids[0] = bytes(abi.encodePacked("request_", uint256(1001)));
        aggregator.createBatchForRequestsWithNumber(batch2Ids, 2);

        // Create batch 4
        bytes[] memory batch4Ids = new bytes[](1);
        batch4Ids[0] = bytes(abi.encodePacked("request_", uint256(1002)));
        aggregator.createBatchForRequestsWithNumber(batch4Ids, 4);

        // Create batch 7
        bytes[] memory batch7Ids = new bytes[](1);
        batch7Ids[0] = bytes(abi.encodePacked("request_", uint256(1003)));
        aggregator.createBatchForRequestsWithNumber(batch7Ids, 7);

        // Create batch 9
        bytes[] memory batch9Ids = new bytes[](1);
        batch9Ids[0] = bytes(abi.encodePacked("request_", uint256(1004)));
        aggregator.createBatchForRequestsWithNumber(batch9Ids, 9);

        // Verify state after creating gaps
        assertEq(aggregator.getNextAutoNumberedBatch(), 1, "First gap should be at position 1");
        assertEq(aggregator.getLatestBatchNumber(), 9, "Latest batch number should be 9");

        // TEST METHOD 1: createBatch()
        // This should create batch 1 (filling first gap)
        // Add commitments for the first batch
        for (uint256 i = 1; i <= 3; i++) {
            aggregator.submitCommitment(
                bytes(abi.encodePacked("request_", 1100 + i)), bytes(abi.encodePacked("batch1-payload-", i)), bytes(abi.encodePacked("batch1-auth-", i))
            );
        }
        uint256 autoBatch1 = aggregator.createBatch();
        assertEq(autoBatch1, 1, "createBatch() should fill gap 1");

        // Verify next gap is now 3
        assertEq(aggregator.getNextAutoNumberedBatch(), 3, "Next gap should be 3");

        // TEST METHOD 2: createBatchForRequests()
        // This should create batch 3 (filling the next gap)
        // Add a commitment for batch 3
        aggregator.submitCommitment(bytes(abi.encodePacked("request_", uint256(2001))), bytes("batch3-payload"), bytes("batch3-auth"));
        bytes[] memory requestIds = new bytes[](1);
        requestIds[0] = bytes(abi.encodePacked("request_", uint256(2001)));
        uint256 autoBatch3 = aggregator.createBatchForRequests(requestIds);
        assertEq(autoBatch3, 3, "createBatchForRequests() should fill gap 3");

        // Verify next gap is now 5
        assertEq(aggregator.getNextAutoNumberedBatch(), 5, "Next gap should be 5");

        // TEST METHOD 3: submitAndCreateBatch()
        // This should create batch 5 (filling the next gap)
        IAggregatorBatches.CommitmentRequest[] memory newRequests = new IAggregatorBatches.CommitmentRequest[](2);

        newRequests[0] = IAggregatorBatches.CommitmentRequest({
            requestID: bytes(abi.encodePacked("request_", uint256(3001))),
            payload: bytes("batch5-payload-1"),
            authenticator: bytes("batch5-auth-1")
        });

        newRequests[1] = IAggregatorBatches.CommitmentRequest({
            requestID: bytes(abi.encodePacked("request_", uint256(3002))),
            payload: bytes("batch5-payload-2"),
            authenticator: bytes("batch5-auth-2")
        });

        (uint256 autoBatch5, uint256 successCount) = aggregator.submitAndCreateBatch(newRequests);
        assertEq(autoBatch5, 5, "submitAndCreateBatch() should fill gap 5");
        assertEq(successCount, 2, "Both new commitments should be submitted successfully");

        // Verify next gap is now 6
        assertEq(aggregator.getNextAutoNumberedBatch(), 6, "Next gap should be 6");

        // Verify the batch contents to ensure they were created correctly

        // Check batch 1 (created with createBatch)
        (IAggregatorBatches.CommitmentRequest[] memory batch1Requests,,) = aggregator.getBatch(1);
        assertGt(batch1Requests.length, 0, "Batch 1 should contain commitments");

        // Check batch 3 (created with createBatchForRequests)
        (IAggregatorBatches.CommitmentRequest[] memory batch3Requests,,) = aggregator.getBatch(3);
        assertEq(batch3Requests.length, 1, "Batch 3 should contain 1 commitment");
        assertEq(keccak256(batch3Requests[0].requestID), keccak256(bytes(abi.encodePacked("request_", uint256(2001)))), "Batch 3 should contain request ID 2001");

        // Check batch 5 (created with submitAndCreateBatch)
        (IAggregatorBatches.CommitmentRequest[] memory batch5Requests,,) = aggregator.getBatch(5);
        assertEq(batch5Requests.length, 2, "Batch 5 should contain 2 commitments");
        assertEq(keccak256(batch5Requests[0].requestID), keccak256(bytes(abi.encodePacked("request_", uint256(3001)))), "Batch 5 should contain request ID 3001");
        assertEq(keccak256(batch5Requests[1].requestID), keccak256(bytes(abi.encodePacked("request_", uint256(3002)))), "Batch 5 should contain request ID 3002");

        // Create one more gap at 8
        aggregator.submitCommitment(bytes(abi.encodePacked("request_", uint256(2003))), bytes("batch8-payload"), bytes("batch8-auth"));
        bytes[] memory batch8Ids = new bytes[](1);
        batch8Ids[0] = bytes(abi.encodePacked("request_", uint256(2003)));
        aggregator.createBatchForRequestsWithNumber(batch8Ids, 8);

        // Now test createBatch will fill gap 6
        // Add some commitments for batch 6
        for (uint256 i = 1; i <= 2; i++) {
            aggregator.submitCommitment(
                bytes(abi.encodePacked("request_", 4000 + i)), bytes(abi.encodePacked("batch6-payload-", i)), bytes(abi.encodePacked("batch6-auth-", i))
            );
        }

        uint256 autoBatch6 = aggregator.createBatch();
        assertEq(autoBatch6, 6, "createBatch should fill gap 6");

        vm.stopPrank();
    }

    // Tests for administrative functions

    function testAddAggregator() public {
        address newAggregator = address(0x4);

        // Add new aggregator
        aggregator.addAggregator(newAggregator);

        // Verify the new aggregator can perform trusted actions
        vm.prank(newAggregator);
        aggregator.submitCommitment(bytes("request_1"), bytes("test"), bytes("test"));

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
        aggregator.submitCommitment(bytes("request_1"), bytes("test"), bytes("test"));

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
        aggregator.submitCommitment(bytes("request_1"), bytes("test"), bytes("test"));

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

    /**
     * @dev Test creating batches with explicit batch numbers
     * Verifies the behavior when creating batches with non-sequential numbers
     */
    function testCreateBatchWithExplicitNumber() public {
        // Submit several commitments
        vm.startPrank(trustedAggregators[0]);
        aggregator.submitCommitment(bytes("request_201"), bytes("payload 201"), bytes("auth 201"));
        aggregator.submitCommitment(bytes("request_202"), bytes("payload 202"), bytes("auth 202"));
        aggregator.submitCommitment(bytes("request_203"), bytes("payload 203"), bytes("auth 203"));
        aggregator.submitCommitment(bytes("request_204"), bytes("payload 204"), bytes("auth 204"));
        aggregator.submitCommitment(bytes("request_205"), bytes("payload 205"), bytes("auth 205"));
        vm.stopPrank();

        // Create batch with a high batch number (creates a gap)
        bytes[] memory requestIds = new bytes[](2);
        requestIds[0] = bytes("request_201");
        requestIds[1] = bytes("request_202");

        uint256 explicitBatchNumber = 10; // Create batch #10

        vm.prank(trustedAggregators[0]);
        uint256 createdBatchNumber = aggregator.createBatchForRequestsWithNumber(requestIds, explicitBatchNumber);

        // Verify the batch was created with the explicit number
        assertEq(createdBatchNumber, explicitBatchNumber, "Batch should have explicit number");

        // Check the latest batch number is updated
        assertEq(aggregator.getLatestBatchNumber(), explicitBatchNumber, "Latest batch number should be updated");

        // Verify the batch contents
        (IAggregatorBatches.CommitmentRequest[] memory batch10Requests,,) = aggregator.getBatch(explicitBatchNumber);
        assertEq(batch10Requests.length, 2, "Batch 10 should have 2 requests");

        // Create a second batch with a different explicit number (lower than the first one)
        bytes[] memory requestIds2 = new bytes[](2);
        requestIds2[0] = bytes("request_203");
        requestIds2[1] = bytes("request_204");

        uint256 explicitBatchNumber2 = 5; // Create batch #5

        vm.prank(trustedAggregators[0]);
        uint256 createdBatchNumber2 = aggregator.createBatchForRequestsWithNumber(requestIds2, explicitBatchNumber2);

        // Verify the second batch
        assertEq(createdBatchNumber2, explicitBatchNumber2, "Second batch should have explicit number");

        // Check the latest batch number is still 10 (not changed)
        assertEq(aggregator.getLatestBatchNumber(), explicitBatchNumber, "Latest batch number should still be 10");

        // Verify the second batch contents
        (IAggregatorBatches.CommitmentRequest[] memory batch5Requests,,) = aggregator.getBatch(explicitBatchNumber2);
        assertEq(batch5Requests.length, 2, "Batch 5 should have 2 requests");

        // Try to create batch with already used batch number (should revert)
        bytes[] memory requestIds3 = new bytes[](1);
        requestIds3[0] = bytes("request_205");

        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Batch number already exists");
        aggregator.createBatchForRequestsWithNumber(requestIds3, explicitBatchNumber);

        // Try to create batch with batch number 0 (should revert)
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Batch number must be greater than 0");
        aggregator.createBatchForRequestsWithNumber(requestIds3, 0);

        // First, create batches 1-4 explicitly (batch 5 already exists)

        // Create batch 1
        bytes memory newReqId1 = bytes("request_301");
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(newReqId1, bytes("batch 1 payload"), bytes("batch 1 auth"));
        bytes[] memory batch1Ids = new bytes[](1);
        batch1Ids[0] = newReqId1;
        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequestsWithNumber(batch1Ids, 1);

        // Create batch 2
        bytes memory newReqId2 = bytes("request_302");
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(newReqId2, bytes("batch 2 payload"), bytes("batch 2 auth"));
        bytes[] memory batch2Ids = new bytes[](1);
        batch2Ids[0] = newReqId2;
        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequestsWithNumber(batch2Ids, 2);

        // Create batch 3
        bytes memory newReqId3 = bytes("request_303");
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(newReqId3, bytes("batch 3 payload"), bytes("batch 3 auth"));
        bytes[] memory batch3Ids = new bytes[](1);
        batch3Ids[0] = newReqId3;
        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequestsWithNumber(batch3Ids, 3);

        // Create batch 4
        bytes memory newReqId4 = bytes("request_304");
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(newReqId4, bytes("batch 4 payload"), bytes("batch 4 auth"));
        bytes[] memory batch4Ids = new bytes[](1);
        batch4Ids[0] = newReqId4;
        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequestsWithNumber(batch4Ids, 4);

        // Now process batch 1
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(1, bytes("hashroot"));
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(1, bytes("hashroot"));

        // Process batch 2
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(2, bytes("hashroot"));
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(2, bytes("hashroot"));

        // Process batch 3
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(3, bytes("hashroot"));
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(3, bytes("hashroot"));

        // Process batch 4
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(4, bytes("hashroot"));
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(4, bytes("hashroot"));

        // Process batch 5
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(5, bytes("hashroot"));
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(5, bytes("hashroot"));

        // Verify batch 5 is processed
        (, bool batch5Processed,) = aggregator.getBatch(explicitBatchNumber2);
        assertTrue(batch5Processed, "Batch 5 should be processed");

        // TEST CASE 1: Try to process batch 10 directly (should fail)
        // Since we need to process batches in sequence, we get "Batches must be processed in sequence"
        // (The validation for sequential processing comes before checking if the batch exists)
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Batches must be processed in sequence; can't skip batches");
        aggregator.submitHashroot(explicitBatchNumber, bytes("hashroot for batch 10"));

        // TEST CASE 2: Try to process an invalid batch that's next in sequence (batch 6 doesn't exist yet)
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Batch does not exist");
        aggregator.submitHashroot(6, bytes("hashroot for batch 6"));

        // Create missing batches 6-9 to fill the gaps

        // Create batch 6
        bytes memory newReqId6 = bytes("request_306");
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(newReqId6, bytes("batch 6 payload"), bytes("batch 6 auth"));
        bytes[] memory batch6Ids = new bytes[](1);
        batch6Ids[0] = newReqId6;
        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequestsWithNumber(batch6Ids, 6);

        // Create batch 7
        bytes memory newReqId7 = bytes("request_307");
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(newReqId7, bytes("batch 7 payload"), bytes("batch 7 auth"));
        bytes[] memory batch7Ids = new bytes[](1);
        batch7Ids[0] = newReqId7;
        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequestsWithNumber(batch7Ids, 7);

        // Create batch 8
        bytes memory newReqId8 = bytes("request_308");
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(newReqId8, bytes("batch 8 payload"), bytes("batch 8 auth"));
        bytes[] memory batch8Ids = new bytes[](1);
        batch8Ids[0] = newReqId8;
        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequestsWithNumber(batch8Ids, 8);

        // Create batch 9
        bytes memory newReqId9 = bytes("request_309");
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(newReqId9, bytes("batch 9 payload"), bytes("batch 9 auth"));
        bytes[] memory batch9Ids = new bytes[](1);
        batch9Ids[0] = newReqId9;
        vm.prank(trustedAggregators[0]);
        aggregator.createBatchForRequestsWithNumber(batch9Ids, 9);

        // Now process each gap batch in sequence

        // Process batch 6
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(6, bytes("hashroot"));
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(6, bytes("hashroot"));

        // Process batch 7
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(7, bytes("hashroot"));
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(7, bytes("hashroot"));

        // Process batch 8
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(8, bytes("hashroot"));
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(8, bytes("hashroot"));

        // Process batch 9
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(9, bytes("hashroot"));
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(9, bytes("hashroot"));

        // TEST CASE: Now that all gaps are filled, we should be able to process batch 10
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(explicitBatchNumber, bytes("hashroot for batch 10"));
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(explicitBatchNumber, bytes("hashroot for batch 10"));

        // Verify batch 10 is processed
        (, bool batch10Processed,) = aggregator.getBatch(explicitBatchNumber);
        assertTrue(batch10Processed, "Batch 10 should be processed now that all gaps are filled");

        // Verify that the latest processed batch number is updated to 10
        assertEq(aggregator.getLatestProcessedBatchNumber(), explicitBatchNumber, "Latest processed batch should be 10");
    }

    /**
     * @dev Test submitAndCreateBatchWithNumber functionality
     */
    function testSubmitAndCreateBatchWithNumber() public {
        // Create commitment requests
        IAggregatorBatches.CommitmentRequest[] memory requests = new IAggregatorBatches.CommitmentRequest[](3);

        requests[0] = IAggregatorBatches.CommitmentRequest({
            requestID: bytes("request_301"),
            payload: bytes("payload 301"),
            authenticator: bytes("auth 301")
        });

        requests[1] = IAggregatorBatches.CommitmentRequest({
            requestID: bytes("request_302"),
            payload: bytes("payload 302"),
            authenticator: bytes("auth 302")
        });

        requests[2] = IAggregatorBatches.CommitmentRequest({
            requestID: bytes("request_303"),
            payload: bytes("payload 303"),
            authenticator: bytes("auth 303")
        });

        // Submit and create batch with explicit number
        uint256 explicitBatchNumber = 20;
        vm.prank(trustedAggregators[0]);
        (uint256 batchNumber, uint256 successCount) =
            aggregator.submitAndCreateBatchWithNumber(requests, explicitBatchNumber);

        // Verify the results
        assertEq(batchNumber, explicitBatchNumber, "Batch should have explicit number");
        assertEq(successCount, 3, "All 3 commitments should be successful");

        // Check batch contents
        (IAggregatorBatches.CommitmentRequest[] memory batchRequests,,) = aggregator.getBatch(explicitBatchNumber);
        assertEq(batchRequests.length, 3, "Batch should have 3 requests");

        // Verify the latest batch number is updated
        assertEq(aggregator.getLatestBatchNumber(), explicitBatchNumber, "Latest batch number should be updated");

        // Create another batch with an explicit number different from the first
        IAggregatorBatches.CommitmentRequest[] memory requests2 = new IAggregatorBatches.CommitmentRequest[](1);
        requests2[0] = IAggregatorBatches.CommitmentRequest({
            requestID: bytes("request_304"),
            payload: bytes("payload 304"),
            authenticator: bytes("auth 304")
        });

        uint256 explicitBatchNumber2 = 15; // Different from the first one

        vm.prank(trustedAggregators[0]);
        (uint256 batchNumber2, uint256 successCount2) =
            aggregator.submitAndCreateBatchWithNumber(requests2, explicitBatchNumber2);

        // Verify the results
        assertEq(batchNumber2, explicitBatchNumber2, "Batch should have explicit number");
        assertEq(successCount2, 1, "All 1 commitment should be successful");

        // Latest batch number should still be 20 (higher than 15)
        assertEq(aggregator.getLatestBatchNumber(), explicitBatchNumber, "Latest batch number should still be 20");
    }

    function testCreateBatchForRequestsWithNoValidRequests() public {
        // Try to create batch with only invalid request IDs
        bytes[] memory invalidRequests = new bytes[](2);
        invalidRequests[0] = bytes("request_999");
        invalidRequests[1] = bytes("request_888");

        // Should revert because there are no valid unprocessed request IDs
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("No valid unprocessed request IDs provided");
        aggregator.createBatchForRequests(invalidRequests);
    }

    // Tests for remaining untested functions and branches

    function testGetCommitment() public {
        // Submit a commitment
        bytes memory requestID = bytes("request_123");
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
        IAggregatorBatches.CommitmentRequest memory emptyRequest = aggregator.getCommitment(bytes("request_999"));
        assertEq(emptyRequest.requestID.length, 0, "Non-existent request should have empty requestID");
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
        aggregator.submitCommitment(bytes("request_10"), bytes("payload 10"), bytes("auth 10"));
        aggregator.createBatch();

        // Check latest batch number updated
        latestBatch = aggregator.getLatestBatchNumber();
        assertEq(latestBatch, 1, "Latest batch should be 1");

        // Create more batches
        aggregator.submitCommitment(bytes("request_20"), bytes("payload 20"), bytes("auth 20"));
        aggregator.createBatch();

        aggregator.submitCommitment(bytes("request_30"), bytes("payload 30"), bytes("auth 30"));
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
        aggregator.submitCommitment(bytes("request_1"), bytes("test payload"), bytes("test authenticator"));

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
        aggregator.submitCommitment(bytes("request_10"), bytes("payload 10"), bytes("auth 10"));
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
        aggregator.submitCommitment(bytes("request_20"), bytes("payload 20"), bytes("auth 20"));
        aggregator.createBatch();

        // Third batch
        aggregator.submitCommitment(bytes("request_30"), bytes("payload 30"), bytes("auth 30"));
        uint256 batch3 = aggregator.createBatch();
        vm.stopPrank();

        // Process batch 2
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(2, hashroot);
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(2, hashroot);

        // Create batch 4
        vm.prank(trustedAggregators[0]);
        aggregator.submitCommitment(bytes("request_40"), bytes("payload 40"), bytes("auth 40"));
        vm.prank(trustedAggregators[0]);
        uint256 batch4 = aggregator.createBatch();

        // Now batch 3 and 4 are unprocessed
        // The latest unprocessed batch should be batch 4
        (uint256 latestBatchNum, IAggregatorBatches.CommitmentRequest[] memory requests) =
            aggregator.getLatestUnprocessedBatch();

        assertEq(latestBatchNum, batch4, "Latest unprocessed batch should be batch 4");
        assertEq(requests.length, 1, "Batch should contain 1 request");
        assertEq(keccak256(requests[0].requestID), keccak256(bytes("request_40")), "Request should be ID 40");

        // If we try to process batch 4 before batch 3, it should revert
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Batches must be processed in sequence; can't skip batches");
        aggregator.submitHashroot(batch4, hashroot);

        // Process batch 3
        vm.prank(trustedAggregators[0]);
        aggregator.submitHashroot(batch3, hashroot);
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(batch3, hashroot);

        // Now try to process batch 3 again with the same hashroot - should succeed silently
        vm.prank(trustedAggregators[0]);
        bool success = aggregator.submitHashroot(batch3, hashroot);
        assertEq(success, true, "Submitting same hashroot should succeed");
        
        // Try to process batch 3 with a different hashroot - should revert
        bytes memory differentHashroot = bytes("different hashroot");
        vm.prank(trustedAggregators[0]);
        vm.expectRevert("Cannot submit different hashroot for already processed batch");
        aggregator.submitHashroot(batch3, differentHashroot);
    }
}
