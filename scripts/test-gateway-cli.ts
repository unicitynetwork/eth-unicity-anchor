#!/usr/bin/env ts-node
/**
 * CLI Test tool for Ethereum Unicity Anchor Gateway
 * Tests using the @unicitylabs/commons library for request creation
 */

import axios from 'axios';
import crypto from 'crypto';
// Use direct relative paths to imports
import { SigningService } from '../ts-client/node_modules/@unicitylabs/commons/lib/signing/SigningService.js';
import { HashAlgorithm } from '../ts-client/node_modules/@unicitylabs/commons/lib/hash/HashAlgorithm.js';
import { DataHash } from '../ts-client/node_modules/@unicitylabs/commons/lib/hash/DataHash.js';
import { DataHasher } from '../ts-client/node_modules/@unicitylabs/commons/lib/hash/DataHasher.js';
import { Authenticator } from '../ts-client/node_modules/@unicitylabs/commons/lib/api/Authenticator.js';
import { RequestId } from '../ts-client/node_modules/@unicitylabs/commons/lib/api/RequestId.js';
import { 
  InclusionProof, 
  InclusionProofVerificationStatus 
} from '../ts-client/node_modules/@unicitylabs/commons/lib/api/InclusionProof.js';

// Parse command line arguments
const gatewayUrl = process.argv[2] || 'https://gateway.unicity.network';
const count = parseInt(process.argv[3] || '1');

console.log(`Testing gateway at ${gatewayUrl}, submission count: ${count}`);

async function createAuthenticatorAndRequestId() {
  // Generate a signing service with a random private key
  const privateKey = SigningService.generatePrivateKey();
  const signingService = new SigningService(privateKey);
  
  // Get the public key
  const publicKey = signingService.publicKey;
  
  // Create a random transaction hash
  const randomData = new Uint8Array(crypto.randomBytes(32));
  const transactionHash = await new DataHasher(HashAlgorithm.SHA256).update(randomData).digest();
  const txHashHex = Buffer.from(transactionHash.imprint).toString('hex');
  
  // Create a random state hash
  const randomStateData = new Uint8Array(crypto.randomBytes(32));
  const stateHash = await new DataHasher(HashAlgorithm.SHA256).update(randomStateData).digest();
  
  // Create an authenticator
  const authenticator = await Authenticator.create(signingService, transactionHash, stateHash);
  
  // Create a request ID from public key and state hash
  const requestId = await RequestId.create(publicKey, stateHash);
  const requestIdHex = Buffer.from(requestId.hash.imprint).toString('hex');
  
  console.log(`Created commitment with request ID: ${requestIdHex.substring(0, 10)}...`);
  console.log(`Transaction hash: ${txHashHex.substring(0, 10)}...`);
  
  return {
    requestId: requestIdHex,
    transactionHash: Buffer.from(transactionHash.imprint).toString('hex'),
    authenticator: authenticator.toDto(),
    requestIdObj: requestId,  // Return the original RequestId object for verification
    // Add these fields for easier reference
    publicKeyHex: Buffer.from(publicKey).toString('hex'),
    stateHashHex: Buffer.from(stateHash.imprint).toString('hex')
  };
}

async function submitCommitment(gateway: string, commitment: any) {
  try {
    // Extract only the fields needed for the submission
    const { requestId, transactionHash, authenticator } = commitment;
    
    // Create payload for the request
    const payload = {
      jsonrpc: '2.0',
      method: 'submit_commitment',
      params: { requestId, transactionHash, authenticator },
      id: 1
    };
    
    const response = await axios.post(gateway, payload);
    
    console.log(`✅ Submitted commitment with request ID: ${requestId.substring(0, 10)}...`);
    
    return response.data;
  } catch (error: any) {
    console.error(`❌ Failed to submit commitment: ${error.message}`);
    if (error.response) {
      console.error(`Error response: ${error.response.status}`);
    }
    throw error;
  }
}

async function getInclusionProof(gateway: string, requestId: string, origRequestIdObj?: RequestId) {
  try {
    // Create payload for the request
    const payload = {
      jsonrpc: '2.0',
      method: 'get_inclusion_proof',
      params: { requestId },
      id: 1
    };
    
    const response = await axios.post(gateway, payload);
    
    if (response.data.error) {
      console.log(`❌ Error requesting proof: ${response.data.error.message}`);
      return response.data;
    }
    
    // Check if this is a JSON-RPC style response or direct proof data
    const hasJsonRpcFormat = response.data.jsonrpc && (response.data.result || response.data.error);
    
    // Handle JSON-RPC format with no result
    if (hasJsonRpcFormat && !response.data.result) {
      return response.data;
    }
    
    // For direct response format (not JSON-RPC)
    const isDirectProofResponse = !hasJsonRpcFormat && 
      response.data.authenticator && 
      response.data.merkleTreePath && 
      response.data.transactionHash;
    
    if (!hasJsonRpcFormat && !isDirectProofResponse) {
      return response.data;
    }
    
    // Parse the proof response - could be in result or directly in data
    const proofData = hasJsonRpcFormat ? response.data.result : response.data;
    
    try {
      // Track if we applied a fix
      let fixApplied = false;
      
      // Debug the raw data received
      console.log(`DEBUG: Raw proof data received from gateway:`);
      console.log(`- RequestId: ${proofData.requestId}`);
      console.log(`- Transaction Hash: ${proofData.transactionHash}`);
      if (proofData.merkleTreePath) {
        console.log(`- Merkle Tree Root: ${proofData.merkleTreePath.root}`);
        console.log(`- Merkle Tree Steps: ${JSON.stringify(proofData.merkleTreePath.steps)}`);
      }
      
      // Check and fix transaction hash prefix before creating the InclusionProof
      if (proofData.transactionHash && !proofData.transactionHash.startsWith('0000')) {
        proofData.transactionHash = '0000' + proofData.transactionHash;
        fixApplied = true;
        console.log(`DEBUG: Applied fix - added '0000' prefix to transaction hash`);
      }
      
      // Convert the proof data (with fixed hash) to an InclusionProof object
      let proof;
      try {
        proof = InclusionProof.fromDto(proofData);
        console.log(`DEBUG: Successfully created InclusionProof object from DTO`);
      } catch (error) {
        console.log(`DEBUG: Error creating InclusionProof: ${error.message}`);
        throw error;
      }
      
      // Create a RequestId object from the request ID string
      const requestIdObj = origRequestIdObj || await RequestId.fromDto(requestId);
      
      let verificationResult;
      let authVerification;
      let pathVerification;
      
      try {
        // Convert request ID to BigInt for Merkle tree verification
        const requestIdBigInt = requestIdObj.toBigInt();
        
        // Log RequestId details for debugging merkle path issues
        console.log(`DEBUG: Request ID as BigInt: ${requestIdBigInt}`);
        console.log(`DEBUG: Request ID as Hex: ${requestId}`);
        
        // Perform authenticator verification
        authVerification = await proof.authenticator.verify(proof.transactionHash);
        
        // Verify the merkle tree path with detailed debug info
        try {
          pathVerification = await proof.merkleTreePath.verify(requestIdBigInt);
          
          // If path verification failed, log more details
          if (!pathVerification.isPathValid || !pathVerification.isPathIncluded) {
            console.log(`DEBUG: Merkle path verification failed`);
            console.log(`DEBUG: Merkle tree root: ${proof.merkleTreePath.root}`);
            if (proof.merkleTreePath.steps) {
              console.log(`DEBUG: Number of steps in path: ${proof.merkleTreePath.steps.length}`);
            }
          }
        } catch (pathError) {
          console.log(`DEBUG: Exception in path verification: ${pathError.message}`);
          // Create a failed pathVerification result
          pathVerification = {
            isPathValid: false,
            isPathIncluded: false,
            error: pathError.message
          };
        }
        
        // Verify the full proof
        try {
          verificationResult = await proof.verify(requestIdBigInt);
        } catch (verifyError) {
          console.log(`DEBUG: Exception in full verification: ${verifyError.message}`);
          verificationResult = 'ERROR: ' + verifyError.message;
        }
      } catch (verifyError) {
        return {
          ...response.data,
          verificationError: verifyError.message,
          verificationStatus: 'Error'
        };
      }
      
      // Create a summary of the verification
      const txHashMatches = proofData.transactionHash.substring(4) === commitment.transactionHash.substring(4);
      
      // Return result with verification data
      return {
        ...response.data,
        fixApplied,
        verificationResult,
        authVerification,
        pathVerification: pathVerification ? {
          isPathValid: pathVerification.isPathValid,
          isPathIncluded: pathVerification.isPathIncluded
        } : null,
        txHashMatches,
        verificationStatus: verificationResult === InclusionProofVerificationStatus.OK ? 'OK' : 'Failed'
      };
    } catch (parseError) {
      return {
        ...response.data,
        error: parseError.message
      };
    }
  } catch (error: any) {
    // 404 means the proof is not yet available - this is normal
    if (error.response && error.response.status === 404) {
      return { result: null };
    }
    
    // For other errors
    return { 
      result: null, 
      error: error.message 
    };
  }
}

async function main() {
  try {
    const submissions = [];
    
    // Process requested count of submissions
    for (let i = 0; i < count; i++) {
      console.log(`\n=== Submission ${i+1}/${count} ===`);
      
      // Create commitment data
      const commitment = await createAuthenticatorAndRequestId();
      
      // Submit to the gateway
      const submissionResult = await submitCommitment(gatewayUrl, commitment);
      
      // Store both the commitment and result
      submissions.push({
        commitment,
        result: null,  // Will store the proof result later
        submissionResult
      });
    }
    
    // Now wait for all inclusion proofs with proper retries
    console.log('\n=== Checking for inclusion proofs ===');
    
    for (let i = 0; i < submissions.length; i++) {
      const submission = submissions[i];
      const commitment = submission.commitment;
      console.log(`Checking proof for request ID: ${commitment.requestId.substring(0, 10)}...`);
      
      // Try up to 10 times with increasing delays
      const maxRetries = 10;
      let proofFound = false;
      
      for (let retry = 0; retry < maxRetries && !proofFound; retry++) {
        // Shorter backoff: 1s, 2s, 3s, 5s, 8s, 10s, 10s, 10s, 10s, 10s
        const delays = [1000, 2000, 3000, 5000, 8000, 10000, 10000, 10000, 10000, 10000];
        const delay = delays[retry];
        
        // Don't show waiting message on first try
        if (retry > 0) {
          console.log(`Retrying... (${retry+1}/${maxRetries})`);
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
        
        try {
          // Pass the original RequestId object for verification
          const result = await getInclusionProof(gatewayUrl, commitment.requestId, commitment.requestIdObj);
          
          if (result && result.result !== null) {
            proofFound = true;
            // Store the result in the submission tracking
            submission.result = result;
            
            // Print verification summary
            console.log(`\n✅ Proof found for request ID: ${commitment.requestId.substring(0, 10)}...`);
            console.log(`📋 VERIFICATION SUMMARY:`);
            
            // Path verification result
            if (result.pathVerification) {
              const pathValid = result.pathVerification.isPathValid;
              const pathIncluded = result.pathVerification.isPathIncluded;
              console.log(`- Merkle path valid: ${pathValid ? 'Yes ✅' : 'No ❌'}`);
              console.log(`- Request included in tree: ${pathIncluded ? 'Yes ✅' : 'No ❌'}`);
            } else {
              console.log(`- Merkle path verification: Failed ❌`);
            }
            
            // Transaction hash match
            console.log(`- Transaction hash matches: ${result.txHashMatches ? 'Yes ✅' : 'No ❌'}`);
            
            // Fix application
            if (result.fixApplied) {
              console.log(`- Applied '0000' prefix fix: Yes ✅`);
            }
            
            // Authenticator verification result
            console.log(`- Authenticator verification: ${result.authVerification ? 'Success ✅' : 'Failed ❌'}`);
            
            // Overall status
            const overallSuccess = 
              result.pathVerification?.isPathValid && 
              result.pathVerification?.isPathIncluded && 
              result.txHashMatches && 
              result.authVerification;
            
            console.log(`\nOVERALL RESULT: ${overallSuccess ? 'SUCCESS ✅' : 'FAILED ❌'}`);
            
            if (!overallSuccess) {
              if (!result.authVerification) {
                console.log(`- Reason: Authenticator verification failed`);
              } else if (!result.txHashMatches) {
                console.log(`- Reason: Transaction hash mismatch`);
              } else if (!result.pathVerification?.isPathValid) {
                console.log(`- Reason: Invalid Merkle path`);
              } else if (!result.pathVerification?.isPathIncluded) {
                console.log(`- Reason: Request not included in Merkle tree`);
              }
              
              // Show detailed debugging information when verification fails
              console.log(`\n📌 DETAILED DEBUG INFO (VERIFICATION FAILURE):`);
              
              // What we sent
              console.log(`\nSENT TO GATEWAY:`);
              console.log(`- Request ID: ${commitment.requestId}`);
              console.log(`- Transaction Hash: ${commitment.transactionHash}`);
              console.log(`- Authenticator Public Key: ${commitment.authenticator.publicKey}`);
              console.log(`- Authenticator State Hash: ${commitment.authenticator.stateHash}`);
              console.log(`- Authenticator Signature: ${commitment.authenticator.signature.substring(0, 32)}...`);
              
              // What we received
              const receivedData = result.result || result;
              console.log(`\nRECEIVED FROM GATEWAY (after prefix fix if applied):`);
              if (receivedData.transactionHash) {
                console.log(`- Transaction Hash: ${receivedData.transactionHash}`);
              }
              
              if (receivedData.authenticator) {
                console.log(`- Authenticator Public Key: ${receivedData.authenticator.publicKey}`);
                console.log(`- Authenticator State Hash: ${receivedData.authenticator.stateHash}`);
                console.log(`- Authenticator Signature: ${receivedData.authenticator.signature.substring(0, 32)}...`);
              }
              
              // For merkle path debug info
              if (result.pathVerification) {
                console.log(`\nMERKLE PATH VERIFICATION DETAILS:`);
                console.log(`- Path Valid: ${result.pathVerification.isPathValid}`);
                console.log(`- Path Included: ${result.pathVerification.isPathIncluded}`);
                
                // If we have access to the merkle path details
                if (receivedData.merkleTreePath) {
                  console.log(`- Root: ${receivedData.merkleTreePath.root || 'N/A'}`);
                  console.log(`- Steps: ${Array.isArray(receivedData.merkleTreePath.steps) ? receivedData.merkleTreePath.steps.length : 0} steps`);
                }
              }
            }
            
            break; // Exit the retry loop if proof is found
          }
        } catch (e) {
          // Just continue with retries
        }
      }
      
      if (!proofFound) {
        console.log(`❌ No proof found for request ID: ${commitment.requestId.substring(0, 10)}... after ${maxRetries} retries`);
      }
    }
    
    console.log('\n=== FINAL SUMMARY ===');
    
    // Count the results
    const totalSubmissions = submissions.length;
    const successfulSubmissions = submissions.filter(s => s.submissionResult && !s.submissionResult.error).length;
    const proofFound = submissions.filter(s => s.result && (s.result.result !== null)).length;
    
    // Successful verifications - all aspects must succeed
    const successfulVerifications = submissions.filter(s => 
      s.result && 
      s.result.authVerification && 
      s.result.pathVerification?.isPathValid && 
      s.result.pathVerification?.isPathIncluded &&
      s.result.txHashMatches
    ).length;
    
    // Count fixes applied
    const fixesApplied = submissions.filter(s => s.result && s.result.fixApplied).length;
    
    // Final statistics
    console.log(`Total commitments: ${totalSubmissions}`);
    console.log(`Successful submissions: ${successfulSubmissions}`);
    console.log(`Proofs found: ${proofFound}`);
    console.log(`Successful verifications: ${successfulVerifications}`);
    
    if (fixesApplied > 0) {
      console.log(`"0000" prefix fixes applied: ${fixesApplied}`);
    }
    
    // Overall success or failure
    if (successfulVerifications === totalSubmissions) {
      console.log(`\n✅ SUCCESS: All commitments were verified successfully`);
      if (fixesApplied > 0) {
        console.log(`Note: The "0000" prefix fix was applied to ${fixesApplied} transaction hashes to ensure successful verification`);
      }
    } else {
      console.log(`\n❌ FAILED: ${totalSubmissions - successfulVerifications} commitments could not be fully verified`);
      
      // Explain failure reasons
      const failures = submissions.filter(s => 
        !s.result || 
        !s.result.authVerification || 
        !s.result.pathVerification?.isPathValid || 
        !s.result.pathVerification?.isPathIncluded ||
        !s.result.txHashMatches
      );
      
      if (failures.length > 0) {
        console.log(`\nFailure reasons:`);
        const noProof = failures.filter(s => !s.result || s.result.result === null).length;
        const authFailed = failures.filter(s => s.result && s.result.result !== null && !s.result.authVerification).length;
        const pathFailed = failures.filter(s => s.result && s.result.result !== null && 
          (!s.result.pathVerification?.isPathValid || !s.result.pathVerification?.isPathIncluded)).length;
        const hashMismatch = failures.filter(s => s.result && s.result.result !== null && !s.result.txHashMatches).length;
        
        if (noProof > 0) console.log(`- No proof found: ${noProof}`);
        if (authFailed > 0) console.log(`- Authenticator verification failed: ${authFailed}`);
        if (pathFailed > 0) console.log(`- Merkle path verification failed: ${pathFailed}`);
        if (hashMismatch > 0) console.log(`- Transaction hash mismatch: ${hashMismatch}`);
      }
    }
  } catch (error) {
    console.error('Unhandled error:', error);
    process.exit(1);
  }
}

main().catch(console.error);