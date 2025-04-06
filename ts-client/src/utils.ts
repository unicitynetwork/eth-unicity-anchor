import { CommitmentRequest, CommitmentRequestDto, Batch, BatchDto } from './types';
import { ethers } from 'ethers';

/**
 * Convert bytes to hex string
 * @param bytes Bytes array to convert
 * @returns Hex string with 0x prefix
 */
export function bytesToHex(bytes: Uint8Array | string): string {
  if (typeof bytes === 'string') {
    // If already a hex string, ensure it has 0x prefix
    return bytes.startsWith('0x') ? bytes : `0x${bytes}`;
  }
  return ethers.hexlify(bytes);
}

/**
 * Convert hex string to bytes
 * @param hex Hex string to convert
 * @returns Uint8Array of bytes
 */
export function hexToBytes(hex: string): Uint8Array {
  const hexString = hex.startsWith('0x') ? hex : `0x${hex}`;
  return ethers.getBytes(hexString);
}

/**
 * Generate a random request ID
 * @returns A random BigInt suitable for a request ID
 */
export function generateRandomRequestId(): bigint {
  // Generate a random 64-bit integer (to avoid overflow issues)
  const buffer = new Uint8Array(8);
  crypto.getRandomValues(buffer);
  return BigInt('0x' + Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join(''));
}

/**
 * Convert a CommitmentRequest to a DTO for easier handling
 * @param commitment The commitment to convert
 * @returns DTO representation of the commitment
 */
export function convertCommitmentToDto(commitment: CommitmentRequest): CommitmentRequestDto {
  return {
    requestID: commitment.requestID.toString(),
    payload: bytesToHex(commitment.payload),
    authenticator: bytesToHex(commitment.authenticator)
  };
}

/**
 * Convert a CommitmentRequestDto back to a CommitmentRequest
 * @param dto The DTO to convert
 * @returns CommitmentRequest representation
 */
export function convertDtoToCommitment(dto: CommitmentRequestDto): CommitmentRequest {
  return {
    requestID: BigInt(dto.requestID),
    payload: hexToBytes(dto.payload),
    authenticator: hexToBytes(dto.authenticator)
  };
}

/**
 * Convert a Batch to a DTO for easier handling
 * @param batch The batch to convert
 * @returns DTO representation of the batch
 */
export function convertBatchToDto(batch: Batch): BatchDto {
  return {
    batchNumber: batch.batchNumber.toString(),
    requestIds: batch.requestIds.map(id => id.toString()),
    hashroot: bytesToHex(batch.hashroot),
    processed: batch.processed
  };
}

/**
 * Convert a BatchDto back to a Batch
 * @param dto The DTO to convert
 * @returns Batch representation
 */
export function convertDtoToBatch(dto: BatchDto): Batch {
  return {
    batchNumber: BigInt(dto.batchNumber),
    requestIds: dto.requestIds.map(id => BigInt(id)),
    hashroot: hexToBytes(dto.hashroot),
    processed: dto.processed
  };
}

/**
 * Wait for a specified amount of time
 * @param ms Milliseconds to wait
 * @returns Promise that resolves after the specified time
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get the current timestamp in seconds
 * @returns Current Unix timestamp in seconds
 */
export function getCurrentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Create a simple hash of content
 * @param content Content to hash (string or Uint8Array)
 * @returns Hash as Uint8Array
 */
export async function createHash(content: string | Uint8Array): Promise<Uint8Array> {
  const data = typeof content === 'string' ? 
    new TextEncoder().encode(content) : content;
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
}

/**
 * Compute the Keccak256 hash of data
 * @param data Data to hash
 * @returns Hash as hex string
 */
export function keccak256(data: Uint8Array | string): string {
  // Handle string data properly
  if (typeof data === 'string') {
    // If it's already a hex string with 0x prefix, use it directly
    if (data.startsWith('0x')) {
      try {
        return ethers.keccak256(ethers.getBytes(data));
      } catch (e) {
        // If it's not a valid hex string, convert it to bytes
        const bytes = new TextEncoder().encode(data);
        return ethers.keccak256(bytes);
      }
    } else {
      // For non-hex strings, convert to bytes
      const bytes = new TextEncoder().encode(data);
      return ethers.keccak256(bytes);
    }
  } else {
    // It's already a Uint8Array
    return ethers.keccak256(data);
  }
}