const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Get contract factory
  const AggregatorBatches = await ethers.getContractFactory("AggregatorBatches");
  
  // Deploy with constructor parameters if needed
  // For example purposes, assuming the constructor needs no parameters
  // Adjust as needed based on the actual contract constructor
  const aggregatorBatches = await AggregatorBatches.deploy();
  await aggregatorBatches.waitForDeployment();
  
  const contractAddress = await aggregatorBatches.getAddress();
  console.log("AggregatorBatches deployed to:", contractAddress);
  
  return { aggregatorBatches: contractAddress };
}

// Execute the deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });