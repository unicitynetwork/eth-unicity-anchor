const { ethers } = require('ethers');
const fs = require('fs');

async function main() {
  // Connect to local Anvil node
  const provider = new ethers.JsonRpcProvider('http://localhost:8545');
  
  // Use the default Anvil private key
  const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const wallet = new ethers.Wallet(privateKey, provider);
  
  // Read contract JSON artifacts from Forge output
  const contractJson = JSON.parse(fs.readFileSync('./out/AggregatorBatches.sol/AggregatorBatches.json', 'utf8'));
  const bytecode = contractJson.bytecode.object;
  const abi = contractJson.abi;
  
  // Deploy contract
  console.log('Deploying AggregatorBatches contract...');
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  
  // Deploy with constructor args: initial trusted aggregator is deployer, required votes is 1
  const contract = await factory.deploy([wallet.address], 1);
  await contract.waitForDeployment();
  
  // Get contract address
  const contractAddress = await contract.getAddress();
  console.log('Contract deployed to:', contractAddress);
  
  // Save contract address and ABI for later use
  fs.writeFileSync('./contract-address.txt', contractAddress);
  fs.writeFileSync('./contract-abi.json', JSON.stringify(abi, null, 2));
  
  return { contractAddress, abi };
}

main()
  .then(result => {
    process.stdout.write(result.contractAddress);
    process.exit(0);
  })
  .catch(error => {
    console.error('Deployment error:', error);
    process.exit(1);
  });
