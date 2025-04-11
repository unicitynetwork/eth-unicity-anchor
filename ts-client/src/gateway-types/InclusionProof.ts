import { Authenticator } from './Authenticator';
import { DataHash } from './DataHash';

/**
 * Represents an inclusion proof in the system
 */
export class InclusionProof {
  public readonly merkleTreePath: string[];
  public readonly authenticator: Authenticator;
  public readonly transactionHash: DataHash;

  /**
   * Create a new InclusionProof
   * @param merkleTreePath Merkle tree path
   * @param authenticator Authenticator
   * @param transactionHash Transaction hash
   */
  constructor(merkleTreePath: string[], authenticator: Authenticator, transactionHash: DataHash) {
    this.merkleTreePath = merkleTreePath;
    this.authenticator = authenticator;
    this.transactionHash = transactionHash;
  }

  /**
   * Get string representation
   * @returns String representation
   */
  public toString(): string {
    return `InclusionProof(${this.merkleTreePath.length} nodes, ${this.authenticator.toString()}, ${this.transactionHash.toString()})`;
  }

  /**
   * Convert to DTO
   * @returns DTO representation
   */
  public toDto(): { 
    merkleTreePath: string[]; 
    authenticator: { 
      publicKey: string; 
      stateHash: string; 
      signature: string; 
    }; 
    transactionHash: string 
  } {
    return {
      merkleTreePath: this.merkleTreePath,
      authenticator: this.authenticator.toDto(),
      transactionHash: this.transactionHash.toDto()
    };
  }
}
