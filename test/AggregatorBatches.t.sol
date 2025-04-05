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
        (,bool processed,) = aggregator.getBatch(batchNumber);
        assertEq(processed, false, "Batch should not be processed with only 1 vote");
        
        // Submit second vote
        vm.prank(trustedAggregators[1]);
        aggregator.submitHashroot(batchNumber, hashroot);
        
        // Now batch should be processed
        (IAggregatorBatches.CommitmentRequest[] memory requests2, bool processed2, bytes memory storedHashroot) = aggregator.getBatch(batchNumber);
        assertEq(processed2, true, "Batch should be processed after 2 votes");
        assertEq(string(storedHashroot), string(hashroot), "Hashroot should match");
        
        // Check latest processed batch number
        uint256 latestProcessed = aggregator.getLatestProcessedBatchNumber();
        assertEq(latestProcessed, batchNumber, "Latest processed batch should be updated");
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
}