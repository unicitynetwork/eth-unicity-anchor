import crypto from 'crypto';
import { DataHash } from './DataHash';

/**
 * Represents a request ID in the system
 * Now supports arbitrary length request IDs
 */
export class RequestId {
  public readonly data: Buffer;
  
  /**
   * Create a new RequestId
   * @param data The data representing the request ID
   */
  constructor(data: Buffer) {
    this.data = data;
  }

  /**
   * Create a RequestId from public key and state hash
   * @param publicKey Public key or its hash
   * @param stateHash State hash
   * @returns RequestId instance
   */
  public static async create(
    publicKeyOrId: Buffer | string,
    stateHash?: Buffer | string
  ): Promise<RequestId> {
    // If only one parameter is provided, treat it as a string representation of the ID
    if (!stateHash) {
      const idStr = typeof publicKeyOrId === 'string' 
        ? publicKeyOrId 
        : publicKeyOrId.toString();
      
      // Check if it's a hex string
      if (/^[0-9a-fA-F]+$/.test(idStr)) {
        return new RequestId(Buffer.from(idStr, 'hex'));
      }
      
      // Otherwise, hash the string
      return RequestId.fromData(idStr);
    }
    
    // Both parameters are provided - create hash from public key and state hash
    const pubKeyBuffer = Buffer.isBuffer(publicKeyOrId) 
      ? publicKeyOrId 
      : Buffer.from(publicKeyOrId as string, 'hex');
    
    const stateHashBuffer = Buffer.isBuffer(stateHash) 
      ? stateHash 
      : Buffer.from(stateHash as string, 'hex');
    
    const combinedBuffer = Buffer.concat([pubKeyBuffer, stateHashBuffer]);
    return RequestId.fromData(combinedBuffer);
  }

  /**
   * Create a RequestId from binary data
   * @param data Binary data to hash
   * @returns RequestId instance
   */
  public static fromData(data: Buffer | Uint8Array | string): RequestId {
    const bufferData = Buffer.isBuffer(data) 
      ? data 
      : typeof data === 'string' 
        ? Buffer.from(data) 
        : Buffer.from(data);
    
    const hash = crypto.createHash('sha256').update(bufferData).digest();
    return new RequestId(hash);
  }

  /**
   * Create a RequestId from a hex string
   * @param hex Hex string
   * @returns RequestId instance
   */
  public static fromHex(hex: string): RequestId {
    return new RequestId(Buffer.from(hex, 'hex'));
  }

  /**
   * Create a RequestId from a DTO
   * @param dto RequestId DTO
   * @returns RequestId instance
   */
  public static fromDto(dto: string): RequestId {
    return RequestId.fromHex(dto);
  }

  /**
   * Convert to BigInt for use in SMT
   * This may throw an error if the request ID is too large for BigInt
   * @returns BigInt representation
   */
  public toBigInt(): bigint {
    try {
      return BigInt('0x' + this.toString());
    } catch (e) {
      // If conversion to BigInt fails (e.g., because RequestId is too large),
      // use a hash of the full request ID instead
      const hash = crypto.createHash('sha256').update(this.data).digest('hex');
      return BigInt('0x' + hash);
    }
  }

  /**
   * Convert to bytes for contract interaction
   * @returns Bytes representation for Solidity
   */
  public toBytes(): string {
    return '0x' + this.data.toString('hex');
  }

  /**
   * Check if two RequestId instances are equal
   * @param other Other RequestId to compare
   * @returns Whether they are equal
   */
  public equals(other: RequestId): boolean {
    return this.data.equals(other.data);
  }

  /**
   * Get string representation
   * @returns String representation
   */
  public toString(): string {
    return this.data.toString('hex');
  }

  /**
   * Convert to buffer
   * @returns Buffer representation
   */
  public toBuffer(): Buffer {
    return this.data;
  }

  /**
   * Convert to DTO
   * @returns DTO representation
   */
  public toDto(): string {
    return this.toString();
  }
}
