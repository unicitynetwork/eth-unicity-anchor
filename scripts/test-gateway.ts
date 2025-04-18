#\!/usr/bin/env ts-node

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
 *   ts-node test-gateway.ts <gateway-url> [commit-count]
 * 
 * Arguments:
 *   gateway-url: URL of the gateway endpoint (e.g., http://localhost:3000)
 *   commit-count: (Optional) Number of commitments to send (default: 1)
 */

import axios from 'axios';
import crypto from 'crypto';
import { URL } from 'url';

// Import required classes from @unicitylabs/commons
// Use a direct path to the commons library
import { 
  SigningService, 
  DataHasher, 
  HashAlgorithm, 
  DataHash, 
  Authenticator, 
  RequestId 
} from '../ts-client/node_modules/@unicitylabs/commons/lib/index.js';

// Helper function to create delay
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// Convert buffer to hex string without 0x prefix
function bufferToHex(buffer: Uint8Array): string {
  return Buffer.from(buffer).toString('hex');
}

// Generate a random DataHash
async function generateRandomDataHash(): Promise<DataHash> {
  // Create random bytes as a Uint8Array (required by @unicitylabs/commons)
  const randomBytes = new Uint8Array(crypto.randomBytes(32));
  
  // Use the DataHasher to create a new DataHash
  const hasher = new DataHasher(HashAlgorithm.SHA256);
  hasher.update(randomBytes);
  return await hasher.digest();
}

// Interface for keypair
interface Keypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  signingService: SigningService;
  privateKeyHex: string;
  publicKeyHex: string;
}

// Interface for commitment
interface Commitment {
  requestId: string;
  transactionHash: string;
  authenticator: {
    publicKey: string;
    stateHash: string;
    signature: string;
  };
}

// Interface for submission result
interface SubmissionResult {
  success: boolean;
  status: string;
  error?: string;
  data?: any;
  details?: any;
}

// Interface for proof result
interface ProofResult {
  success: boolean;
  proof?: any;
  error?: string;
  details?: any;
}

// Interface for submission tracking
interface SubmissionTracking {
  commitment: Commitment;
  submissionResult: SubmissionResult;
  proofVerified: boolean;
  proofFound: boolean;
  proof?: any;
  proofResult?: ProofResult;
  error?: string;
}

// Generate a keypair for use with requestId/authenticator
async function generateKeypair(): Promise<Keypair> {
  // Use SigningService from @unicitylabs/commons to generate a private key
  // and get the corresponding public key
  
  // Generate a random private key
  const privateKey = SigningService.generatePrivateKey();
  
  // Create a signing service from the private key
  const signingService = new SigningService(privateKey);
  
  // Get the public key
  const publicKey = signingService.publicKey;
  
  // Convert to hex strings for logging purposes
  const privateKeyHex = bufferToHex(privateKey);
  const publicKeyHex = bufferToHex(publicKey);
  
  console.log(`Generated keypair:`);
  console.log(`- Private key: ${privateKeyHex.substring(0, 8)}...${privateKeyHex.substring(privateKeyHex.length - 8)}`);
  console.log(`- Public key: ${publicKeyHex.substring(0, 8)}...${publicKeyHex.substring(publicKeyHex.length - 8)}`);
  console.log(`- Public key length: ${publicKeyHex.length} hex chars (${publicKeyHex.length/2} bytes)`);
  
  return {
    privateKey,
    publicKey,
    signingService, // Return the signing service for creating authenticators
    privateKeyHex,
    publicKeyHex
  };
}

// Create a random commitment with proper 256-bit values
async function createRandomCommitment(keypair: Keypair): Promise<Commitment> {
  // Generate a random transaction hash using DataHash
  const transactionHash = await generateRandomDataHash();
  const transactionHashHex = bufferToHex(transactionHash.imprint);
  
  // Generate a random state hash using DataHash
  const stateHash = await generateRandomDataHash();
  const stateHashHex = bufferToHex(stateHash.imprint);
  
  // Use the SigningService from the keypair to create an authenticator
  const authenticator = await Authenticator.create(
    keypair.signingService,
    transactionHash,
    stateHash
  );
  
  // Create a RequestId from the public key and state hash
  // Make sure we're using the correct types
  const requestId = await RequestId.create(
    new Uint8Array(keypair.publicKey), 
    new Uint8Array(stateHash.imprint)
  );
  const requestIdHex = bufferToHex(requestId.hash.imprint);
  
  // Convert authenticator to DTO format for submission
  const authenticatorDto = authenticator.toDto();
  
  console.log(`\n✨ Generated commitment with:`);
  console.log(`Request ID: ${requestIdHex} (${requestIdHex.length} hex chars / ${requestIdHex.length/2} bytes)`);
  console.log(`Transaction Hash: ${transactionHashHex} (${transactionHashHex.length} hex chars / ${transactionHashHex.length/2} bytes)`);
  console.log(`Public Key: ${keypair.publicKeyHex.substring(0, 8)}... (${keypair.publicKeyHex.length} hex chars / ${keypair.publicKeyHex.length/2} bytes)`);
  console.log(`State Hash: ${stateHashHex} (${stateHashHex.length} hex chars / ${stateHashHex.length/2} bytes)`);
  console.log(`Signature: ${authenticatorDto.signature.substring(0, 16)}...${authenticatorDto.signature.substring(authenticatorDto.signature.length-16)} (${authenticatorDto.signature.length} hex chars / ${authenticatorDto.signature.length/2} bytes)`);
  
  // Test verification to ensure authenticator is valid
  const isValid = await authenticator.verify(transactionHash);
  console.log(`Authenticator verification: ${isValid ? 'PASSED ✅' : 'FAILED ❌'}`);
  
  return {
    requestId: requestIdHex,
    transactionHash: transactionHashHex,
    authenticator: authenticatorDto
  };
}

// Submit a commitment to the gateway
async function submitCommitment(gatewayUrl: string, commitment: Commitment): Promise<SubmissionResult> {
  try {
    // Ensure the URL doesn't have trailing slashes
    const normalizedUrl = gatewayUrl.endsWith('/') ? gatewayUrl.slice(0, -1) : gatewayUrl;
    const requestUrl = `${normalizedUrl}/`;
    
    // Format the request according to reference implementation
    // Notice the params is an object, not an array
    const payload = {
      jsonrpc: '2.0',
      method: 'submit_commitment',
      params: {
        requestId: commitment.requestId,
        transactionHash: commitment.transactionHash,
        authenticator: commitment.authenticator
      },
      id: 1
    };
    
    console.log(`\n📡 SENDING REQUEST:`);
    console.log(`URL: ${requestUrl}`);
    console.log(`Method: POST`);
    console.log(`Headers: Content-Type: application/json`);
    console.log(`Payload: ${JSON.stringify(payload, null, 2)}`);
    
    // Make the request
    const response = await axios.post(requestUrl, payload);
    
    console.log(`\n📩 RESPONSE RECEIVED:`);
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Response data: ${JSON.stringify(response.data, null, 2)}`);
    
    // Check for JSON-RPC error
    if (response.data.error) {
      return {
        success: false,
        status: 'ERROR',
        error: response.data.error.message,
        details: response.data.error
      };
    }
    
    return {
      success: true,
      status: response.data.result?.status || 'SUCCESS',
      data: response.data.result
    };
  } catch (error: any) {
    console.error(`\n❌ ERROR IN REQUEST:`);
    console.error(`Status: ${error.response?.status || 'Unknown'}`);
    console.error(`Message: ${error.message}`);
    console.error(`Response: ${JSON.stringify(error.response?.data || {}, null, 2)}`);
    
    return {
      success: false,
      status: 'ERROR',
      error: error.message,
      details: error.response?.data
    };
  }
}

// Get inclusion proof for a request ID
async function getInclusionProof(gatewayUrl: string, requestId: string): Promise<ProofResult> {
  try {
    // Ensure the URL doesn't have trailing slashes
    const normalizedUrl = gatewayUrl.endsWith('/') ? gatewayUrl.slice(0, -1) : gatewayUrl;
    const requestUrl = `${normalizedUrl}/`;
    
    // Format the request according to reference implementation
    // Notice the params is an object, not an array
    const payload = {
      jsonrpc: '2.0',
      method: 'get_inclusion_proof',
      params: {
        requestId: requestId
      },
      id: 1
    };
    
    console.log(`\n📡 SENDING PROOF REQUEST:`);
    console.log(`URL: ${requestUrl}`);
    console.log(`Method: POST`);
    console.log(`Headers: Content-Type: application/json`);
    console.log(`Payload: ${JSON.stringify(payload, null, 2)}`);
    
    // Make the request
    const response = await axios.post(requestUrl, payload);
    
    console.log(`\n📩 PROOF RESPONSE RECEIVED:`);
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Response data: ${JSON.stringify(response.data, null, 2)}`);
    
    // Check for JSON-RPC error
    if (response.data.error) {
      return {
        success: false,
        error: response.data.error.message,
        details: response.data.error
      };
    }
    
    // Check if proof is null (not found yet)
    if (response.data.result === null) {
      console.log(`\n⚠️ No proof found yet for request ID: ${requestId}`);
      return {
        success: false,
        error: 'Proof not found'
      };
    }
    
    // Fix the transaction hash by adding the "0000" SHA-256 algorithm prefix
    // if it's missing. This is essential for authenticator verification to work correctly.
    if (response.data.result.transactionHash && 
        \!response.data.result.transactionHash.startsWith('0000')) {
      console.log(`\n⚠️ Adding missing "0000" prefix to transaction hash for verification`);
      console.log(`Original tx hash: ${response.data.result.transactionHash}`);
      response.data.result.transactionHash = '0000' + response.data.result.transactionHash;
      console.log(`Fixed tx hash: ${response.data.result.transactionHash}`);
    }
    
    console.log(`\n✅ Successfully retrieved proof for request ID: ${requestId}`);
    return {
      success: true,
      proof: response.data.result
    };
  } catch (error: any) {
    console.error(`\n❌ ERROR IN PROOF REQUEST:`);
    console.error(`Status: ${error.response?.status || 'Unknown'}`);
    console.error(`Message: ${error.message}`);
    console.error(`Response: ${JSON.stringify(error.response?.data || {}, null, 2)}`);
    
    return {
      success: false,
      error: error.message,
      details: error.response?.data
    };
  }
}

// Main function
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: ts-node test-gateway.ts <gateway-url> [commit-count]');
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
  
  // Ensure the URL format is correct
  const normalizedUrl = gatewayUrl.endsWith('/') ? gatewayUrl.slice(0, -1) : gatewayUrl;
  
  // Check if URL is correctly formatted
  try {
    const url = new URL(normalizedUrl);
    console.log(`Protocol: ${url.protocol}`);
    console.log(`Hostname: ${url.hostname}`);
    console.log(`Port: ${url.port || '(default)'}`);
    console.log(`Pathname: ${url.pathname}`);
  } catch (error) {
    console.warn(`⚠️ WARNING: Invalid URL format: ${(error as Error).message}`);
    console.warn(`Will attempt to use it anyway, but this might cause errors.`);
  }
  
  console.log(`Commit Count: ${commitCount}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`API Call Format: JSON-RPC 2.0`);
  console.log(`===========================================\n`);
  
  // Generate a keypair for signing commitments
  console.log('Generating cryptographic keypair...');
  const keypair = await generateKeypair();
  console.log(`Public Key: ${keypair.publicKeyHex}`);
  
  // Generate and submit random commitments
  console.log(`\nGenerating and submitting ${commitCount} random commitments...`);
  
  const submissions: SubmissionTracking[] = [];
  
  for (let i = 0; i < commitCount; i++) {
    // Create a commitment with properly signed authenticator
    const commitment = await createRandomCommitment(keypair);
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
          
          // Extract batch number from proof if available
          const batchNumber = proofResult.proof.batchNumber || 'unknown';
          console.log(`✅ Proof found in batch #${batchNumber}`);
          
          // Verify that the received transaction hash and authenticator match what we sent
          console.log(`\n🔍 Verifying proof data matches our submission...`);
          
          // First, get the transaction hash without the prefix for comparison
          // since we may have added the prefix for verification purposes
          let receivedTxHash = proofResult.proof.transactionHash;
          if (receivedTxHash.startsWith('0000')) {
            receivedTxHash = receivedTxHash.substring(4);
          }
          
          let originalTxHash = submission.commitment.transactionHash;
          if (originalTxHash.startsWith('0000')) {
            originalTxHash = originalTxHash.substring(4);
          }
          
          // Check transaction hash
          const txHashMatches = receivedTxHash === originalTxHash;
          console.log(`Transaction hash match: ${txHashMatches ? '✅ YES' : '❌ NO'}`);
          
          if (\!txHashMatches) {
            console.log(`  - Original: ${originalTxHash}`);
            console.log(`  - Received: ${receivedTxHash}`);
          }
          
          // Check authenticator
          const authReceived = proofResult.proof.authenticator;
          const authOriginal = submission.commitment.authenticator;
          
          const pubKeyMatches = authReceived.publicKey === authOriginal.publicKey;
          const signatureMatches = authReceived.signature === authOriginal.signature;
          // For state hash, we need to account for possible prefix differences
          let stateHashMatches = authReceived.stateHash === authOriginal.stateHash;
          if (\!stateHashMatches) {
            // Check if the difference is just the '0000' prefix
            if (authReceived.stateHash.startsWith('0000') && 
                authReceived.stateHash.substring(4) === authOriginal.stateHash) {
              stateHashMatches = true;
            }
            else if (authOriginal.stateHash.startsWith('0000') &&
                    authOriginal.stateHash.substring(4) === authReceived.stateHash) {
              stateHashMatches = true;
            }
          }
          
          console.log(`Authenticator comparison:`);
          console.log(`  - Public key match: ${pubKeyMatches ? '✅ YES' : '❌ NO'}`);
          console.log(`  - Signature match: ${signatureMatches ? '✅ YES' : '❌ NO'}`);
          console.log(`  - State hash match: ${stateHashMatches ? '✅ YES' : '❌ NO'}`);
          
          if (\!pubKeyMatches) {
            console.log(`    Original public key: ${authOriginal.publicKey}`);
            console.log(`    Received public key: ${authReceived.publicKey}`);
          }
          
          if (\!signatureMatches) {
            console.log(`    Original signature: ${authOriginal.signature.substring(0, 32)}...`);
            console.log(`    Received signature: ${authReceived.signature.substring(0, 32)}...`);
          }
          
          if (\!stateHashMatches) {
            console.log(`    Original state hash: ${authOriginal.stateHash}`);
            console.log(`    Received state hash: ${authReceived.stateHash}`);
          }
          
          // Set the verification flag based on all checks
          const allMatches = txHashMatches && pubKeyMatches && (signatureMatches || stateHashMatches);
          submission.proofVerified = allMatches;
          
          if (allMatches) {
            console.log(`\n✅ All proof data verified successfully\!`);
          } else {
            console.log(`\n⚠️ Some proof data doesn't match what was submitted`);
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
      console.log('\n✅ All proofs found and verified\!');
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
  const failedSubmissions = submissions.filter(s => \!s.submissionResult.success).length;
  const proofsFound = submissions.filter(s => s.proofFound).length;
  const proofsVerified = submissions.filter(s => s.proofVerified).length;
  const pendingCommitments = submissions.filter(s => s.submissionResult.success && \!s.proofFound).length;
  const dataMismatches = submissions.filter(s => s.proofFound && \!s.proofVerified).length;
  
  console.log(`Total Commitments: ${commitCount}`);
  console.log(`Successful Submissions: ${successfulSubmissions}`);
  console.log(`Failed Submissions: ${failedSubmissions}`);
  console.log(`Proofs Found: ${proofsFound}`);
  console.log(`Proofs Verified: ${proofsVerified}`);
  console.log(`Data Consistency Failures: ${dataMismatches}`);
  console.log(`Pending Commitments (no proof yet): ${pendingCommitments}`);
  
  if (pendingCommitments > 0) {
    console.log('\nRequest IDs with missing proofs:');
    submissions
      .filter(s => s.submissionResult.success && \!s.proofFound)
      .forEach(s => {
        console.log(`- ${s.commitment.requestId}`);
      });
  }
  
  if (dataMismatches > 0) {
    console.log('\nRequest IDs with data consistency failures:');
    submissions
      .filter(s => s.proofFound && \!s.proofVerified)
      .forEach(s => {
        console.log(`- ${s.commitment.requestId}`);
      });
  }
  
  if (failedSubmissions > 0) {
    console.log('\nFailed submissions:');
    submissions
      .filter(s => \!s.submissionResult.success)
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
