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

// Setup jest mocks
jest.mock('ethers', () => {
  const originalModule = jest.requireActual('ethers');
  return {
    ...originalModule,
    Contract: jest.fn(() => createMockContract()),
    JsonRpcProvider: jest.fn(() => createMockProvider()),
    Wallet: jest.fn(() => ({ 
      address: '0xWALLET',
      connect: jest.fn()
    }))
  };
});

describe('Batch Commitment Features', () => {
  let gateway: AggregatorGatewayClient;
  let mockContract: any;

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new AggregatorGatewayClient(mockClientConfig);
    mockContract = (gateway as any).contract;
  });

  describe('submitCommitments', () => {
    it('should submit multiple commitments in a single transaction', async () => {
      // Prepare test data
      const commitments = createTestCommitments(3);
      
      // Mock a successful transaction
      mockContract.submitCommitments.mockResolvedValue({
        wait: jest.fn().mockResolvedValue({
          hash: '0xBATCH_COMMIT_TX',
          blockNumber: 12345,
          gasUsed: BigInt(200000)
        })
      });
      
      // Call the method
      const result = await gateway.submitCommitments(commitments);
      
      // Check if the contract was called with correct parameters
      expect(mockContract.submitCommitments).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            requestID: expect.any(BigInt),
            payload: expect.any(Uint8Array),
            authenticator: expect.any(Uint8Array)
          })
        ]),
        expect.anything()
      );
      
      // Check the result
      expect(result.successCount).toBeDefined();
      expect(result.result.success).toBe(true);
      expect(result.result.transactionHash).toBe('0xBATCH_COMMIT_TX');
    });

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
      expect(mockContract.submitCommitments).not.toHaveBeenCalled();
      expect(result.result.success).toBe(false);
      expect(result.result.error).toBeDefined();
    });
  });

  describe('submitAndCreateBatch', () => {
    it('should submit commitments and create a batch in a single transaction', async () => {
      // Prepare test data
      const commitments = createTestCommitments(3);
      
      // Mock a successful transaction
      mockContract.submitAndCreateBatch.mockResolvedValue({
        wait: jest.fn().mockResolvedValue({
          hash: '0xBATCH_COMMIT_AND_CREATE_TX',
          blockNumber: 12345,
          gasUsed: BigInt(300000)
        })
      });
      
      // Call the method
      const result = await gateway.submitAndCreateBatch(commitments);
      
      // Check if the contract was called with correct parameters
      expect(mockContract.submitAndCreateBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            requestID: expect.any(BigInt),
            payload: expect.any(Uint8Array),
            authenticator: expect.any(Uint8Array)
          })
        ]),
        expect.anything()
      );
      
      // Check the result
      expect(result.batchNumber).toBeDefined();
      expect(result.successCount).toBeDefined();
      expect(result.result.success).toBe(true);
      expect(result.result.transactionHash).toBe('0xBATCH_COMMIT_AND_CREATE_TX');
    });

    it('should handle transaction failure gracefully', async () => {
      // Prepare test data
      const commitments = createTestCommitments(3);
      
      // Mock a failed transaction
      mockContract.submitAndCreateBatch.mockRejectedValue(new Error('Transaction failed'));
      
      // Call the method
      const result = await gateway.submitAndCreateBatch(commitments);
      
      // Check the result indicates failure
      expect(result.result.success).toBe(false);
      expect(result.result.error).toBeDefined();
      expect(result.result.error?.message).toBe('Transaction failed');
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
  
  describe('Legacy methods', () => {
    it('should still support submitMultipleCommitments but with deprecation warning', async () => {
      // Store original console.warn
      const originalWarn = console.warn;
      
      // Mock console.warn
      console.warn = jest.fn();
      
      // Prepare test data
      const commitments = createTestCommitments(2);
      
      // Mock successful transactions
      mockContract.submitCommitment.mockResolvedValue({
        wait: jest.fn().mockResolvedValue({
          hash: '0xLEGACY_TX',
          blockNumber: 12345,
          gasUsed: BigInt(100000)
        })
      });
      
      // Call the deprecated method
      await gateway.submitMultipleCommitments(commitments);
      
      // Check if warning was shown
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('deprecated')
      );
      
      // Check if submitCommitment was called for each commitment
      expect(mockContract.submitCommitment).toHaveBeenCalledTimes(2);
      
      // Restore console.warn
      console.warn = originalWarn;
    });
  });
});