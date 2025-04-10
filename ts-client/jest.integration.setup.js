/**
 * Setup file specific to integration tests
 */
const fs = require('fs');
const path = require('path');

// Set a longer timeout for integration tests
jest.setTimeout(60000);

// Load the contract ABI
let cachedContractAbi = null;

// Helper to read the contract ABI
global.getContractABI = () => {
  if (cachedContractAbi) return cachedContractAbi;
  
  try {
    // Try to load from the generated contract-abi.json file
    const abiPath = path.resolve(__dirname, '../contract-abi.json');
    if (fs.existsSync(abiPath)) {
      console.log('Using ABI from contract-abi.json');
      cachedContractAbi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
      return cachedContractAbi;
    }
  } catch (err) {
    console.warn('Failed to load ABI from contract-abi.json:', err.message);
  }
  
  // Fallback to the default ABI from the client
  console.log('Using default ABI from client');
  const { ABI } = require('./src/abi');
  cachedContractAbi = ABI;
  return cachedContractAbi;
};

// Global beforeAll hook for integration test suites
beforeAll(() => {
  console.log('Starting integration test suite');
  
  // Preload the contract ABI
  const abi = global.getContractABI();
  console.log(`Loaded contract ABI with ${abi.length} entries`);
  
  // Give the node some time to stabilize
  return new Promise(resolve => setTimeout(resolve, 1000));
});

// Global afterAll hook for integration test suites
afterAll(() => {
  console.log('Completed integration test suite');
  
  // Allow time for provider cleanup
  return new Promise(resolve => setTimeout(resolve, 1000));
});