/**
 * Global Jest setup file
 * 
 * This file contains global setup logic that runs before all tests.
 * It's referenced in jest.config.js via setupFilesAfterEnv.
 */

// Mock the SparseMerkleTree and HashAlgorithm from @unicitylabs/commons
jest.mock('@unicitylabs/commons/lib/smt/SparseMerkleTree.js', () => {
  return {
    SparseMerkleTree: class SparseMerkleTree {
      constructor(algorithm, root) {
        this.algorithm = algorithm;
        this.root = root || { hash: { data: new Uint8Array([1, 2, 3, 4]), toString: () => '[SHA256]0102030405' } };
      }
      
      static async create(algorithm) {
        return new SparseMerkleTree(algorithm);
      }
      
      get rootHash() {
        return this.root.hash;
      }
      
      async addLeaf(path, value) {
        // Mock implementation - just store the last leaf added
        this.lastPath = path;
        this.lastValue = value;
        return Promise.resolve();
      }
      
      getPath(path) {
        return {
          verify: async (verifyPath) => ({
            // Always return false for isPathIncluded for path 5n in the test
            isPathIncluded: verifyPath === 5n ? false : path === verifyPath,
            isPathValid: true,
            result: verifyPath === 5n ? false : path === verifyPath
          }),
          toString: () => `Mock MerkleTreePath for path ${path}`
        };
      }
      
      toString() {
        return 'Mock SparseMerkleTree';
      }
    }
  };
}, { virtual: true });

jest.mock('@unicitylabs/commons/lib/hash/HashAlgorithm.js', () => {
  return {
    HashAlgorithm: {
      SHA256: 0,
      SHA224: 1,
      SHA384: 2,
      SHA512: 3,
      RIPEMD160: 4
    }
  };
}, { virtual: true });

// Increase default timeout for all tests to 30 seconds
jest.setTimeout(30000);

// Mock ethers to avoid network connection issues in unit tests
jest.mock('ethers', () => {
  const originalModule = jest.requireActual('ethers');
  
  // Create a mock provider that doesn't try to connect to anything
  class MockProvider {
    getNetwork() {
      return Promise.resolve({ chainId: 1 });
    }
    
    getTransaction() {
      return Promise.resolve({});
    }
    
    getTransactionReceipt() {
      return Promise.resolve({
        hash: '0xmocktx',
        blockNumber: 12345,
        gasUsed: BigInt(100000),
        logs: []
      });
    }
    
    getCode() {
      return Promise.resolve('0x123456');
    }
    
    on() {}
    once() {}
    removeListener() {}
    
    destroy() {
      return Promise.resolve();
    }
  }
  
  // Create a mock JsonRpcProvider that won't try to connect
  class MockJsonRpcProvider extends MockProvider {
    constructor() {
      super();
    }
  }
  
  return {
    ...originalModule,
    JsonRpcProvider: jest.fn(() => new MockJsonRpcProvider()),
    WebSocketProvider: jest.fn(() => new MockJsonRpcProvider()),
    Contract: jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockReturnThis(),
      on: jest.fn(),
      submitCommitment: jest.fn().mockResolvedValue({ hash: '0xmocktx1' }),
      submitCommitments: jest.fn().mockResolvedValue({ hash: '0xmocktx2' }),
      submitAndCreateBatch: jest.fn().mockResolvedValue({ hash: '0xmocktx3' }),
      createBatch: jest.fn().mockResolvedValue({ hash: '0xmocktx4' }),
      getLatestBatchNumber: jest.fn().mockResolvedValue(0),
      estimateGas: {
        submitCommitment: jest.fn().mockResolvedValue(BigInt(100000)),
        submitCommitments: jest.fn().mockResolvedValue(BigInt(200000)),
        submitAndCreateBatch: jest.fn().mockResolvedValue(BigInt(300000)),
        createBatch: jest.fn().mockResolvedValue(BigInt(150000))
      }
    }))
  };
});

// Global beforeAll hook for all test suites
beforeAll(() => {
  // This runs once before all tests
  console.log('Starting TypeScript client test suite');
  
  // Suppress console.error and console.warn for cleaner test output
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

// Global afterAll hook for all test suites
afterAll(() => {
  // This runs once after all tests
  console.log('Completed TypeScript client test suite');
  
  // Restore console methods
  jest.restoreAllMocks();
  
  // Ensure there are no pending timers
  jest.useRealTimers();
  
  // Give time for any promises to resolve before the test exits
  // This helps prevent "Jest did not exit one second after the test run completed" warnings
  return new Promise(resolve => setTimeout(resolve, 500));
});

// Add a global helper to get a mock contract ABI for tests
global.getContractABI = () => {
  return [
    {
      "inputs": [
        {"internalType": "address", "name": "aggregator", "type": "address"}
      ],
      "name": "addAggregator",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "createBatch",
      "outputs": [
        {"internalType": "uint256", "name": "", "type": "uint256"}
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {"internalType": "uint256[]", "name": "requestIDs", "type": "uint256[]"}
      ],
      "name": "createBatchForRequests",
      "outputs": [
        {"internalType": "uint256", "name": "", "type": "uint256"}
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {"internalType": "uint256", "name": "batchNumber", "type": "uint256"}
      ],
      "name": "getBatch",
      "outputs": [
        {
          "components": [
            {"internalType": "uint256[]", "name": "requestIDs", "type": "uint256[]"},
            {"internalType": "bytes", "name": "hashroot", "type": "bytes"},
            {"internalType": "bool", "name": "processed", "type": "bool"}
          ],
          "internalType": "struct AggregatorBatches.Batch",
          "name": "",
          "type": "tuple"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "getLatestBatchNumber",
      "outputs": [
        {"internalType": "uint256", "name": "", "type": "uint256"}
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {"internalType": "uint256", "name": "requestID", "type": "uint256"}
      ],
      "name": "getRequest",
      "outputs": [
        {
          "components": [
            {"internalType": "bytes", "name": "payload", "type": "bytes"},
            {"internalType": "bytes", "name": "authenticator", "type": "bytes"},
            {"internalType": "uint256", "name": "batchNumber", "type": "uint256"}
          ],
          "internalType": "struct AggregatorBatches.Request",
          "name": "",
          "type": "tuple"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {"internalType": "uint256", "name": "requestID", "type": "uint256"},
        {"internalType": "bytes", "name": "payload", "type": "bytes"},
        {"internalType": "bytes", "name": "authenticator", "type": "bytes"}
      ],
      "name": "submitCommitment",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "components": [
            {"internalType": "uint256", "name": "requestID", "type": "uint256"},
            {"internalType": "bytes", "name": "payload", "type": "bytes"},
            {"internalType": "bytes", "name": "authenticator", "type": "bytes"}
          ],
          "internalType": "struct AggregatorBatches.CommitmentRequest[]",
          "name": "requests",
          "type": "tuple[]"
        }
      ],
      "name": "submitCommitments",
      "outputs": [
        {"internalType": "uint256", "name": "successCount", "type": "uint256"}
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "components": [
            {"internalType": "uint256", "name": "requestID", "type": "uint256"},
            {"internalType": "bytes", "name": "payload", "type": "bytes"},
            {"internalType": "bytes", "name": "authenticator", "type": "bytes"}
          ],
          "internalType": "struct AggregatorBatches.CommitmentRequest[]",
          "name": "requests",
          "type": "tuple[]"
        }
      ],
      "name": "submitAndCreateBatch",
      "outputs": [
        {"internalType": "uint256", "name": "batchNumber", "type": "uint256"},
        {"internalType": "uint256", "name": "successCount", "type": "uint256"}
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {"internalType": "uint256", "name": "batchNumber", "type": "uint256"},
        {"internalType": "bytes", "name": "hashroot", "type": "bytes"}
      ],
      "name": "submitHashroot",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    }
  ];
};