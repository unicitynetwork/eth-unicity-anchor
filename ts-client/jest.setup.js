/**
 * Global Jest setup file
 * 
 * This file contains global setup logic that runs before all tests.
 * It's referenced in jest.config.js via setupFilesAfterEnv.
 */

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