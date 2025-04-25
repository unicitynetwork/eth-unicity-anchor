import crypto from 'crypto';

/**
 * Represents a hashroot in the system
 * Supports arbitrary length hashroots for Sparse Merkle Trees
 */
export class HashRoot {
  public readonly data: Buffer;
  
  /**
   * Create a new HashRoot
   * @param data The data representing the hashroot
   */
  constructor(data: Buffer) {
    this.data = data;
  }

  /**
   * Create a HashRoot from binary data
   * @param data Binary data
   * @returns HashRoot instance
   */
  public static fromData(data: Buffer | Uint8Array | string): HashRoot {
    const bufferData = Buffer.isBuffer(data) 
      ? data 
      : typeof data === 'string' 
        ? Buffer.from(data) 
        : Buffer.from(data);
    
    return new HashRoot(bufferData);
  }

  /**
   * Create a HashRoot from a hex string
   * @param hex Hex string
   * @returns HashRoot instance
   */
  public static fromHex(hex: string): HashRoot {
    return new HashRoot(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
  }

  /**
   * Create a HashRoot from a DTO
   * @param dto HashRoot DTO
   * @returns HashRoot instance
   */
  public static fromDto(dto: string): HashRoot {
    return HashRoot.fromHex(dto);
  }

  /**
   * Convert to bytes for contract interaction
   * @returns Bytes representation for Solidity
   */
  public toBytes(): string {
    return '0x' + this.data.toString('hex');
  }

  /**
   * Generate a fixed-length hash representation
   * Useful when a fixed-length representation is needed
   * @returns 32-byte hash of this hashroot
   */
  public toHash(): Buffer {
    return crypto.createHash('sha256').update(this.data).digest();
  }

  /**
   * Check if two HashRoot instances are equal
   * @param other Other HashRoot to compare
   * @returns Whether they are equal
   */
  public equals(other: HashRoot): boolean {
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