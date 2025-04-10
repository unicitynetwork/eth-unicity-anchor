/**
 * Mock implementation for ethers.js
 * 
 * This provides mock implementations for ethers classes and functions to avoid
 * network connection attempts during tests.
 */
import { jest } from '@jest/globals';

// Create a mock provider that doesn't try to connect to anything
class MockProvider {
  getNetwork() {
    return Promise.resolve({ chainId: 1 });
  }
  
  getTransaction() {
    return Promise.resolve({});
  }
  
  getTransactionReceipt(hash?: string) {
    // In ethers.js, this method returns null for non-existent transactions
    if (hash === '0xnonexistent') {
      return Promise.resolve(null);
    }
    
    return Promise.resolve({
      hash: '0xmocktx',
      blockNumber: 12345,
      gasUsed: BigInt(100000),
      logs: [],
      status: 1, // Success
      confirmations: 10,
      blockHash: '0xmockblockhash',
      to: '0xmockaddress',
      from: '0xmocksender',
      transactionIndex: 1
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

// Mock Wallet
class MockWallet {
  address = '0xMockWalletAddress';
  
  constructor() {}
  
  connect() {
    return this;
  }
  
  signMessage() {
    return Promise.resolve('0xMockSignature');
  }
}

// Mock Contract
class MockContract {
  connect() {
    return this;
  }
  
  on() {}
  
  submitCommitment() {
    return Promise.resolve({ 
      wait: () => Promise.resolve({
        hash: '0xMockTx',
        blockNumber: 12345,
        gasUsed: BigInt(100000)
      })
    });
  }
  
  submitCommitments() {
    return Promise.resolve({ 
      wait: () => Promise.resolve({
        hash: '0xMockBatchTx',
        blockNumber: 12345,
        gasUsed: BigInt(200000),
        logs: [
          {
            topics: ['0xMockTopic'],
            args: { successCount: BigInt(3) }
          }
        ]
      })
    });
  }
  
  submitAndCreateBatch() {
    return Promise.resolve({ 
      wait: () => Promise.resolve({
        hash: '0xMockBatchAndCreateTx',
        blockNumber: 12345,
        gasUsed: BigInt(300000),
        logs: [
          {
            topics: ['0xMockTopic1'],
            args: { successCount: BigInt(3) }
          },
          {
            topics: ['0xMockTopic2'],
            args: { batchNumber: BigInt(1) }
          }
        ]
      })
    });
  }
  
  createBatch() {
    return Promise.resolve({ 
      wait: () => Promise.resolve({
        hash: '0xMockCreateBatchTx',
        blockNumber: 12345,
        gasUsed: BigInt(150000)
      })
    });
  }
  
  getLatestBatchNumber() {
    return Promise.resolve(BigInt(1));
  }
  
  getUnprocessedRequestCount() {
    return Promise.resolve(BigInt(0));
  }
  
  estimateGas = {
    submitCommitment: () => Promise.resolve(BigInt(100000)),
    submitCommitments: () => Promise.resolve(BigInt(200000)),
    submitAndCreateBatch: () => Promise.resolve(BigInt(300000)),
    createBatch: () => Promise.resolve(BigInt(150000))
  };
}

// Mock ethers module exports
export const ethers = {
  Contract: jest.fn(() => new MockContract()),
  JsonRpcProvider: jest.fn(() => new MockJsonRpcProvider()),
  WebSocketProvider: jest.fn(() => new MockJsonRpcProvider()),
  Wallet: jest.fn(() => new MockWallet()),
  
  // Utility functions
  toUtf8Bytes: (text: string) => new TextEncoder().encode(text),
  hexlify: (bytes: Uint8Array) => '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''),
  
  // Add missing functions used in utils.ts
  getBytes: (hexString: string) => {
    // Simple implementation to convert hex to bytes
    const hex = hexString.startsWith('0x') ? hexString.slice(2) : hexString;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  },
  
  keccak256: (data: Uint8Array | string) => {
    // Mock implementation that returns a predictable hash
    // In a real implementation, this would compute the keccak256 hash
    return '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  },
  
  Interface: jest.fn(() => ({
    parseLog: () => ({ name: 'MockEvent', args: { successCount: BigInt(3) } })
  }))
};

// Export default for ES modules
export default ethers;