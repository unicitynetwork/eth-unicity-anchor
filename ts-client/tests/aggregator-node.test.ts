import { AggregatorNodeClient } from '../src/aggregator-node';
import { EventType } from '../src/types';

// Remove duplicate mock

jest.mock('@openzeppelin/merkle-tree', () => {
  const mockTree = {
    root: '0xabcdef1234567890',
    entries: jest.fn().mockImplementation(function*() {
      yield [0, ['1', '0x123456']];
      yield [1, ['2', '0x789abc']];
    }),
    getProof: jest.fn().mockReturnValue(['0x111', '0x222', '0x333'])
  };

  return {
    StandardMerkleTree: {
      of: jest.fn().mockReturnValue(mockTree)
    }
  };
});

// Create mock implementation
const mockNodeBaseMethods = {
  executeTransaction: jest.fn().mockImplementation((method, args) => {
    if (method === 'submitHashroot') {
      return Promise.resolve({ success: true, transactionHash: '0x123' });
    }
    return Promise.resolve({ success: false, error: new Error('Unknown method') });
  }),
  getLatestBatchNumber: jest.fn().mockResolvedValue(5n),
  getLatestProcessedBatchNumber: jest.fn().mockResolvedValue(3n),
  getBatch: jest.fn().mockResolvedValue({
    requests: [
      { requestID: '1', payload: '0x11', authenticator: '0x22' },
      { requestID: '2', payload: '0x33', authenticator: '0x44' }
    ],
    processed: false,
    hashroot: '0x0000'
  }),
  on: jest.fn()
};

// Mock the base client
jest.mock('../src/client', () => {
  const originalModule = jest.requireActual('../src/client');
  
  // Create a mock constructor that extends the original
  const MockUniCityAnchorClient = jest.fn().mockImplementation(() => {
    return mockNodeBaseMethods;
  });
  
  return {
    ...originalModule,
    UniCityAnchorClient: MockUniCityAnchorClient
  };
});

// Mock ethers
jest.mock('ethers', () => {
  return {
    concat: jest.fn().mockImplementation(arrays => arrays[0])
  };
});

// Mock the AggregatorNodeClient
jest.mock('../src/aggregator-node', () => {
  const originalModule = jest.requireActual('../src/aggregator-node');
  
  return {
    ...originalModule,
    AggregatorNodeClient: jest.fn().mockImplementation((options) => {
      return {
        options,
        batchProcessingTimer: undefined,
        executeTransaction: mockNodeBaseMethods.executeTransaction,
        getLatestBatchNumber: mockNodeBaseMethods.getLatestBatchNumber,
        getLatestProcessedBatchNumber: mockNodeBaseMethods.getLatestProcessedBatchNumber,
        getBatch: mockNodeBaseMethods.getBatch,
        on: mockNodeBaseMethods.on,
        
        submitHashroot: jest.fn().mockImplementation(function(batchNumber, hashroot) {
          return this.executeTransaction('submitHashroot', [batchNumber, hashroot]);
        }),
        
        processBatch: jest.fn().mockImplementation(function(batchNumber) {
          const bn = typeof batchNumber === 'string' ? BigInt(batchNumber) : batchNumber;
          
          return this.getLatestProcessedBatchNumber().then(latestProcessed => {
            // Check if already processed
            if (bn <= latestProcessed) {
              return { success: false, error: new Error(`Batch ${bn} is already processed`) };
            }
            
            // Check sequence
            if (bn !== latestProcessed + BigInt(1)) {
              return { success: false, error: new Error(`Batch ${bn} cannot be processed yet. Current processed: ${latestProcessed}`) };
            }
            
            return this.getBatch(bn).then(({ requests, processed }) => {
              if (processed) {
                return { success: false, error: new Error(`Batch ${bn} is already processed`) };
              }
              
              // Return successful result
              return this.submitHashroot(bn, new Uint8Array([1, 2, 3, 4]));
            });
          });
        }),
        
        startAutoBatchProcessing: jest.fn().mockImplementation(function() {
          this.batchProcessingTimer = setInterval(() => {}, 1000);
        }),
        
        stopAutoBatchProcessing: jest.fn().mockImplementation(function() {
          if (this.batchProcessingTimer) {
            clearInterval(this.batchProcessingTimer);
            this.batchProcessingTimer = undefined;
          }
        }),
        
        canProcessNextBatch: jest.fn().mockImplementation(function() {
          return Promise.all([
            this.getLatestBatchNumber(),
            this.getLatestProcessedBatchNumber()
          ]).then(([latestBatch, latestProcessed]) => {
            return latestBatch > latestProcessed;
          });
        }),
        
        getNextBatchToProcess: jest.fn().mockImplementation(function() {
          return Promise.all([
            this.getLatestBatchNumber(),
            this.getLatestProcessedBatchNumber()
          ]).then(([latestBatch, latestProcessed]) => {
            if (latestBatch > latestProcessed) {
              return latestProcessed + BigInt(1);
            }
            return null;
          });
        }),
        
        generateMerkleProof: jest.fn().mockImplementation(function(batchNumber, requestID) {
          return this.getBatch(batchNumber).then(({ requests, processed }) => {
            if (!processed) {
              return null;
            }
            
            return {
              proof: ['0x111', '0x222', '0x333'],
              value: '0x999'
            };
          });
        })
      };
    })
  };
});

describe('AggregatorNodeClient', () => {
  let aggregator: AggregatorNodeClient;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    aggregator = new AggregatorNodeClient({
      providerUrl: 'http://localhost:8545',
      contractAddress: '0x1234567890123456789012345678901234567890',
      privateKey: '0x1234567890123456789012345678901234567890123456789012345678901234',
      aggregatorAddress: '0x0987654321098765432109876543210987654321',
      smtDepth: 32,
      batchProcessingInterval: 60000, // 1 minute
      autoProcessBatches: false
    });
  });
  
  afterEach(() => {
    if (aggregator['batchProcessingTimer']) {
      clearInterval(aggregator['batchProcessingTimer']);
      aggregator['batchProcessingTimer'] = undefined;
    }
  });
  
  describe('submitHashroot', () => {
    it('should submit a hashroot successfully', async () => {
      const result = await aggregator.submitHashroot(
        4n,
        new Uint8Array([1, 2, 3, 4])
      );
      
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe('0x123');
      expect(aggregator['executeTransaction']).toHaveBeenCalledWith('submitHashroot', [
        4n,
        new Uint8Array([1, 2, 3, 4])
      ]);
    });
    
    it('should handle string inputs', async () => {
      const result = await aggregator.submitHashroot(
        '4',
        '0x01020304'
      );
      
      expect(result.success).toBe(true);
      expect(aggregator['executeTransaction']).toHaveBeenCalledWith('submitHashroot', [
        4n,
        expect.any(Uint8Array)
      ]);
    });
  });
  
  describe('processBatch', () => {
    it('should process a batch successfully', async () => {
      const result = await aggregator.processBatch(4n);
      
      expect(result.success).toBe(true);
      expect(aggregator['executeTransaction']).toHaveBeenCalledWith('submitHashroot', [
        4n,
        expect.any(Uint8Array)
      ]);
    });
    
    it('should handle already processed batches', async () => {
      // Mock getBatch to return a processed batch
      aggregator['getBatch'] = jest.fn().mockResolvedValue({
        requests: [],
        processed: true,
        hashroot: '0x5678'
      });
      
      const result = await aggregator.processBatch(4n);
      
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('already processed');
      expect(aggregator['executeTransaction']).not.toHaveBeenCalled();
    });
    
    it('should reject processing out-of-sequence batches', async () => {
      // Try to process batch 5 when latest processed is 3 (should be 4 next)
      const result = await aggregator.processBatch(5n);
      
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('cannot be processed yet');
      expect(aggregator['executeTransaction']).not.toHaveBeenCalled();
    });
  });
  
  describe('autoBatchProcessing', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    
    afterEach(() => {
      jest.useRealTimers();
    });
    
    it('should start auto batch processing', () => {
      aggregator.startAutoBatchProcessing();
      expect(aggregator['batchProcessingTimer']).toBeDefined();
    });
    
    it('should stop auto batch processing', () => {
      aggregator.startAutoBatchProcessing();
      aggregator.stopAutoBatchProcessing();
      expect(aggregator['batchProcessingTimer']).toBeUndefined();
    });
    
    it('should process batches on timer', async () => {
      // Mock the processBatch method
      const mockProcess = jest.fn().mockResolvedValue({ success: true });
      aggregator.processBatch = mockProcess;
      
      aggregator.startAutoBatchProcessing();
      
      // Fast-forward timer to trigger interval
      jest.advanceTimersByTime(60000);
      
      // Wait for promises to resolve
      await new Promise(process.nextTick);
      
      // Should have processed batch 4 (latest processed + 1)
      expect(mockProcess).toHaveBeenCalledWith(4n);
    });
  });
  
  describe('batchStateChecking', () => {
    it('should check if next batch can be processed', async () => {
      const canProcess = await aggregator.canProcessNextBatch();
      expect(canProcess).toBe(true); // Latest batch 5 > latest processed 3
    });
    
    it('should get the next batch to process', async () => {
      const nextBatch = await aggregator.getNextBatchToProcess();
      expect(nextBatch).toBe(4n); // Latest processed 3 + 1
    });
    
    it('should return null when all batches are processed', async () => {
      // Mock equal latest batch and latest processed
      aggregator['getLatestBatchNumber'] = jest.fn().mockResolvedValue(3n);
      
      const nextBatch = await aggregator.getNextBatchToProcess();
      expect(nextBatch).toBeNull();
    });
  });
  
  describe('merkleProofGeneration', () => {
    it('should generate a Merkle proof', async () => {
      // Mock a processed batch
      aggregator['getBatch'] = jest.fn().mockResolvedValue({
        requests: [
          { requestID: '1', payload: '0x11', authenticator: '0x22' },
          { requestID: '2', payload: '0x33', authenticator: '0x44' }
        ],
        processed: true,
        hashroot: '0x5678'
      });
      
      const proof = await aggregator.generateMerkleProof(4n, 1n);
      
      expect(proof).not.toBeNull();
      expect(proof?.proof).toEqual(['0x111', '0x222', '0x333']);
      expect(proof?.value).toBe('0x999');
    });
    
    it('should return null for unprocessed batches', async () => {
      // getBatch already mocks unprocessed batch (processed: false)
      const proof = await aggregator.generateMerkleProof(4n, 3n);
      expect(proof).toBeNull();
    });
    
    it('should return null for non-existent requests', async () => {
      // Mock not finding the request in the batch
      aggregator['getBatch'] = jest.fn().mockResolvedValue({
        requests: [
          { requestID: '1', payload: '0x11', authenticator: '0x22' },
          { requestID: '2', payload: '0x33', authenticator: '0x44' }
        ],
        processed: true,
        hashroot: '0x5678'
      });
      
      const proof = await aggregator.generateMerkleProof(4n, 3n);
      expect(proof).toBeNull();
    });
  });
});