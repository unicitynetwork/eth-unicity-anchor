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

  console.log(`Created commitment with request ID: ${requestIdHex}`);
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

//    console.log(" ### DEBUG: "+JSON.stringify(commitment, null, 4));

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

      console.log(`- RequestId: ${requestId}`);
      console.log(`- Transaction Hash: ${proofData.transactionHash}`);
      if (proofData.merkleTreePath) {
        console.log(`- Merkle Tree Root: ${proofData.merkleTreePath.root}`);
        console.log(`- Merkle Tree Steps: ${JSON.stringify(proofData.merkleTreePath.steps)}`);
      }

      // Check and fix transaction hash prefix before creating the InclusionProof
/*      if (proofData.transactionHash && !proofData.transactionHash.startsWith('0000')) {
        proofData.transactionHash = '0000' + proofData.transactionHash;
        fixApplied = true;
      }

      // Check and fix authenticator state hash prefix if needed
      if (proofData.authenticator && proofData.authenticator.stateHash &&
          !proofData.authenticator.stateHash.startsWith('0000')) {
        proofData.authenticator.stateHash = '0000' + proofData.authenticator.stateHash;
        fixApplied = true;
      }
*/
      // Convert the proof data (with fixed hash) to an InclusionProof object
      let proof;
      try {
        proof = InclusionProof.fromDto(proofData);
      } catch (error) {
        throw error;
      }

      // Create a RequestId object from the request ID string
      const requestIdObj = origRequestIdObj || await RequestId.fromDto(requestId);

      let verificationResult;
      let authVerification;
      let authMatchesPath;
      let pathVerification;

      try {
        // Convert request ID to BigInt for Merkle tree verification
        const requestIdBigInt = requestIdObj.toBigInt();


        // Perform authenticator verification
        try {
          authVerification = await proof.authenticator.verify(proof.transactionHash);
//	    console.log(" ### DEBUG authVerification: "+authVerification);
        } catch (authError) {
	  console.error("authError: "+authError);
          authVerification = false;
        }
	try {
	    const calculatedRequestId = await proof.authenticator.calculateRequestId();
	    authMatchesPath = requestIdObj.equals(calculatedRequestId);
	    console.log("requestIdObj: "+requestIdObj.toDto());
	    console.log("calculatedRequestId: "+calculatedRequestId.toDto());
	} catch(authMatchesErr){
	    console.error("authMatchesErr: "+authMatchesErr);
	    authMatchesPath=false;
	}

        // Verify the merkle tree path
        try {
          pathVerification = await proof.merkleTreePath.verify(requestIdBigInt);
//            console.log(" ### DEBUG pathVerification: "+JSON.stringify(pathVerification));

            const textEncoder = new TextEncoder();
          const leafValue = await new DataHasher(HashAlgorithm.SHA256)
              .update(textEncoder.encode(JSON.stringify(proof.authenticator.toDto())))
              .update(proof.transactionHash.imprint)
              .digest();

          // Store proper values (ensure they are booleans) in the result
          pathVerification = {
            isPathValid: pathVerification.isPathValid === true,
            isPathIncluded: pathVerification.isPathIncluded === true,
            isLeafValueValid: Buffer.from(leafValue.imprint).toString('hex') === Buffer.from(proof.merkleTreePath.steps.at(0).value).toString('hex')
          };

        } catch (pathError) {
	  console.error("pathError: "+pathError);
          // Create a failed pathVerification result
          pathVerification = {
            isPathValid: false,
            isPathIncluded: false,
            isLeafValueValid: false,
            error: pathError.message
          };
        }

      } catch (verifyError) {
	console.error("verifyError: "+verifyError);
        return {
          ...response.data,
          verificationError: verifyError.message,
        };
      }

      // Return result with verification data
      return {
        ...response.data,
        fixApplied,
        authVerification,
	authMatchesPath,
        pathVerification,
      };
    } catch (parseError) {
      console.error("parseError: "+parseError);
      return {
        ...response.data,
        error: parseError.message
      };
    }
  } catch (error: any) {
    console.error("Unexpected generic error: "+error);
    // 404 means the proof is not yet available - this is not normal. We must get non-inclusion proof instead!!!
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
      console.log(`\n*** COMMITMENT ${commitment.requestId} ***`);
      console.log(commitment);

      // Submit to the gateway
      const submissionResult = await submitCommitment(gatewayUrl, commitment);

      console.log(`\n*** RESPONCE ${commitment.requestId} ***`);
      console.log(submissionResult);

      // Store both the commitment and result
      submissions.push({
        commitment,
        result: null,  // Will store the proof result later
        submissionResult,
        success: false  // Will be set to true if verification succeeds
      });
    }

    // Now wait for all inclusion proofs with proper retries
    console.log('\n=== Checking for inclusion proofs ===');

    for (let i = 0; i < submissions.length; i++) {
      const submission = submissions[i];
      const commitment = submission.commitment;
      console.log(`Checking proof for request ID: ${commitment.requestId}...`);

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

            // Print basic verification summary
            console.log(`\n✅ Proof found for request ID: ${commitment.requestId}...`);
	    console.log(`\n*** INCLUSION PROOF ${commitment.requestId} ***`);
    	    console.log(JSON.stringify(result, null, 4));

            console.log(`📋 VERIFICATION SUMMARY:`);

            try {
              // Show if fixes were applied
              if (result.fixApplied) {
                console.log(`- Applied '0000' prefix fix to hashes: Yes ✅`);
              }

              const txHashMatches = commitment.transactionHash === result.transactionHash;

              // Overall result
              const overallSuccess = txHashMatches && result.pathVerification.isPathValid && result.pathVerification.isPathIncluded && result.pathVerification.isLeafValueValid && result.authVerification && result.authMatchesPath;
              console.log(`\nOVERALL RESULT: ${overallSuccess ? 'SUCCESS ✅' : 'FAILED ❌'}`);

              // Count this as a success for summary
              if (overallSuccess) {
                submission.success = true;
              }

              // Show reason for failure
              if (!overallSuccess) {
                if (!result.pathVerification.isPathValid) {
                  console.error('Reason: Invalid path');
                } else if (!result.pathVerification.isPathIncluded) {
                  console.error('Reason: Path is not included');
                } else if (!result.pathVerification.isLeafValueValid) {
                  console.error('Reason: Leaf value mismatch');
                } else if (!txHashMatches) {
                  console.error(`- Reason: Transaction hash mismatch`);
                } else if (!result.authVerification) {
                    console.error(`- Reason: Authenticator verification failed`);
                } else if (!result.authMatchesPath) {
                    console.error(`- Reason: Authenticator authenticates wrong requestId`);
                }
              }
            } catch (error) {
              console.log(`Error in verification summary: ${error.message}`);
            }

            break; // Exit the retry loop if proof is found
          }
        } catch (e) {
          // Just continue with retries
        }
      }

      if (!proofFound) {
        console.log(`❌ No proof found for request ID: ${commitment.requestId}... after ${maxRetries} retries`);
      }
    }

    console.log('\n=== FINAL SUMMARY ===');

    // Count the results
    const totalSubmissions = submissions.length;
    const successfulSubmissions = submissions.filter(s => s.submissionResult && !s.submissionResult.error).length;
    const proofFound = submissions.filter(s => s.result && (s.result.result !== null)).length;

    // Count successful verifications based on the success flag
    const successfulVerifications = submissions.filter(s => s.success === true).length;

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
        console.log(`Note: The "0000" prefix fix was applied to transaction hashes and/or state hashes in ${fixesApplied} proofs to ensure successful verification`);
      }
    } else {
      console.log(`\n❌ FAILED: ${totalSubmissions - successfulVerifications} commitments could not be fully verified`);

      // Count failures by category
      const noProof = submissions.filter(s => !s.result || s.result.result === null).length;
      const verificationFailed = totalSubmissions - successfulVerifications - noProof;

      if (noProof > 0 || verificationFailed > 0) {
        console.log(`\nFailure reasons:`);

        if (noProof > 0) console.log(`- No proof found: ${noProof}`);
        if (verificationFailed > 0) console.log(`- Verification failed: ${verificationFailed}`);
      }
    }
  } catch (error) {
    console.error('Unhandled error:', error);
    process.exit(1);
  }
}

main().catch(console.error);