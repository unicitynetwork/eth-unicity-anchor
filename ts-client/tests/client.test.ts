import { UniCityAnchorClient } from '../src/client';
import { ethers } from 'ethers';
import { EventType } from '../src/types';

// Create mock implementations first
const mockContractMethods = {
  getLatestBatchNumber: jest.fn().mockResolvedValue(5n),
  getLatestProcessedBatchNumber: jest.fn().mockResolvedValue(3n),
  getCommitment: jest.fn().mockResolvedValue({
    requestID: 123n,
    payload: '0x123456',
    authenticator: '0x789abc'
  }),
  getBatch: jest.fn().mockResolvedValue([
    [
      { requestID: 1n, payload: '0x11', authenticator: '0x22' },
      { requestID: 2n, payload: '0x33', authenticator: '0x44' }
    ],
    true,
    '0x5678'
  ]),
  getLatestUnprocessedBatch: jest.fn().mockResolvedValue([
    4n,
    [
      { requestID: 3n, payload: '0x55', authenticator: '0x66' },
      { requestID: 4n, payload: '0x77', authenticator: '0x88' }
    ]
  ]),
  getBatchHashroot: jest.fn().mockResolvedValue('0x9876'),
  getUnprocessedRequestCount: jest.fn().mockResolvedValue(2n),
  getAllUnprocessedRequests: jest.fn().mockResolvedValue([5n, 6n]),
  isRequestUnprocessed: jest.fn().mockResolvedValue(true),
  getHashrootVoteCount: jest.fn().mockResolvedValue(2n),
  on: jest.fn()
};

const mockProvider = {
  getNetwork: jest.fn().mockResolvedValue({ chainId: 1n }),
  getCode: jest.fn().mockResolvedValue('0x1234')
};

// Create a fake ethers module
const mockEthersModule = {
  JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
  Contract: jest.fn().mockImplementation(() => ({
    ...mockContractMethods,
    connect: () => mockContractMethods
  })),
  Wallet: jest.fn().mockImplementation(() => ({
    address: '0x1234567890123456789012345678901234567890'
  })),
  getBytes: jest.fn().mockImplementation(data => {
    if (typeof data === 'string' && data.startsWith('0x')) {
      const hex = data.slice(2);
      return new Uint8Array(hex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
    }
    return new Uint8Array();
  }),
  hexlify: jest.fn().mockImplementation(bytes => {
    if (bytes instanceof Uint8Array) {
      return '0x' + Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
    return bytes;
  }),
  concat: jest.fn().mockImplementation(arrays => arrays[0]),
  keccak256: jest.fn().mockImplementation(data => {
    return '0x' + '1'.repeat(64); // Return a fake hash
  })
};

// Mock ethers
jest.mock('ethers', () => mockEthersModule, { virtual: true });

describe('UniCityAnchorClient', () => {
  let client: UniCityAnchorClient;
  
  beforeEach(() => {
    client = new UniCityAnchorClient({
      providerUrl: 'http://localhost:8545',
      contractAddress: '0x1234567890123456789012345678901234567890',
      privateKey: '0x1234567890123456789012345678901234567890123456789012345678901234'
    });
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  describe('initialization', () => {
    it('should initialize with provided options', () => {
      expect(ethers.JsonRpcProvider).toHaveBeenCalledWith('http://localhost:8545');
      expect(ethers.Contract).toHaveBeenCalledWith(
        '0x1234567890123456789012345678901234567890',
        expect.any(Array),
        expect.any(Object)
      );
    });
    
    it('should initialize without private key', () => {
      const readOnlyClient = new UniCityAnchorClient({
        providerUrl: 'http://localhost:8545',
        contractAddress: '0x1234567890123456789012345678901234567890'
      });
      
      expect(ethers.Wallet).not.toHaveBeenCalled();
    });
  });
  
  describe('view methods', () => {
    it('should get chain ID', async () => {
      const chainId = await client.getChainId();
      expect(chainId).toBe(1);
    });
    
    it('should check if contract is available', async () => {
      const available = await client.isContractAvailable();
      expect(available).toBe(true);
    });
    
    it('should get commitment by ID', async () => {
      const commitment = await client.getCommitment(123n);
      expect(commitment.requestID).toBe('123');
      expect(commitment.payload).toBe('0x123456');
      expect(commitment.authenticator).toBe('0x789abc');
    });
    
    it('should get latest batch number', async () => {
      const batchNumber = await client.getLatestBatchNumber();
      expect(batchNumber).toBe(5n);
    });
    
    it('should get latest processed batch number', async () => {
      const batchNumber = await client.getLatestProcessedBatchNumber();
      expect(batchNumber).toBe(3n);
    });
    
    it('should get latest unprocessed batch', async () => {
      const [batchNumber, requests] = await client.getLatestUnprocessedBatch();
      expect(batchNumber).toBe(4n);
      expect(requests.length).toBe(2);
      expect(requests[0].requestID).toBe('3');
      expect(requests[1].requestID).toBe('4');
    });
    
    it('should get batch by number', async () => {
      const batch = await client.getBatch(2n);
      expect(batch.requests.length).toBe(2);
      expect(batch.processed).toBe(true);
      expect(batch.hashroot).toBe('0x5678');
    });
    
    it('should get batch hashroot', async () => {
      const hashroot = await client.getBatchHashroot(2n);
      expect(hashroot).toBe('0x9876');
    });
    
    it('should get unprocessed request count', async () => {
      const count = await client.getUnprocessedRequestCount();
      expect(count).toBe(2n);
    });
    
    it('should get all unprocessed requests', async () => {
      const requests = await client.getAllUnprocessedRequests();
      expect(requests).toEqual([5n, 6n]);
    });
    
    it('should check if request is unprocessed', async () => {
      const isUnprocessed = await client.isRequestUnprocessed(5n);
      expect(isUnprocessed).toBe(true);
    });
    
    it('should get hashroot vote count', async () => {
      const votes = await client.getHashrootVoteCount(2n, '0x1234');
      expect(votes).toBe(2n);
    });
  });
  
  describe('events', () => {
    it('should register and emit events', () => {
      const mockCallback = jest.fn();
      client.on(EventType.BatchCreated, mockCallback);
      
      // Get the event handler from the Contract mock
      const eventHandler = (ethers.Contract as jest.Mock).mock.results[0].value.on.mock.calls[1][1];
      
      // Simulate an event
      eventHandler(1n, 10n);
      
      // Check that our callback was called
      expect(mockCallback).toHaveBeenCalledWith(EventType.BatchCreated, { batchNumber: 1n, requestCount: 10n });
    });
  });
});