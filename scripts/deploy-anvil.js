const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

async function main() {
  // Connect to local Anvil node
  const provider = new ethers.JsonRpcProvider('http://localhost:8545');
  
  // Use the default private key from Anvil
  const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const wallet = new ethers.Wallet(privateKey, provider);
  
  console.log("Deploying contracts with the account:", wallet.address);
  
  // Read the contract ABI and bytecode from the Forge output JSON
  const contractPath = path.join(__dirname, '..', 'out', 'AggregatorBatches.sol', 'AggregatorBatches.json');
  const contractJson = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const bytecode = contractJson.bytecode.object;
  const abi = contractJson.abi;
  
  // Create contract factory
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  
  // Deploy contract with constructor arguments
  // Initial trusted aggregator is the deployer address, required votes is 1
  const deployerAddress = wallet.address;
  console.log(`Setting deployer (${deployerAddress}) as trusted aggregator`);
  const contract = await factory.deploy([deployerAddress], 1);
  
  // Wait for deployment to be mined
  await contract.waitForDeployment();
  
  // Get contract address
  const contractAddress = await contract.getAddress();
  console.log("AggregatorBatches deployed to:", contractAddress);
  
  // Write contract address to file for use in tests
  fs.writeFileSync(path.join(__dirname, '..', 'contract-address.txt'), contractAddress);
  
  return { aggregatorBatches: contractAddress };
}

// Execute the deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });