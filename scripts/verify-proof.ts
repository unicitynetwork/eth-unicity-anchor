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

  const requestId = process.argv[2];
  console.log(`Verifying proof for request ID: ${requestId}`);

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
    
    // Create a RequestId object
    const reqIdObj = RequestId.fromDto(requestId);
    console.log('Created RequestId object');
    
    // Get the BigInt form of the RequestId
    const reqIdBigInt = (await reqIdObj).toBigInt();
    console.log(`RequestId as BigInt: ${reqIdBigInt}`);
    
    // Verify the authenticator
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
    
    console.log('\nVerification complete! ✅');
  } catch (error) {
    console.error('Error verifying proof:', error);
    process.exit(1);
  }
}

main().catch(console.error);