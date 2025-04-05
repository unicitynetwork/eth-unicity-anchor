// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script, console} from "forge-std/Script.sol";
import "../src/AggregatorBatches.sol";

contract AggregatorBatchesScript is Script {
    function setUp() public {}

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // Set up initial trusted aggregators (replace with actual addresses)
        address[] memory trustedAggregators = new address[](3);
        trustedAggregators[0] = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // Example address 1
        trustedAggregators[1] = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; // Example address 2
        trustedAggregators[2] = 0x90F79bf6EB2c4f870365E785982E1f101E93b906; // Example address 3

        // Define required votes for consensus (2 out of 3 in this example)
        uint256 requiredVotes = 2;

        // Deploy AggregatorBatches contract
        AggregatorBatches aggregator = new AggregatorBatches(trustedAggregators, requiredVotes);
        console.log("AggregatorBatches deployed at:", address(aggregator));

        vm.stopBroadcast();
    }
}