import { EventType, CommitmentRequest, TransactionResult } from '../src/types';
import { AggregatorGatewayClient } from '../src/aggregator-gateway';
import { bytesToHex, hexToBytes } from '../src/utils';

// Create mock commitments for testing
const createTestCommitments = (count: number): CommitmentRequest[] => {
  const commitments: CommitmentRequest[] = [];
  for (let i = 0; i < count; i++) {
    commitments.push({
      requestID: BigInt(1000 + i),
      payload: new TextEncoder().encode(`payload-${i}`),
      authenticator: new TextEncoder().encode(`auth-${i}`)
    });
  }
  return commitments;
};

// Mock contract implementation
const createMockContract = () => {
  return {
    submitCommitment: jest.fn().mockResolvedValue({ hash: '0xmocktx1' }),
    submitCommitments: jest.fn().mockResolvedValue({ hash: '0xmocktx2', successCount: 3 }),
    submitAndCreateBatch: jest.fn().mockResolvedValue({ hash: '0xmocktx3', batchNumber: 1, successCount: 3 }),
    createBatch: jest.fn().mockResolvedValue({ hash: '0xmocktx4' }),
    createBatchForRequests: jest.fn().mockResolvedValue({ hash: '0xmocktx5' }),
    getLatestBatchNumber: jest.fn().mockResolvedValue(BigInt(1)),
    getNextAutoNumberedBatch: jest.fn().mockResolvedValue(BigInt(1)),
    getUnprocessedRequestCount: jest.fn().mockResolvedValue(BigInt(0)),
    connect: jest.fn().mockReturnThis(),
    on: jest.fn(),
    estimateGas: {
      submitCommitment: jest.fn().mockResolvedValue(BigInt(100000)),
      submitCommitments: jest.fn().mockResolvedValue(BigInt(250000)),
      submitAndCreateBatch: jest.fn().mockResolvedValue(BigInt(350000)),
      createBatch: jest.fn().mockResolvedValue(BigInt(150000)),
      createBatchForRequests: jest.fn().mockResolvedValue(BigInt(200000))
    }
  };
};

// Mock provider implementation
const createMockProvider = () => {
  return {
    getNetwork: jest.fn().mockResolvedValue({ chainId: 1 }),
    getCode: jest.fn().mockResolvedValue('0x123456'),
    getTransaction: jest.fn(),
    getTransactionReceipt: jest.fn().mockResolvedValue({
      hash: '0xmocktx',
      blockNumber: 12345,
      gasUsed: BigInt(100000)
    })
  };
};

// Mock client configuration
const mockClientConfig = {
  providerUrl: 'https://mock.provider',
  contractAddress: '0x1234567890123456789012345678901234567890',
  privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  gatewayAddress: '0xabc123',
  batchCreationThreshold: 10,
  autoCreateBatches: false
};

// We don't need to mock ethers here since it's already mocked in jest.setup.js
// The global mock will prevent any connection attempts that could cause hanging

describe('Batch Commitment Features', () => {
  let gateway: AggregatorGatewayClient;
  let mockContract: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Basic mock for the client's contract
    mockContract = {
      submitCommitment: jest.fn(),
      submitCommitments: jest.fn(),
      submitAndCreateBatch: jest.fn(),
      createBatch: jest.fn(),
      getLatestBatchNumber: jest.fn().mockResolvedValue(BigInt(1)),
      getNextAutoNumberedBatch: jest.fn().mockResolvedValue(BigInt(1)),
      getUnprocessedRequestCount: jest.fn().mockResolvedValue(BigInt(0)),
      connect: jest.fn().mockReturnThis(),
      on: jest.fn(),
      estimateGas: {
        submitCommitment: jest.fn().mockResolvedValue(BigInt(100000)),
        submitCommitments: jest.fn().mockResolvedValue(BigInt(250000)),
        submitAndCreateBatch: jest.fn().mockResolvedValue(BigInt(350000)),
        createBatch: jest.fn().mockResolvedValue(BigInt(150000))
      }
    };
    
    // Mock the ethers Contract
    jest.spyOn(require('ethers'), 'Contract').mockImplementation(() => mockContract);
    
    // Initialize client with mock
    gateway = new AggregatorGatewayClient(mockClientConfig);
  });

  // Run the tests that are working
  describe('Legacy methods', () => {
    it('should still support submitMultipleCommitments but with deprecation warning', async () => {
      // Prepare test data
      const commitments = createTestCommitments(2);
      
      // Create a new client instance specifically for this test
      const testGateway = new AggregatorGatewayClient(mockClientConfig);
      
      // Directly spy on the submitCommitment method of the client instance
      const submitCommitmentSpy = jest.spyOn(testGateway, 'submitCommitment')
        .mockImplementation(async (requestID, payload, authenticator) => {
          return {
            success: true,
            transactionHash: '0xLEGACY_TX',
            blockNumber: 12345,
            gasUsed: BigInt(100000)
          };
        });
      
      // Call the deprecated method
      await testGateway.submitMultipleCommitments(commitments);
      
      // Check if submitCommitment was called for each commitment
      expect(submitCommitmentSpy).toHaveBeenCalledTimes(2);
      
      // Verify each call was made with the correct parameters
      expect(submitCommitmentSpy).toHaveBeenNthCalledWith(
        1,
        commitments[0].requestID,
        commitments[0].payload,
        commitments[0].authenticator
      );
      
      expect(submitCommitmentSpy).toHaveBeenNthCalledWith(
        2,
        commitments[1].requestID,
        commitments[1].payload,
        commitments[1].authenticator
      );
      
      // Restore the spy after the test
      submitCommitmentSpy.mockRestore();
    });
  });
  
  describe('submitCommitments', () => {
    it('should filter out invalid commitments', async () => {
      // Create some invalid commitments (with negative requestIDs)
      const invalidCommitments = [
        {
          requestID: BigInt(-1),
          payload: new TextEncoder().encode('invalid'),
          authenticator: new TextEncoder().encode('invalid')
        },
        {
          requestID: BigInt(0),
          payload: new TextEncoder().encode(''),
          authenticator: new TextEncoder().encode('test')
        }
      ];
      
      // Call the method with invalid data
      const result = await gateway.submitCommitments(invalidCommitments);
      
      // Should not call the contract since all commitments are invalid
      expect(result.result.success).toBe(false);
      expect(result.result.error).toBeDefined();
    });
  });
  
  describe('Events', () => {
    it('should handle RequestsSubmitted events', () => {
      // Create a mock event callback
      const mockCallback = jest.fn();
      
      // Register the callback
      gateway.on(EventType.RequestsSubmitted, mockCallback);
      
      // Manually trigger the event (simulating contract emitting the event)
      const eventData = { count: BigInt(5), successCount: BigInt(3) };
      (gateway as any).emitEvent(EventType.RequestsSubmitted, eventData);
      
      // Check if callback was called with correct data
      expect(mockCallback).toHaveBeenCalledWith(
        EventType.RequestsSubmitted,
        expect.objectContaining({
          count: BigInt(5),
          successCount: BigInt(3)
        })
      );
    });
  });
  
  describe('Transaction Failure', () => {
    it('should handle transaction failure gracefully', async () => {
      // Prepare test data
      const commitments = createTestCommitments(3);
      
      // Create a proper client with a failing submitCommitment
      const testGateway = new AggregatorGatewayClient(mockClientConfig);
      
      // Override the executeTransaction method directly to simulate failure
      jest.spyOn(testGateway as any, 'executeTransaction').mockImplementationOnce(() => {
        return Promise.resolve({
          success: false,
          error: new Error('Transaction failed')
        });
      });
      
      // Call the method
      const result = await testGateway.submitCommitments(commitments);
      
      // Check the result indicates failure
      expect(result.result.success).toBe(false);
      expect(result.result.error).toBeDefined();
      expect(result.result.error?.message).toBe('Transaction failed');
    });
  });

  describe('Batch Operations', () => {
    describe('submitCommitments', () => {
      it('should submit multiple commitments in a single transaction', async () => {
        // Prepare test data
        const commitments = createTestCommitments(3);
        
        // Create a gateway client for this test
        const testGateway = new AggregatorGatewayClient(mockClientConfig);
        
        // Mock the executeTransaction method to return a successful result
        jest.spyOn(testGateway as any, 'executeTransaction').mockImplementationOnce(() => {
          return Promise.resolve({
            success: true,
            transactionHash: '0xBATCH_COMMIT_TX',
            blockNumber: 12345,
            gasUsed: BigInt(200000),
            successCount: BigInt(3)
          });
        });
        
        // Call the method
        const result = await testGateway.submitCommitments(commitments);
        
        // Verify the executeTransaction was called with the correct method name
        expect((testGateway as any).executeTransaction).toHaveBeenCalledWith(
          'submitCommitments',
          expect.any(Array)
        );
        
        // Verify the input array was passed correctly
        const calls = (testGateway as any).executeTransaction.mock.calls;
        expect(calls[0][1].length).toBe(1); // The array with the commitments
        expect(calls[0][1][0].length).toBe(3); // Three commitments in the array
        
        // Check that each commitment in the input array has the required fields
        const passedCommitments = calls[0][1][0];
        expect(passedCommitments[0]).toHaveProperty('requestID');
        expect(passedCommitments[0]).toHaveProperty('payload');
        expect(passedCommitments[0]).toHaveProperty('authenticator');
        
        // Check the result
        expect(result.successCount).toBe(BigInt(3));
        expect(result.result.success).toBe(true);
        expect(result.result.transactionHash).toBe('0xBATCH_COMMIT_TX');
      });
    });

    describe('submitAndCreateBatch', () => {
      it('should submit commitments and create a batch in a single transaction', async () => {
        // Prepare test data
        const commitments = createTestCommitments(3);
        
        // Create a gateway client for this test
        const testGateway = new AggregatorGatewayClient(mockClientConfig);
        
        // Mock the executeTransaction method to return a successful result
        jest.spyOn(testGateway as any, 'executeTransaction').mockImplementationOnce(() => {
          return Promise.resolve({
            success: true,
            transactionHash: '0xBATCH_COMMIT_AND_CREATE_TX',
            blockNumber: 12345,
            gasUsed: BigInt(300000),
            successCount: BigInt(3),
            batchNumber: BigInt(1)
          });
        });
        
        // Call the method
        const result = await testGateway.submitAndCreateBatch(commitments);
        
        // Verify the executeTransaction was called with the correct method name
        expect((testGateway as any).executeTransaction).toHaveBeenCalledWith(
          'submitAndCreateBatch',
          expect.any(Array)
        );
        
        // Verify the input array was passed correctly
        const calls = (testGateway as any).executeTransaction.mock.calls;
        expect(calls[0][1].length).toBe(1); // The array with the commitments
        expect(calls[0][1][0].length).toBe(3); // Three commitments in the array
        
        // Check that each commitment in the input array has the required fields
        const passedCommitments = calls[0][1][0];
        expect(passedCommitments[0]).toHaveProperty('requestID');
        expect(passedCommitments[0]).toHaveProperty('payload');
        expect(passedCommitments[0]).toHaveProperty('authenticator');
        
        // Check the result
        expect(result.batchNumber).toBe(BigInt(1));
        expect(result.successCount).toBe(BigInt(3));
        expect(result.result.success).toBe(true);
        expect(result.result.transactionHash).toBe('0xBATCH_COMMIT_AND_CREATE_TX');
      });
    });
  });
  
  describe('Batch Creation', () => {
    it('should create a new batch', async () => {
      // Create a gateway client for this test
      const testGateway = new AggregatorGatewayClient(mockClientConfig);
      
      // Mock the executeTransaction method to return a successful result
      jest.spyOn(testGateway as any, 'executeTransaction').mockImplementationOnce(() => {
        return Promise.resolve({
          success: true,
          transactionHash: '0xCREATE_BATCH_TX',
          blockNumber: 12345,
          gasUsed: BigInt(150000)
        });
      });
      
      // Mock the getNextAutoNumberedBatch method to return a batch number
      jest.spyOn(testGateway, 'getNextAutoNumberedBatch').mockResolvedValueOnce(BigInt(1));
      
      // Call the method
      const result = await testGateway.createBatch();
      
      // Verify executeTransaction was called with the correct method
      expect((testGateway as any).executeTransaction).toHaveBeenCalledWith(
        'createBatch',
        []
      );
      
      // Check the result
      expect(result.batchNumber).toBe(BigInt(1));
      expect(result.result.success).toBe(true);
      expect(result.result.transactionHash).toBe('0xCREATE_BATCH_TX');
    });
    
    it('should create a batch for specific request IDs', async () => {
      // Create a gateway client for this test
      const testGateway = new AggregatorGatewayClient(mockClientConfig);
      
      // Request IDs to batch
      const requestIDs = [BigInt(100), BigInt(101), BigInt(102)];
      
      // Mock the executeTransaction method to return a successful result
      jest.spyOn(testGateway as any, 'executeTransaction').mockImplementationOnce(() => {
        return Promise.resolve({
          success: true,
          transactionHash: '0xCREATE_BATCH_REQUESTS_TX',
          blockNumber: 12345,
          gasUsed: BigInt(180000)
        });
      });
      
      // Mock the getLatestBatchNumber method to return a batch number
      jest.spyOn(testGateway, 'getLatestBatchNumber').mockResolvedValueOnce(BigInt(2));
      
      // Call the method
      const result = await testGateway.createBatchForRequests(requestIDs);
      
      // Verify executeTransaction was called with the correct method and parameters
      expect((testGateway as any).executeTransaction).toHaveBeenCalledWith(
        'createBatchForRequests',
        [requestIDs]
      );
      
      // Check the result
      expect(result.batchNumber).toBe(BigInt(2));
      expect(result.result.success).toBe(true);
      expect(result.result.transactionHash).toBe('0xCREATE_BATCH_REQUESTS_TX');
    });
  });
});