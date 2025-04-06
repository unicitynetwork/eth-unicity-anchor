// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script, console} from "forge-std/Script.sol";
import "../src/AggregatorBatches.sol";

contract AggregatorBatchesScript is Script {
    function setUp() public {}

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // Set up trusted aggregators
        // These should be replaced with actual addresses for deployment
        address[] memory trustedAggregators = new address[](3);
        trustedAggregators[0] = address(0x1111111111111111111111111111111111111111);
        trustedAggregators[1] = address(0x2222222222222222222222222222222222222222);
        trustedAggregators[2] = address(0x3333333333333333333333333333333333333333);
        
        // Deploy with 2 out of 3 required votes
        AggregatorBatches aggregator = new AggregatorBatches(trustedAggregators, 2);
        
        console.log("AggregatorBatches deployed to:", address(aggregator));

        vm.stopBroadcast();
    }
}