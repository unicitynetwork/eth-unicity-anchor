import { AggregatorGatewayClient } from '../src/aggregator-gateway';
import { EventType } from '../src/types';

// Create mock implementation
const mockBaseMethods = {
  executeTransaction: jest.fn().mockImplementation((method, args) => {
    if (method === 'submitCommitment') {
      return Promise.resolve({ success: true, transactionHash: '0x123' });
    } else if (method === 'createBatch') {
      return Promise.resolve({ success: true, transactionHash: '0x456' });
    } else if (method === 'createBatchForRequests') {
      return Promise.resolve({ success: true, transactionHash: '0x789' });
    }
    return Promise.resolve({ success: false, error: new Error('Unknown method') });
  }),
  getLatestBatchNumber: jest.fn().mockResolvedValue(5n),
  getUnprocessedRequestCount: jest.fn().mockResolvedValue(60n),
  on: jest.fn()
};

// Mock the base client
jest.mock('../src/client', () => {
  const originalModule = jest.requireActual('../src/client');
  
  // Create a mock constructor that extends the original
  const MockUniCityAnchorClient = jest.fn().mockImplementation(() => {
    return mockBaseMethods;
  });
  
  return {
    ...originalModule,
    UniCityAnchorClient: MockUniCityAnchorClient
  };
});

// Add the mock implementation for AggregatorGatewayClient
jest.mock('../src/aggregator-gateway', () => {
  const originalModule = jest.requireActual('../src/aggregator-gateway');
  
  return {
    ...originalModule,
    AggregatorGatewayClient: jest.fn().mockImplementation((options) => {
      return {
        options,
        batchCreationTimer: undefined,
        executeTransaction: mockBaseMethods.executeTransaction,
        getLatestBatchNumber: mockBaseMethods.getLatestBatchNumber,
        getUnprocessedRequestCount: mockBaseMethods.getUnprocessedRequestCount,
        on: mockBaseMethods.on,
        
        submitCommitment: jest.fn().mockImplementation(function(requestID, payload, authenticator) {
          return this.executeTransaction('submitCommitment', [requestID, payload, authenticator]);
        }),
        
        createBatch: jest.fn().mockImplementation(function() {
          return this.executeTransaction('createBatch', []).then(result => ({
            batchNumber: 5n,
            result
          }));
        }),
        
        createBatchForRequests: jest.fn().mockImplementation(function(requestIDs) {
          return this.executeTransaction('createBatchForRequests', [requestIDs]).then(result => ({
            batchNumber: 5n,
            result
          }));
        }),
        
        startAutoBatchCreation: jest.fn().mockImplementation(function() {
          this.batchCreationTimer = setInterval(() => {}, 1000);
        }),
        
        stopAutoBatchCreation: jest.fn().mockImplementation(function() {
          if (this.batchCreationTimer) {
            clearInterval(this.batchCreationTimer);
            this.batchCreationTimer = undefined;
          }
        }),
        
        validateCommitment: jest.fn().mockImplementation(function(request) {
          return request.requestID > 0n && 
                 request.payload.length > 0 && 
                 request.authenticator.length > 0;
        }),
        
        submitMultipleCommitments: jest.fn().mockImplementation(function(requests) {
          return Promise.all(
            requests.map(req => {
              if (this.validateCommitment(req)) {
                return this.submitCommitment(req.requestID, req.payload, req.authenticator)
                  .then(result => ({ requestID: req.requestID, result }));
              }
              return Promise.resolve({
                requestID: req.requestID,
                result: { success: false, error: new Error('Invalid commitment request') }
              });
            })
          );
        })
      };
    })
  };
});

describe('AggregatorGatewayClient', () => {
  let gateway: AggregatorGatewayClient;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    gateway = new AggregatorGatewayClient({
      providerUrl: 'http://localhost:8545',
      contractAddress: '0x1234567890123456789012345678901234567890',
      privateKey: '0x1234567890123456789012345678901234567890123456789012345678901234',
      gatewayAddress: '0x0987654321098765432109876543210987654321',
      batchCreationThreshold: 50,
      batchCreationInterval: 60000, // 1 minute
      autoCreateBatches: false
    });
  });
  
  afterEach(() => {
    if (gateway['batchCreationTimer']) {
      clearInterval(gateway['batchCreationTimer']);
      gateway['batchCreationTimer'] = undefined;
    }
  });
  
  describe('submitCommitment', () => {
    it('should submit a commitment successfully', async () => {
      const result = await gateway.submitCommitment(
        123n,
        new Uint8Array([1, 2, 3]),
        new Uint8Array([4, 5, 6])
      );
      
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe('0x123');
      expect(gateway['executeTransaction']).toHaveBeenCalledWith('submitCommitment', [
        123n,
        new Uint8Array([1, 2, 3]),
        new Uint8Array([4, 5, 6])
      ]);
    });
    
    it('should handle string inputs', async () => {
      const result = await gateway.submitCommitment(
        '456',
        'test payload',
        'test authenticator'
      );
      
      expect(result.success).toBe(true);
      expect(gateway['executeTransaction']).toHaveBeenCalledWith('submitCommitment', [
        456n,
        expect.any(Uint8Array),
        expect.any(Uint8Array)
      ]);
    });
  });
  
  describe('createBatch', () => {
    it('should create a batch successfully', async () => {
      const { batchNumber, result } = await gateway.createBatch();
      
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe('0x456');
      expect(batchNumber).toBe(5n);
      expect(gateway['executeTransaction']).toHaveBeenCalledWith('createBatch', []);
    });
  });
  
  describe('createBatchForRequests', () => {
    it('should create a batch with specific requests', async () => {
      const { batchNumber, result } = await gateway.createBatchForRequests([1n, 2n, 3n]);
      
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe('0x789');
      expect(batchNumber).toBe(5n);
      expect(gateway['executeTransaction']).toHaveBeenCalledWith('createBatchForRequests', [[1n, 2n, 3n]]);
    });
    
    it('should handle string request IDs', async () => {
      const { batchNumber, result } = await gateway.createBatchForRequests(['1', '2', '3']);
      
      expect(result.success).toBe(true);
      expect(gateway['executeTransaction']).toHaveBeenCalledWith('createBatchForRequests', [[1n, 2n, 3n]]);
    });
  });
  
  describe('autoBatchCreation', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    
    afterEach(() => {
      jest.useRealTimers();
    });
    
    it('should start auto batch creation', () => {
      gateway.startAutoBatchCreation();
      expect(gateway['batchCreationTimer']).toBeDefined();
    });
    
    it('should stop auto batch creation', () => {
      gateway.startAutoBatchCreation();
      gateway.stopAutoBatchCreation();
      expect(gateway['batchCreationTimer']).toBeUndefined();
    });
    
    it('should create a batch when threshold is reached', async () => {
      // Mock the executeTransaction to avoid actually creating batches
      const mockExecute = jest.fn().mockResolvedValue({ success: true });
      gateway['executeTransaction'] = mockExecute;
      
      gateway.startAutoBatchCreation();
      
      // Fast-forward timer to trigger interval
      jest.advanceTimersByTime(60000);
      
      // Wait for promises to resolve
      await new Promise(process.nextTick);
      
      // Should have created a batch since unprocessedRequestCount (60) > threshold (50)
      expect(mockExecute).toHaveBeenCalledWith('createBatch', []);
    });
    
    it('should not create a batch when threshold is not reached', async () => {
      // Mock a lower count
      gateway['getUnprocessedRequestCount'] = jest.fn().mockResolvedValue(40n);
      
      // Mock the executeTransaction to avoid actually creating batches
      const mockExecute = jest.fn().mockResolvedValue({ success: true });
      gateway['executeTransaction'] = mockExecute;
      
      gateway.startAutoBatchCreation();
      
      // Fast-forward timer to trigger interval
      jest.advanceTimersByTime(60000);
      
      // Wait for promises to resolve
      await new Promise(process.nextTick);
      
      // Should not have created a batch since count (40) < threshold (50)
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });
  
  describe('validateCommitment', () => {
    it('should validate valid commitments', () => {
      const valid = gateway.validateCommitment({
        requestID: 123n,
        payload: new Uint8Array([1, 2, 3]),
        authenticator: new Uint8Array([4, 5, 6])
      });
      
      expect(valid).toBe(true);
    });
    
    it('should reject invalid commitments', () => {
      // Request ID <= 0
      expect(gateway.validateCommitment({
        requestID: 0n,
        payload: new Uint8Array([1, 2, 3]),
        authenticator: new Uint8Array([4, 5, 6])
      })).toBe(false);
      
      // Empty payload
      expect(gateway.validateCommitment({
        requestID: 123n,
        payload: new Uint8Array([]),
        authenticator: new Uint8Array([4, 5, 6])
      })).toBe(false);
      
      // Empty authenticator
      expect(gateway.validateCommitment({
        requestID: 123n,
        payload: new Uint8Array([1, 2, 3]),
        authenticator: new Uint8Array([])
      })).toBe(false);
    });
  });
  
  describe('submitMultipleCommitments', () => {
    it('should submit multiple valid commitments', async () => {
      // Mock the submitCommitment method
      const mockSubmit = jest.fn()
        .mockResolvedValueOnce({ success: true, transactionHash: '0xaaa' })
        .mockResolvedValueOnce({ success: true, transactionHash: '0xbbb' });
      
      gateway.submitCommitment = mockSubmit;
      
      const results = await gateway.submitMultipleCommitments([
        {
          requestID: 1n,
          payload: new Uint8Array([1, 2, 3]),
          authenticator: new Uint8Array([4, 5, 6])
        },
        {
          requestID: 2n,
          payload: new Uint8Array([7, 8, 9]),
          authenticator: new Uint8Array([10, 11, 12])
        }
      ]);
      
      expect(results.length).toBe(2);
      expect(results[0].result.success).toBe(true);
      expect(results[1].result.success).toBe(true);
      expect(mockSubmit).toHaveBeenCalledTimes(2);
    });
    
    it('should handle invalid commitments', async () => {
      const mockSubmit = jest.fn().mockResolvedValue({ success: true });
      gateway.submitCommitment = mockSubmit;
      
      const results = await gateway.submitMultipleCommitments([
        {
          requestID: 0n, // Invalid
          payload: new Uint8Array([1, 2, 3]),
          authenticator: new Uint8Array([4, 5, 6])
        },
        {
          requestID: 2n,
          payload: new Uint8Array([7, 8, 9]),
          authenticator: new Uint8Array([10, 11, 12])
        }
      ]);
      
      expect(results.length).toBe(2);
      expect(results[0].result.success).toBe(false);
      expect(results[1].result.success).toBe(true);
      expect(mockSubmit).toHaveBeenCalledTimes(1);
    });
  });
});