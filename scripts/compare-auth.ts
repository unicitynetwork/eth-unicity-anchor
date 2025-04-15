#!/usr/bin/env ts-node
/**
 * Compare local authenticator with gateway response
 * This script submits a commitment to the gateway and compares the authenticator in the response
 */

import axios from 'axios';
import { 
  SigningService, 
  DataHasher, 
  HashAlgorithm, 
  DataHash, 
  Authenticator, 
  RequestId 
} from '../ts-client/node_modules/@unicitylabs/commons/lib/index.js';

// Gateway URL
const GATEWAY_URL = process.argv[2] || 'https://gateway.unicity.network';

async function main() {
  console.log(`=== Authenticator Comparison Test ===`);
  console.log(`Gateway URL: ${GATEWAY_URL}`);
  
  // 1. Generate a signing key
  console.log('\n1. Generating signing key...');
  const privateKey = SigningService.generatePrivateKey();
  const signingService = new SigningService(privateKey);
  const publicKey = signingService.publicKey;
  
  console.log(`Private key: ${Buffer.from(privateKey).toString('hex').substring(0, 16)}...`);
  console.log(`Public key: ${Buffer.from(publicKey).toString('hex').substring(0, 16)}...`);
  
  // 2. Create random hashes
  console.log('\n2. Creating random hashes...');
  const randomData1 = new Uint8Array(32);
  crypto.getRandomValues(randomData1);
  const transactionHash = await new DataHasher(HashAlgorithm.SHA256).update(randomData1).digest();
  const txHashHex = Buffer.from(transactionHash.imprint).toString('hex');
  console.log(`Transaction hash: ${txHashHex.substring(0, 16)}...`);
  
  const randomData2 = new Uint8Array(32);
  crypto.getRandomValues(randomData2);
  const stateHash = await new DataHasher(HashAlgorithm.SHA256).update(randomData2).digest();
  const stateHashHex = Buffer.from(stateHash.imprint).toString('hex');
  console.log(`State hash: ${stateHashHex.substring(0, 16)}...`);
  
  // 3. Create an authenticator
  console.log('\n3. Creating authenticator...');
  const authenticator = await Authenticator.create(signingService, transactionHash, stateHash);
  const authDto = authenticator.toDto();
  console.log('Authenticator created successfully:');
  console.log(`- Public key: ${authDto.publicKey.substring(0, 16)}...`);
  console.log(`- Signature: ${authDto.signature.substring(0, 16)}...`);
  
  // 4. Create request ID
  console.log('\n4. Creating request ID...');
  const requestId = await RequestId.create(publicKey, stateHash);
  const requestIdHex = Buffer.from(requestId.hash.imprint).toString('hex');
  console.log(`Request ID: ${requestIdHex.substring(0, 16)}...`);
  
  // 5. Verify the authenticator locally
  console.log('\n5. Verifying authenticator locally...');
  const isValid = await authenticator.verify(transactionHash);
  console.log(`Local verification result: ${isValid ? 'VALID ✅' : 'INVALID ❌'}`);
  
  // 6. Submit to gateway
  console.log('\n6. Submitting to gateway...');
  const commitment = {
    requestId: requestIdHex,
    transactionHash: txHashHex,
    authenticator: authDto
  };
  
  try {
    // Make submission
    const submitResponse = await axios.post(GATEWAY_URL, {
      jsonrpc: '2.0',
      method: 'submit_commitment',
      params: commitment,
      id: 1
    });
    
    console.log(`Submission response status: ${submitResponse.data.result?.status || 'Unknown'}`);
    
    // Wait longer for processing
    console.log('\nWaiting 10 seconds for processing...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Get inclusion proof
    console.log('\n7. Getting inclusion proof from gateway...');
    const proofResponse = await axios.post(GATEWAY_URL, {
      jsonrpc: '2.0',
      method: 'get_inclusion_proof',
      params: { requestId: requestIdHex },
      id: 1
    });
    
    if (!proofResponse.data.error && proofResponse.data.authenticator) {
      const responseAuth = proofResponse.data;
      
      console.log('\n8. Comparing authenticators:');
      console.log('--- Local authenticator ---');
      console.log(JSON.stringify(authDto, null, 2));
      console.log('--- Gateway authenticator ---');
      console.log(JSON.stringify(responseAuth.authenticator, null, 2));
      
      // Check if they're identical
      const pubKeyMatch = authDto.publicKey === responseAuth.authenticator.publicKey;
      const sigMatch = authDto.signature === responseAuth.authenticator.signature;
      const stateHashMatch = authDto.stateHash === responseAuth.authenticator.stateHash;
      
      console.log('\nComparison results:');
      console.log(`- Public key match: ${pubKeyMatch ? 'YES ✅' : 'NO ❌'}`);
      console.log(`- Signature match: ${sigMatch ? 'YES ✅' : 'NO ❌'}`);
      console.log(`- State hash match: ${stateHashMatch ? 'YES ✅' : 'NO ❌'}`);
      
      // Try to verify the authenticator from the response
      console.log('\n9. Verifying gateway authenticator...');
      try {
        const gatewayAuth = Authenticator.fromDto(responseAuth.authenticator);
        const gatewayTxHash = DataHash.fromDto(responseAuth.transactionHash);
        const gatewayVerified = await gatewayAuth.verify(gatewayTxHash);
        console.log(`Gateway authenticator verification: ${gatewayVerified ? 'VALID ✅' : 'INVALID ❌'}`);
      } catch (e) {
        console.error('Error verifying gateway authenticator:', e);
      }
      
      // Try to fix the state hash prefix and signature
      console.log('\n10. Attempting to fix the gateway authenticator...');
      try {
        // Create a corrected authenticator
        const fixedAuthDto = {
          ...responseAuth.authenticator,
          // Add the 0000 prefix back to the state hash if it's missing
          stateHash: responseAuth.authenticator.stateHash.startsWith('0000') 
            ? responseAuth.authenticator.stateHash 
            : '0000' + responseAuth.authenticator.stateHash,
          // Fix the signature if the last bytes are different
          signature: (responseAuth.authenticator.signature !== authDto.signature && 
                     responseAuth.authenticator.signature.length === authDto.signature.length) 
            ? authDto.signature  // Use our original signature
            : responseAuth.authenticator.signature
        };
        
        console.log('Fixed authenticator:');
        console.log(JSON.stringify(fixedAuthDto, null, 2));
        
        // Try to verify the fixed authenticator
        const fixedAuth = Authenticator.fromDto(fixedAuthDto);
        const responseTxHash = DataHash.fromDto(responseAuth.transactionHash);
        const fixedVerified = await fixedAuth.verify(responseTxHash);
        console.log(`Fixed authenticator verification: ${fixedVerified ? 'VALID ✅' : 'INVALID ❌'}`);
      } catch (e) {
        console.error('Error verifying fixed authenticator:', e);
      }
    } else {
      console.log('No proof found yet or error in response');
      console.log(JSON.stringify(proofResponse.data, null, 2));
    }
  } catch (e) {
    console.error('Error during gateway communication:', e);
  }
  
  console.log('\n=== Test complete ===');
}

main().catch(console.error);