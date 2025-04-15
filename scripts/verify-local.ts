#!/usr/bin/env ts-node
/**
 * Local commitment verification test script
 * This script generates a commitment locally and verifies it without sending to the gateway
 */

import { 
  SigningService, 
  DataHasher, 
  HashAlgorithm, 
  DataHash, 
  Authenticator, 
  RequestId 
} from '../ts-client/node_modules/@unicitylabs/commons/lib/index.js';

async function main() {
  console.log('=== Local Commitment Verification Test ===');
  
  // 1. Generate a signing key
  console.log('\n1. Generating signing key...');
  const privateKey = SigningService.generatePrivateKey();
  const signingService = new SigningService(privateKey);
  const publicKey = signingService.publicKey;
  
  console.log(`Private key: ${Buffer.from(privateKey).toString('hex').substring(0, 16)}...`);
  console.log(`Public key: ${Buffer.from(publicKey).toString('hex').substring(0, 16)}...`);
  console.log(`Public key length: ${Buffer.from(publicKey).length} bytes`);
  
  // 2. Create a random transaction hash and state hash
  console.log('\n2. Creating random hashes...');
  const randomData1 = crypto.getRandomValues(new Uint8Array(32));
  const transactionHash = await new DataHasher(HashAlgorithm.SHA256).update(randomData1).digest();
  console.log(`Transaction hash: ${Buffer.from(transactionHash.imprint).toString('hex').substring(0, 16)}...`);
  
  const randomData2 = crypto.getRandomValues(new Uint8Array(32));
  const stateHash = await new DataHasher(HashAlgorithm.SHA256).update(randomData2).digest();
  console.log(`State hash: ${Buffer.from(stateHash.imprint).toString('hex').substring(0, 16)}...`);
  
  // 3. Create an authenticator
  console.log('\n3. Creating authenticator...');
  const authenticator = await Authenticator.create(signingService, transactionHash, stateHash);
  console.log('Authenticator created successfully');
  
  const authDto = authenticator.toDto();
  console.log(`Authenticator DTO:`);
  console.log(`- Public key: ${authDto.publicKey.substring(0, 16)}...`);
  console.log(`- State hash: ${authDto.stateHash.substring(0, 16)}...`);
  console.log(`- Signature: ${authDto.signature.substring(0, 16)}...`);
  console.log(`- Signature length: ${authDto.signature.length / 2} bytes`);
  
  // 4. Create a request ID
  console.log('\n4. Creating request ID...');
  const requestId = await RequestId.create(publicKey, stateHash);
  const requestIdHex = Buffer.from(requestId.hash.imprint).toString('hex');
  console.log(`Request ID: ${requestIdHex.substring(0, 16)}...`);
  
  // 5. Debug signing and verification
  console.log('\n5. Testing authenticator verification...');
  
  // First, try to verify the authenticator
  const isValid = await authenticator.verify(transactionHash);
  console.log(`Direct authenticator verification result: ${isValid ? 'VALID ✅' : 'INVALID ❌'}`);
  
  // Manually recreate what happens during verification
  console.log('\nDebugging authenticator verification:');
  try {
    // Re-create authenticator from DTO 
    console.log('Re-creating authenticator from DTO...');
    const recreatedAuth = Authenticator.fromDto(authDto);
    
    // Try verification again
    const reVerified = await recreatedAuth.verify(transactionHash);
    console.log(`Re-created authenticator verification: ${reVerified ? 'VALID ✅' : 'INVALID ❌'}`);
    
    // Now create a commitment that would be submitted to the gateway
    const commitment = {
      requestId: requestIdHex,
      transactionHash: Buffer.from(transactionHash.imprint).toString('hex'),
      authenticator: authenticator.toDto()
    };
    
    console.log('\nLocal commitment that would be sent to gateway:');
    console.log(`- Request ID: ${commitment.requestId.substring(0, 16)}...`);
    console.log(`- Transaction hash: ${commitment.transactionHash.substring(0, 16)}...`);
    console.log(`- Authenticator signature: ${commitment.authenticator.signature.substring(0, 16)}...`);
    
    // Create a simulated gateway response (exactly what we'd get back from the gateway)
    console.log('\nVerifying the authenticator from the simulated gateway response:');
    
    // Convert the DTO back to an authenticator (just like the gateway would return it)
    const responseAuth = Authenticator.fromDto(commitment.authenticator);
    const responseTxHash = DataHash.fromDto(commitment.transactionHash);
    
    // Verify the authenticator
    const responseVerified = await responseAuth.verify(responseTxHash);
    console.log(`Verification using exactly what we sent: ${responseVerified ? 'VALID ✅' : 'INVALID ❌'}`);
  } catch (e) {
    console.error('Error during re-verification:', e);
  }
  
  console.log('\n=== Test completed ===');
}

// Run the main function
main().catch(console.error);