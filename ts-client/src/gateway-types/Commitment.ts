import { Authenticator } from './Authenticator';
import { DataHash } from './DataHash';
import { RequestId } from './RequestId';

/**
 * Represents a commitment in the system
 */
export class Commitment {
  public readonly requestId: RequestId;
  public readonly transactionHash: DataHash;
  public readonly authenticator: Authenticator;

  /**
   * Create a new Commitment
   * @param requestId Request ID
   * @param transactionHash Transaction hash
   * @param authenticator Authenticator
   */
  constructor(requestId: RequestId, transactionHash: DataHash, authenticator: Authenticator) {
    this.requestId = requestId;
    this.transactionHash = transactionHash;
    this.authenticator = authenticator;
  }

  /**
   * Create a Commitment from DTO
   * @param dto Commitment DTO
   * @returns Commitment instance
   */
  public static async fromDto(dto: { 
    requestId: string; 
    transactionHash: string; 
    authenticator: { 
      publicKey: string; 
      stateHash: string; 
      signature: string; 
    }
  }): Promise<Commitment> {
    const requestId = await RequestId.create(dto.requestId);
    const transactionHash = DataHash.fromDto(dto.transactionHash);
    const authenticator = Authenticator.fromDto(dto.authenticator);
    
    return new Commitment(requestId, transactionHash, authenticator);
  }

  /**
   * Get string representation
   * @returns String representation
   */
  public toString(): string {
    return `Commitment(${this.requestId.toString()}, ${this.transactionHash.toString()}, ${this.authenticator.toString()})`;
  }

  /**
   * Convert to DTO
   * @returns DTO representation
   */
  public toDto(): { 
    requestId: string; 
    transactionHash: string; 
    authenticator: { 
      publicKey: string; 
      stateHash: string; 
      signature: string; 
    } 
  } {
    return {
      requestId: this.requestId.toDto(),
      transactionHash: this.transactionHash.toDto(),
      authenticator: this.authenticator.toDto()
    };
  }
}
