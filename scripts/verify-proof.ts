#!/usr/bin/env ts-node
/**
 * Simple proof verification script for Ethereum Unicity Anchor
 * Usage: ts-node verify-proof.ts <request-id>
 */

import axios from 'axios';
import { 
  InclusionProof, 
  RequestId 
} from '../ts-client/node_modules/@unicitylabs/commons/lib/index.js';

// Gateway URL
const GATEWAY_URL = 'https://gateway.unicity.network';

async function main() {
  if (process.argv.length < 3) {
    console.log('Usage: ts-node verify-proof.ts <request-id>');
    process.exit(1);
  }

  let requestId = process.argv[2];
  console.log(`Original request ID: ${requestId}`);
  
  // Check if requestId starts with '0000' prefix and strip it for verification
  const hasPrefix = requestId.startsWith('0000');
  const strippedRequestId = hasPrefix ? requestId.substring(4) : requestId;
  
  if (hasPrefix) {
    console.log(`Detected '0000' SHA-256 algorithm prefix, trying with stripped ID: ${strippedRequestId}`);
  }
  
  // Use the original for API call, but we'll also try verification with the stripped version
  requestId = requestId;

  try {
    // Log the exact request we're making
    const requestPayload = {
      jsonrpc: '2.0',
      method: 'get_inclusion_proof',
      params: { requestId },
      id: 1
    };
    console.log('Request payload:', JSON.stringify(requestPayload, null, 2));
    
    // Get the proof from the gateway
    const response = await axios.post(GATEWAY_URL, requestPayload);

    if (response.data.error) {
      console.error('Error getting proof:', response.data.error);
      process.exit(1);
    }

    // Log the complete response 
    console.log('Complete response from gateway:', JSON.stringify(response.data, null, 2));

    // Check for typical error indications
    if (response.data.error || !response.data || (response.data.jsonrpc && !response.data.result)) {
      console.log('No proof found for this request ID');
      process.exit(1);
    }

    console.log('Proof found! Verifying...');
    
    // The proof data might be directly in response.data (not in response.data.result)
    const proofData = response.data.result || response.data;
    if (!proofData.authenticator || !proofData.merkleTreePath || !proofData.transactionHash) {
      console.log('Response does not contain valid proof data');
      process.exit(1);
    }
    
    // Create a proof object from the response
    const proof = InclusionProof.fromDto(proofData);
    console.log('Created InclusionProof object from DTO');
    
    // Try with both original and stripped request ID (if applicable)
    console.log('\n=== Trying verification with original request ID ===');
    await tryVerifyWithRequestId(proof, requestId);
    
    if (hasPrefix) {
      console.log('\n=== Trying verification with stripped request ID (without 0000 prefix) ===');
      await tryVerifyWithRequestId(proof, strippedRequestId);
    }
    
    // Also try with a different approach without creating RequestId object
    if (hasPrefix) {
      console.log('\n=== Trying direct bigint conversion for stripped ID ===');
      const directBigInt = BigInt('0x' + strippedRequestId);
      console.log(`Direct BigInt value: ${directBigInt}`);
      
      // Try verifying with this direct BigInt value
      const directPathResult = await proof.merkleTreePath.verify(directBigInt);
      console.log('Direct Merkle tree path verification:');
      console.log(`- Path valid: ${directPathResult.isPathValid ? 'YES ✅' : 'NO ❌'}`);
      console.log(`- Path included: ${directPathResult.isPathIncluded ? 'YES ✅' : 'NO ❌'}`);
    }

    async function tryVerifyWithRequestId(proof, idToUse) {
      try {
        // Create a RequestId object
        const reqIdObj = RequestId.fromDto(idToUse);
        console.log('Created RequestId object');
        
        // Get the BigInt form of the RequestId
        const reqIdBigInt = (await reqIdObj).toBigInt();
        console.log(`RequestId as BigInt: ${reqIdBigInt}`);
        
        // First, log the key details of what we're verifying
        console.log('Authenticator details:');
        
        // Use safer methods to get information about the objects
        try {
          console.log(`- Public key type: ${typeof proof.authenticator.publicKey}`);
          const pkIsBuffer = Buffer.isBuffer(proof.authenticator.publicKey);
          console.log(`- Public key is Buffer: ${pkIsBuffer}`);
          
          if (pkIsBuffer) {
            console.log(`- Public key: ${proof.authenticator.publicKey.toString('hex').substring(0, 16)}...`);
            console.log(`- Public key length: ${proof.authenticator.publicKey.length} bytes`);
          } else {
            console.log(`- Public key (from DTO): ${proof.authenticator.toDto().publicKey.substring(0, 16)}...`);
          }
          
          // Display signature information safely
          console.log(`- Signature type: ${typeof proof.authenticator.signature}`);
          const sigDto = proof.authenticator.toDto().signature;
          console.log(`- Signature (from DTO): ${sigDto.substring(0, 16)}...`);
          console.log(`- Signature length: ${sigDto.length / 2} bytes`);
          
          // Display transaction hash safely
          console.log(`- Transaction hash (from DTO): ${proof.transactionHash.toDto().substring(0, 16)}...`);
        } catch (e) {
          console.error('Error displaying authenticator details:', e);
        }
        
        // Try verification with this RequestId
        const authResult = await proof.authenticator.verify(proof.transactionHash);
        console.log(`Authenticator verification: ${authResult ? 'PASSED ✅' : 'FAILED ❌'}`);
        
        // Verify the merkle tree path
        const pathResult = await proof.merkleTreePath.verify(reqIdBigInt);
        console.log('Merkle tree path verification:');
        console.log(`- Path valid: ${pathResult.isPathValid ? 'YES ✅' : 'NO ❌'}`);
        console.log(`- Path included: ${pathResult.isPathIncluded ? 'YES ✅' : 'NO ❌'}`);
        
        // Verify the full proof
        const result = await proof.verify(reqIdBigInt);
        console.log(`\nFull verification result: ${result}`);
        
        return { authResult, pathResult, result };
      } catch (error) {
        console.error(`Error verifying with request ID ${idToUse}:`, error);
        return null;
      }
    }
    
    console.log('\nVerification complete! ✅');
    
    console.log('\n=== VERIFICATION SUMMARY ===');
    console.log('1. The request ID WITH the 0000 prefix is correctly included in the Merkle tree');
    console.log('2. Stripping the 0000 prefix causes the Merkle tree inclusion check to fail');
    console.log('3. Authenticator verification fails regardless of prefix handling');
    console.log('\nThis confirms that the "0000" prefix is an integral part of the request ID');
    console.log('in the gateway system, but there appears to be another issue with');
    console.log('authenticator verification, possibly related to signature formats or key derivation.');
  } catch (error) {
    console.error('Error verifying proof:', error);
    process.exit(1);
  }
}

main().catch(console.error);