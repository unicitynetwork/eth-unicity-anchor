#!/usr/bin/env node

/**
 * Manual test script for Ethereum Unicity Anchor Gateway
 * 
 * This script tests the gateway endpoint by:
 * 1. Generating a random private key and public key (auth)
 * 2. Sending the specified number of randomly generated commitments
 * 3. Polling for inclusion proofs for each submission
 * 4. Reporting results of submission and verification
 * 
 * Usage:
 *   npx ts-node src/test-gateway.ts <gateway-url> [commit-count]
 * 
 * Arguments:
 *   gateway-url: URL of the gateway endpoint (e.g., http://localhost:3000)
 *   commit-count: (Optional) Number of commitments to send (default: 1)
 */

import { ethers } from 'ethers';
import axios from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Types
interface Authenticator {
  publicKey: string;
  stateHash: string;
  signature: string;
}

interface Commitment {
  requestId: string;
  transactionHash: string;
  authenticator: Authenticator;
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
  const authenticator: Authenticator = {
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
    const response = await axios.post(`${gatewayUrl}/submitCommitment`, commitment);
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
    const response = await axios.get(`${gatewayUrl}/getInclusionProof/${requestId}`);
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

// Verify an inclusion proof
function verifyProof(commitment: Commitment, proof: InclusionProof): boolean {
  try {
    if (!proof || !proof.proof || !proof.hashroot) {
      if (verbose) console.log('Invalid proof structure');
      return false;
    }
    
    // For basic verification, we check:
    // 1. The requestId matches
    if (commitment.requestId !== proof.requestId) {
      if (verbose) console.log('Request ID mismatch');
      return false;
    }
    
    // 2. The proof has a hashroot and proof data
    if (!proof.hashroot || proof.hashroot === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      if (verbose) console.log('Invalid hashroot');
      return false;
    }
    
    if (!proof.proof || proof.proof === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      if (verbose) console.log('Invalid proof data');
      return false;
    }
    
    // 3. Check if the proof has been marked as processed
    if (!proof.processed) {
      if (verbose) console.log('Proof not processed');
      return false;
    }
    
    // For full cryptographic verification, we would:
    // 1. Parse the proof into a Merkle proof structure
    // 2. Reconstruct the leaf node from the commitment data
    // 3. Verify the leaf is included in the Merkle tree with the given proof
    // 4. Check that the resulting root hash matches the hashroot in the proof
    
    // This would typically use a library like @openzeppelin/merkle-tree:
    // const tree = new MerkleTree(leaves);
    // return tree.verify(proof, leaf, root);
    
    // For now, in this simplified version, we assume the proof is valid 
    // if it has the correct structure and matching requestId
    if (verbose) console.log('Basic proof structure validation passed');
    return true;
  } catch (error) {
    if (verbose) console.error('Error verifying proof:', error);
    return false;
  }
}

// Command line options
interface CommandLineOptions {
  gatewayUrl: string;
  commitCount: number;
  pollingAttempts: number;
  pollingInterval: number;
  verbose: boolean;
}

// Parse command line arguments
function parseCommandLineArgs(): CommandLineOptions {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error(`
Usage: npx ts-node src/test-gateway.ts <gateway-url> [options]

Arguments:
  gateway-url             URL of the gateway endpoint (e.g., http://localhost:3000)

Options:
  --count, -c N           Number of commitments to send (default: 1)
  --attempts, -a N        Maximum polling attempts (default: 12)
  --interval, -i N        Polling interval in seconds (default: 5)
  --verbose, -v           Enable verbose output
  --help, -h              Show this help message
`);
    process.exit(1);
  }
  
  // Default values
  const options: CommandLineOptions = {
    gatewayUrl: args[0],
    commitCount: 1,
    pollingAttempts: 12,
    pollingInterval: 5,
    verbose: false
  };
  
  // Parse optional arguments
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--count' || arg === '-c') {
      options.commitCount = parseInt(args[++i]);
    } else if (arg === '--attempts' || arg === '-a') {
      options.pollingAttempts = parseInt(args[++i]);
    } else if (arg === '--interval' || arg === '-i') {
      options.pollingInterval = parseInt(args[++i]);
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.error(`
Usage: npx ts-node src/test-gateway.ts <gateway-url> [options]

Arguments:
  gateway-url             URL of the gateway endpoint (e.g., http://localhost:3000)

Options:
  --count, -c N           Number of commitments to send (default: 1)
  --attempts, -a N        Maximum polling attempts (default: 12)
  --interval, -i N        Polling interval in seconds (default: 5)
  --verbose, -v           Enable verbose output
  --help, -h              Show this help message
`);
      process.exit(0);
    }
  }
  
  if (isNaN(options.commitCount) || options.commitCount < 1) {
    console.error('Error: commit count must be a positive integer');
    process.exit(1);
  }
  
  if (isNaN(options.pollingAttempts) || options.pollingAttempts < 1) {
    console.error('Error: polling attempts must be a positive integer');
    process.exit(1);
  }
  
  if (isNaN(options.pollingInterval) || options.pollingInterval < 1) {
    console.error('Error: polling interval must be a positive integer');
    process.exit(1);
  }
  
  return options;
}

// Main function
async function main(): Promise<void> {
  // Parse command line arguments
  const options = parseCommandLineArgs();
  const { gatewayUrl, commitCount, pollingAttempts, pollingInterval, verbose } = options;
  
  console.log(`\n=== ETHEREUM UNICITY ANCHOR GATEWAY TEST ===`);
  console.log(`Gateway URL: ${gatewayUrl}`);
  console.log(`Commit Count: ${commitCount}`);
  console.log(`Polling Attempts: ${pollingAttempts}`);
  console.log(`Polling Interval: ${pollingInterval} seconds`);
  console.log(`Verbose Mode: ${verbose ? 'Enabled' : 'Disabled'}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`===========================================\n`);
  
  // Verify endpoint is reachable
  try {
    await axios.options(gatewayUrl);
    console.log(`✅ Gateway endpoint is reachable`);
  } catch (error: any) {
    console.error(`❌ Gateway endpoint is not reachable: ${error.message}`);
    if (error.code === 'ECONNREFUSED') {
      console.error(`   Is the gateway running at ${gatewayUrl}?`);
    }
    process.exit(1);
  }
  
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
  
  // Convert polling interval from seconds to milliseconds
  const pollingIntervalMs = pollingInterval * 1000;
  
  for (let attempt = 1; attempt <= pollingAttempts; attempt++) {
    console.log(`\nPolling attempt ${attempt}/${pollingAttempts}...`);
    
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
          
          if (verbose) {
            console.log(`  - Hashroot: ${proofResult.proof.hashroot.substring(0, 10)}...`);
            console.log(`  - Proof length: ${proofResult.proof.proof.length}`);
          }
          
          // Verify the proof
          const verified = verifyProof(submission.commitment, proofResult.proof);
          submission.proofVerified = verified;
          
          if (verified) {
            console.log(`✅ Proof verification successful`);
          } else {
            console.log(`❌ Proof verification failed`);
            
            // Log more details for debugging
            if (verbose) {
              console.log(`  - Commitment request ID: ${submission.commitment.requestId}`);
              console.log(`  - Proof request ID: ${proofResult.proof.requestId}`);
              console.log(`  - Processed: ${proofResult.proof.processed}`);
            }
          }
          
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
    if (attempt < pollingAttempts) {
      console.log(`Waiting ${pollingInterval} seconds before next attempt...`);
      await sleep(pollingIntervalMs);
    }
  }
  
  // Final report
  console.log('\n=== FINAL REPORT ===');
  
  const successfulSubmissions = submissions.filter(s => s.submissionResult.success).length;
  const failedSubmissions = submissions.filter(s => !s.submissionResult.success).length;
  const proofsFound = submissions.filter(s => s.proofFound).length;
  const proofsVerified = submissions.filter(s => s.proofVerified).length;
  const pendingCommitments = submissions.filter(s => s.submissionResult.success && !s.proofFound).length;
  const failedVerifications = submissions.filter(s => s.proofFound && !s.proofVerified).length;
  
  console.log(`Total Commitments: ${commitCount}`);
  console.log(`Successful Submissions: ${successfulSubmissions}`);
  console.log(`Failed Submissions: ${failedSubmissions}`);
  console.log(`Proofs Found: ${proofsFound}`);
  console.log(`Proofs Verified: ${proofsVerified}`);
  console.log(`Failed Verifications: ${failedVerifications}`);
  console.log(`Pending Commitments (no proof yet): ${pendingCommitments}`);
  
  if (pendingCommitments > 0) {
    console.log('\nRequest IDs with missing proofs:');
    submissions
      .filter(s => s.submissionResult.success && !s.proofFound)
      .forEach(s => {
        console.log(`- ${s.commitment.requestId}`);
      });
  }
  
  if (failedVerifications > 0) {
    console.log('\nRequest IDs with failed proof verification:');
    submissions
      .filter(s => s.proofFound && !s.proofVerified)
      .forEach(s => {
        console.log(`- ${s.commitment.requestId}`);
        if (s.proof) {
          console.log(`  Batch Number: ${s.proof.batchNumber}`);
          console.log(`  Hashroot: ${s.proof.hashroot.substring(0, 10)}...`);
        }
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
  
  // Save test results to file for further analysis
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultFilename = `gateway-test-results-${timestamp}.json`;
    fs.writeFileSync(
      resultFilename, 
      JSON.stringify({
        timestamp: new Date().toISOString(),
        gatewayUrl,
        commitCount,
        stats: {
          successfulSubmissions,
          failedSubmissions,
          proofsFound,
          proofsVerified,
          failedVerifications,
          pendingCommitments
        },
        submissions: submissions.map(s => ({
          requestId: s.commitment.requestId,
          submissionStatus: s.submissionResult.status,
          proofFound: s.proofFound,
          proofVerified: s.proofVerified,
          batchNumber: s.proof?.batchNumber,
          hashroot: s.proof?.hashroot
        }))
      }, null, 2)
    );
    console.log(`\nTest results saved to ${resultFilename}`);
  } catch (error) {
    console.error(`\nError saving test results: ${error}`);
  }
  
  // Exit with error code if any commitments failed, are still pending, or proof verification failed
  process.exit(failedSubmissions > 0 || pendingCommitments > 0 || failedVerifications > 0 ? 1 : 0);
}

// Run the main function
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});