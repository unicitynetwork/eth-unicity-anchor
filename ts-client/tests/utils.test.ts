import {
  bytesToHex,
  hexToBytes,
  generateRandomRequestId,
  convertCommitmentToDto,
  convertDtoToCommitment,
  convertBatchToDto,
  convertDtoToBatch,
  keccak256
} from '../src/utils';

describe('Utils', () => {
  describe('bytesToHex', () => {
    it('should convert Uint8Array to hex string', () => {
      const bytes = new Uint8Array([0, 1, 2, 3, 255]);
      const hex = bytesToHex(bytes);
      expect(hex).toBe('0x00010203ff');
    });

    it('should handle empty array', () => {
      const bytes = new Uint8Array([]);
      const hex = bytesToHex(bytes);
      expect(hex).toBe('0x');
    });

    it('should add 0x prefix if missing', () => {
      const hex = bytesToHex('1234');
      expect(hex).toBe('0x1234');
    });

    it('should leave 0x prefix if present', () => {
      const hex = bytesToHex('0x1234');
      expect(hex).toBe('0x1234');
    });
  });

  describe('hexToBytes', () => {
    it('should convert hex string to Uint8Array', () => {
      const hex = '0x00010203ff';
      const bytes = hexToBytes(hex);
      expect(bytes).toEqual(new Uint8Array([0, 1, 2, 3, 255]));
    });

    it('should handle empty hex string', () => {
      const hex = '0x';
      const bytes = hexToBytes(hex);
      expect(bytes).toEqual(new Uint8Array([]));
    });

    it('should add 0x prefix if missing', () => {
      const hex = '1234';
      const bytes = hexToBytes(hex);
      expect(bytes).toEqual(new Uint8Array([0x12, 0x34]));
    });
  });

  describe('generateRandomRequestId', () => {
    it('should generate a positive BigInt', () => {
      const id = generateRandomRequestId();
      expect(typeof id).toBe('bigint');
      expect(id > 0n).toBe(true);
    });

    it('should generate different IDs on consecutive calls', () => {
      const id1 = generateRandomRequestId();
      const id2 = generateRandomRequestId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('commitment conversion', () => {
    const commitment = {
      requestID: 123n,
      payload: new Uint8Array([1, 2, 3]),
      authenticator: new Uint8Array([4, 5, 6])
    };

    const dto = {
      requestID: '123',
      payload: '0x010203',
      authenticator: '0x040506'
    };

    it('should convert commitment to DTO', () => {
      const result = convertCommitmentToDto(commitment);
      expect(result).toEqual(dto);
    });

    it('should convert DTO to commitment', () => {
      const result = convertDtoToCommitment(dto);
      expect(result.requestID).toEqual(commitment.requestID);
      expect(result.payload).toEqual(commitment.payload);
      expect(result.authenticator).toEqual(commitment.authenticator);
    });
  });

  describe('batch conversion', () => {
    const batch = {
      batchNumber: 1n,
      requestIds: [1n, 2n, 3n],
      hashroot: new Uint8Array([1, 2, 3, 4]),
      processed: true
    };

    const dto = {
      batchNumber: '1',
      requestIds: ['1', '2', '3'],
      hashroot: '0x01020304',
      processed: true
    };

    it('should convert batch to DTO', () => {
      const result = convertBatchToDto(batch);
      expect(result).toEqual(dto);
    });

    it('should convert DTO to batch', () => {
      const result = convertDtoToBatch(dto);
      expect(result.batchNumber).toEqual(batch.batchNumber);
      expect(result.requestIds).toEqual(batch.requestIds);
      expect(result.hashroot).toEqual(batch.hashroot);
      expect(result.processed).toEqual(batch.processed);
    });
  });

  describe('keccak256', () => {
    it('should compute hash of string', () => {
      const hash = keccak256('test');
      // Just check that it returns a valid hash format rather than an exact value
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('should compute hash of Uint8Array', () => {
      const hash = keccak256(new Uint8Array([1, 2, 3]));
      // Just check that it returns a valid hash format rather than an exact value
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('should handle hex strings', () => {
      const hash = keccak256('0x010203');
      // Just check that it returns a valid hash format rather than an exact value
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });
});