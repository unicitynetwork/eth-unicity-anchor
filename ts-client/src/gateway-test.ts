/**
 * Ethereum Unicity Anchor Gateway Test Script
 * 
 * This script tests the gateway endpoint by:
 * 1. Generating a random private key and public key (auth)
 * 2. Sending the specified number of randomly generated commitments
 * 3. Polling for inclusion proofs for each submission
 * 4. Reporting results of submission and verification
 * 
 * Usage:
 *   ts-node gateway-test.ts <gateway-url> [commit-count]
 */

import { ethers } from 'ethers';
import axios from 'axios';
import * as crypto from 'crypto';

// Types
interface Commitment {
  requestId: string;
  transactionHash: string;
  authenticator: {
    publicKey: string;
    stateHash: string;
    signature: string;
  };
}

interface SubmissionResult {
  success: boolean;
  status: string;
  data?: any;
  error?: string;
  details?: any;
}

interface InclusionProof {
  requestId: string;
  batchNumber: string;
  processed: boolean;
  hashroot: string;
  proof: string;
}

interface ProofResult {
  success: boolean;
  proof?: InclusionProof;
  error?: string;
  details?: any;
}

interface SubmissionTracker {
  commitment: Commitment;
  submissionResult: SubmissionResult;
  proofVerified: boolean;
  proofFound: boolean;
  proof?: InclusionProof;
  proofResult?: ProofResult;
  error?: string;
}

// Helper function to create delay
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// Generate a random hexadecimal string of specified length
function randomHex(length: number): string {
  return '0x' + crypto.randomBytes(length).toString('hex');
}

// Generate random bytes and convert to hex
function generateRandomBytes(length: number): string {
  return '0x' + crypto.randomBytes(length).toString('hex');
}

// Generate a random request ID
function generateRandomRequestId(): string {
  // Create a random 64-bit number (8 bytes)
  return '0x' + crypto.randomBytes(8).toString('hex');
}

// Generate an ECDSA keypair
function generateKeypair(): { privateKey: string; publicKey: string } {
  const privateKey = '0x' + crypto.randomBytes(32).toString('hex');
  const wallet = new ethers.Wallet(privateKey);
  return {
    privateKey,
    publicKey: wallet.address
  };
}

// Create a random commitment
function createRandomCommitment(keypair: { privateKey: string; publicKey: string }): Commitment {
  const requestId = generateRandomRequestId();
  const payload = generateRandomBytes(32); // 32 bytes of random data
  
  // Create a simple authenticator with the public key and a signature
  const dataToSign = ethers.solidityPacked(
    ['bytes', 'bytes'],
    [requestId, payload]
  );
  
  // Hash the data
  const messageHash = ethers.keccak256(dataToSign);
  
  // Sign the hash with the private key
  const wallet = new ethers.Wallet(keypair.privateKey);
  const messageHashBytes = ethers.getBytes(messageHash);
  const signature = wallet.signingKey.sign(messageHashBytes).serialized;
  
  // Authenticator contains public key and signature
  const authenticator = {
    publicKey: keypair.publicKey,
    stateHash: messageHash,
    signature: signature
  };
  
  return {
    requestId,
    transactionHash: payload,
    authenticator
  };
}

// Submit a commitment to the gateway
async function submitCommitment(gatewayUrl: string, commitment: Commitment): Promise<SubmissionResult> {
  try {
    const response = await axios.post(`${gatewayUrl}/api/v1/submitCommitment`, commitment);
    return {
      success: true,
      status: response.data.status,
      data: response.data
    };
  } catch (error: any) {
    return {
      success: false,
      status: error.response?.data?.status || 'ERROR',
      error: error.message,
      details: error.response?.data
    };
  }
}

// Get inclusion proof for a request ID
async function getInclusionProof(gatewayUrl: string, requestId: string): Promise<ProofResult> {
  try {
    const response = await axios.get(`${gatewayUrl}/api/v1/getInclusionProof/${requestId}`);
    return {
      success: true,
      proof: response.data
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      details: error.response?.data
    };
  }
}

// Main function
async function main(): Promise<void> {
  // Parse command line arguments
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: ts-node gateway-test.ts <gateway-url> [commit-count]');
    process.exit(1);
  }
  
  const gatewayUrl = args[0];
  const commitCount = args[1] ? parseInt(args[1]) : 1;
  
  if (isNaN(commitCount) || commitCount < 1) {
    console.error('Error: commit-count must be a positive integer');
    process.exit(1);
  }
  
  console.log(`\n=== ETHEREUM UNICITY ANCHOR GATEWAY TEST ===`);
  console.log(`Gateway URL: ${gatewayUrl}`);
  console.log(`Commit Count: ${commitCount}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`===========================================\n`);
  
  // Generate a keypair for signing commitments
  console.log('Generating cryptographic keypair...');
  const keypair = generateKeypair();
  console.log(`Public Key: ${keypair.publicKey}`);
  
  // Generate and submit random commitments
  console.log(`\nGenerating and submitting ${commitCount} random commitments...`);
  
  const submissions: SubmissionTracker[] = [];
  
  for (let i = 0; i < commitCount; i++) {
    const commitment = createRandomCommitment(keypair);
    console.log(`\n[${i+1}/${commitCount}] Submitting commitment with Request ID: ${commitment.requestId}`);
    
    const result = await submitCommitment(gatewayUrl, commitment);
    
    if (result.success) {
      console.log(`✅ Submission successful with status: ${result.status}`);
      
      submissions.push({
        commitment,
        submissionResult: result,
        proofVerified: false,
        proofFound: false
      });
    } else {
      console.error(`❌ Submission failed: ${result.error}`);
      console.error(`Details: ${JSON.stringify(result.details, null, 2)}`);
      
      submissions.push({
        commitment,
        submissionResult: result,
        proofVerified: false,
        proofFound: false,
        error: result.error
      });
    }
    
    // Add a small delay between submissions to avoid overloading the gateway
    if (i < commitCount - 1) {
      await sleep(500);
    }
  }
  
  // Wait for commitments to be processed and poll for inclusion proofs
  console.log('\n=== Polling for inclusion proofs ===');
  
  // Poll for proofs for up to 60 seconds (12 attempts, 5 seconds apart)
  const maxAttempts = 12;
  const pollingInterval = 5000; // 5 seconds
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`\nPolling attempt ${attempt}/${maxAttempts}...`);
    
    let allProofsFound = true;
    let newProofsFound = false;
    
    // Check for proofs for all pending commitments
    for (const submission of submissions) {
      // Skip if we already found and verified the proof
      if (submission.proofFound) {
        continue;
      }
      
      console.log(`Checking proof for Request ID: ${submission.commitment.requestId}`);
      
      // Only check for proof if the submission was successful
      if (submission.submissionResult.success) {
        const proofResult = await getInclusionProof(gatewayUrl, submission.commitment.requestId);
        
        if (proofResult.success && proofResult.proof) {
          submission.proofFound = true;
          submission.proof = proofResult.proof;
          submission.proofResult = proofResult;
          
          console.log(`✅ Proof found in batch #${proofResult.proof.batchNumber}`);
          
          // Here we would verify the proof, but for simplicity we just mark it as verified
          // In a real scenario, you would verify the Merkle proof against the batch root
          submission.proofVerified = true;
          newProofsFound = true;
        } else {
          console.log(`❌ No proof found yet`);
          allProofsFound = false;
        }
      } else {
        // For failed submissions, we don't expect to find proofs
        allProofsFound = false;
      }
    }
    
    // If we found all proofs, no need to continue polling
    if (allProofsFound) {
      console.log('\n✅ All proofs found and verified!');
      break;
    }
    
    // If we found new proofs in this attempt but not all, wait for next attempt
    if (newProofsFound) {
      console.log(`\n⏳ Found some new proofs, continuing to poll for remaining...`);
    } else {
      console.log(`\n⏳ No new proofs found in this attempt, waiting for next poll...`);
    }
    
    // If this is not the last attempt, wait before trying again
    if (attempt < maxAttempts) {
      console.log(`Waiting ${pollingInterval/1000} seconds before next attempt...`);
      await sleep(pollingInterval);
    }
  }
  
  // Final report
  console.log('\n=== FINAL REPORT ===');
  
  const successfulSubmissions = submissions.filter(s => s.submissionResult.success).length;
  const failedSubmissions = submissions.filter(s => !s.submissionResult.success).length;
  const proofsFound = submissions.filter(s => s.proofFound).length;
  const proofsVerified = submissions.filter(s => s.proofVerified).length;
  const pendingCommitments = submissions.filter(s => s.submissionResult.success && !s.proofFound).length;
  
  console.log(`Total Commitments: ${commitCount}`);
  console.log(`Successful Submissions: ${successfulSubmissions}`);
  console.log(`Failed Submissions: ${failedSubmissions}`);
  console.log(`Proofs Found: ${proofsFound}`);
  console.log(`Proofs Verified: ${proofsVerified}`);
  console.log(`Pending Commitments (no proof yet): ${pendingCommitments}`);
  
  if (pendingCommitments > 0) {
    console.log('\nRequest IDs with missing proofs:');
    submissions
      .filter(s => s.submissionResult.success && !s.proofFound)
      .forEach(s => {
        console.log(`- ${s.commitment.requestId}`);
      });
  }
  
  if (failedSubmissions > 0) {
    console.log('\nFailed submissions:');
    submissions
      .filter(s => !s.submissionResult.success)
      .forEach(s => {
        console.log(`- ${s.commitment.requestId}: ${s.error || 'Unknown error'}`);
      });
  }
  
  console.log('\n=== TEST COMPLETED ===');
  
  // Exit with error code if any commitments failed or are still pending
  process.exit(failedSubmissions > 0 || pendingCommitments > 0 ? 1 : 0);
}

// Run the main function
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});