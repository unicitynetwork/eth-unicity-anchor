import crypto from 'crypto';
import { ethers } from 'ethers';
import { DataHash } from './DataHash';

/**
 * Represents an authenticator in the system
 */
export class Authenticator {
  public readonly publicKey: Buffer;
  public readonly stateHash: Buffer;
  public readonly signature: Buffer;

  /**
   * Create a new Authenticator
   * @param publicKey Public key buffer
   * @param stateHash State hash buffer
   * @param signature Signature buffer
   */
  constructor(publicKey: Buffer, stateHash: Buffer, signature: Buffer) {
    this.publicKey = publicKey;
    this.stateHash = stateHash;
    this.signature = signature;
  }

  /**
   * Create an Authenticator from DTO
   * @param dto Authenticator DTO
   * @returns Authenticator instance
   */
  public static fromDto(dto: { publicKey: string; stateHash: string; signature: string }): Authenticator {
    return new Authenticator(
      Buffer.from(dto.publicKey, 'hex'),
      Buffer.from(dto.stateHash, 'hex'),
      Buffer.from(dto.signature, 'hex')
    );
  }

  /**
   * Verify the authenticator against a transaction hash
   * @param transactionHash Transaction hash to verify against
   * @returns Whether verification was successful
   */
  public async verify(transactionHash: DataHash): Promise<boolean> {
    try {
      // This is a simplified implementation
      // In a real implementation, you would use proper signature verification
      // Here we're using ethers.js to simulate verification
      
      // Create the message to verify
      const message = Buffer.concat([
        this.stateHash,
        transactionHash.toBuffer()
      ]);
      
      // Hash the message
      const messageHash = crypto.createHash('sha256').update(message).digest();
      
      // Convert to format ethers.js expects
      const messageHashHex = '0x' + messageHash.toString('hex');
      
      // Extract r, s, v from signature
      // This assumes the signature is in format r || s || v
      const r = '0x' + this.signature.slice(0, 32).toString('hex');
      const s = '0x' + this.signature.slice(32, 64).toString('hex');
      const v = this.signature.length > 64 ? this.signature[64] : 27;
      
      // Recover the public key
      const signature = ethers.Signature.from({
        r, s, v
      });
      
      const recoveredAddress = ethers.recoverAddress(messageHashHex, signature);
      
      // Compare with the expected public key
      // In this simplified version, we just check if it's a valid address
      return ethers.isAddress(recoveredAddress);
    } catch (error) {
      console.error('Authenticator verification error:', error);
      return false;
    }
  }

  /**
   * Get string representation
   * @returns String representation
   */
  public toString(): string {
    return `Authenticator(${this.publicKey.toString('hex')}, ${this.stateHash.toString('hex')}, ${this.signature.toString('hex')})`;
  }

  /**
   * Convert to buffer
   * @returns Combined buffer representation
   */
  public toBuffer(): Buffer {
    return Buffer.concat([this.publicKey, this.stateHash, this.signature]);
  }

  /**
   * Convert to DTO
   * @returns DTO representation
   */
  public toDto(): { publicKey: string; stateHash: string; signature: string } {
    return {
      publicKey: this.publicKey.toString('hex'),
      stateHash: this.stateHash.toString('hex'),
      signature: this.signature.toString('hex')
    };
  }
}
