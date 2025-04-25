const { ethers } = require('ethers');
const fs = require('fs');

async function checkBatch() {
  const provider = new ethers.JsonRpcProvider('http://localhost:8545');
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const abi = JSON.parse(fs.readFileSync('./contract-abi.json', 'utf8'));
  const contract = new ethers.Contract(contractAddress, abi, provider);
  
  try {
    // Get the latest batch number to check
    const latestBatchNumber = await contract.getLatestBatchNumber();
    console.log('Latest batch number: ' + latestBatchNumber);
    
    // Check if any batch exists
    if (latestBatchNumber < 1) {
      console.log('No batches created yet on the contract!');
      process.exit(1);
    }
    
    // Get all batch numbers to check
    let anyBatchProcessed = false;
    
    for (let i = 1; i <= latestBatchNumber; i++) {
      try {
        // Query each batch
        const batch = await contract.getBatch(i);
        console.log(`Batch ${i} info:`);
        console.log(`- Processed: ${batch.processed}`);
        console.log(`- Hashroot: ${batch.hashroot || 'none'}`);
        console.log(`- Requests count: ${batch.requests.length}`);
        
        if (batch.processed) {
          anyBatchProcessed = true;
        }
      } catch (err) {
        console.log(`Error checking batch ${i}: ${err.message}`);
      }
    }
    
    // Return 0 for success (if any batch processed) or 1 for failure (if no batches processed)
    process.exit(anyBatchProcessed ? 0 : 1);
  } catch (error) {
    console.error('Error querying contract:', error.message);
    process.exit(1);
  }
}

checkBatch();
