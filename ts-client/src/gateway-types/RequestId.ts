import crypto from 'crypto';
import { DataHash } from './DataHash';

/**
 * Represents a request ID in the system
 */
export class RequestId {
  public readonly hash: DataHash;
  
  /**
   * Create a new RequestId
   * @param hash The hash representing the request ID
   */
  constructor(hash: DataHash) {
    this.hash = hash;
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
        return new RequestId(DataHash.fromHex(idStr));
      }
      
      // Otherwise, hash the string
      return new RequestId(DataHash.fromData(idStr));
    }
    
    // Both parameters are provided - create hash from public key and state hash
    const pubKeyBuffer = Buffer.isBuffer(publicKeyOrId) 
      ? publicKeyOrId 
      : Buffer.from(publicKeyOrId as string, 'hex');
    
    const stateHashBuffer = Buffer.isBuffer(stateHash) 
      ? stateHash 
      : Buffer.from(stateHash as string, 'hex');
    
    const combinedBuffer = Buffer.concat([pubKeyBuffer, stateHashBuffer]);
    const hash = crypto.createHash('sha256').update(combinedBuffer).digest();
    
    return new RequestId(new DataHash(hash));
  }

  /**
   * Create a RequestId from a DTO
   * @param dto RequestId DTO
   * @returns RequestId instance
   */
  public static fromDto(dto: string): RequestId {
    return new RequestId(DataHash.fromDto(dto));
  }

  /**
   * Convert to BigInt for use in SMT
   * @returns BigInt representation
   */
  public toBigInt(): bigint {
    return BigInt('0x' + this.hash.toString());
  }

  /**
   * Check if two RequestId instances are equal
   * @param other Other RequestId to compare
   * @returns Whether they are equal
   */
  public equals(other: RequestId): boolean {
    return this.hash.equals(other.hash);
  }

  /**
   * Get string representation
   * @returns String representation
   */
  public toString(): string {
    return this.hash.toString();
  }

  /**
   * Convert to DTO
   * @returns DTO representation
   */
  public toDto(): string {
    return this.hash.toDto();
  }
}
