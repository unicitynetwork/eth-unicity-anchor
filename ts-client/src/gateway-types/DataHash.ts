import crypto from 'crypto';

/**
 * Represents a data hash in the system
 */
export class DataHash {
  public readonly data: Buffer;

  /**
   * Create a new DataHash
   * @param data The hash data as a Buffer
   */
  constructor(data: Buffer) {
    this.data = data;
  }

  /**
   * Create a DataHash from a hex string
   * @param hex Hex string
   * @returns DataHash instance
   */
  public static fromHex(hex: string): DataHash {
    return new DataHash(Buffer.from(hex, 'hex'));
  }

  /**
   * Create a DataHash from binary data
   * @param data Binary data to hash
   * @returns DataHash instance
   */
  public static fromData(data: Buffer | Uint8Array | string): DataHash {
    const bufferData = Buffer.isBuffer(data) 
      ? data 
      : typeof data === 'string' 
        ? Buffer.from(data) 
        : Buffer.from(data);
    
    const hash = crypto.createHash('sha256').update(bufferData).digest();
    return new DataHash(hash);
  }

  /**
   * Create a DataHash from a DTO
   * @param dto Data hash DTO
   * @returns DataHash instance
   */
  public static fromDto(dto: string): DataHash {
    return DataHash.fromHex(dto);
  }

  /**
   * Check if two DataHash instances are equal
   * @param other Other DataHash to compare
   * @returns Whether they are equal
   */
  public equals(other: DataHash): boolean {
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
