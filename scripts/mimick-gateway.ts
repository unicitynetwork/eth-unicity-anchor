#!/usr/bin/env ts-node
/**
 * Gateway format mimic test
 * This script creates a mock authenticator using the same format as the gateway
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
  console.log('=== Gateway Format Mimicking Test ===');
  
  // 1. Create a local authenticator
  console.log('\n1. Creating local authenticator...');
  const privateKey = SigningService.generatePrivateKey();
  const signingService = new SigningService(privateKey);
  const publicKey = signingService.publicKey;
  
  // Create random transaction hash and state hash
  const randomData1 = new Uint8Array(32);
  crypto.getRandomValues(randomData1);
  const transactionHash = await new DataHasher(HashAlgorithm.SHA256).update(randomData1).digest();
  
  const randomData2 = new Uint8Array(32);
  crypto.getRandomValues(randomData2);
  const stateHash = await new DataHasher(HashAlgorithm.SHA256).update(randomData2).digest();
  
  // Create an authenticator
  const localAuth = await Authenticator.create(signingService, transactionHash, stateHash);
  const localAuthDto = localAuth.toDto();
  
  console.log('Local authenticator created:');
  console.log(JSON.stringify(localAuthDto, null, 2));
  
  // Create a request ID
  const requestId = await RequestId.create(publicKey, stateHash);
  
  // Verify the local authenticator
  const localVerified = await localAuth.verify(transactionHash);
  console.log(`Local authenticator verification: ${localVerified ? 'VALID ✅' : 'INVALID ❌'}`);
  
  // 2. Create a gateway-style authenticator
  console.log('\n2. Creating gateway-style authenticator...');
  
  // Modify the state hash to remove the prefix
  const stateHashWithoutPrefix = localAuthDto.stateHash.startsWith('0000') 
    ? localAuthDto.stateHash.substring(4) 
    : localAuthDto.stateHash;
  
  // Modify the signature to change the last byte
  let gatewaySignature = localAuthDto.signature;
  if (gatewaySignature.endsWith('01')) {
    gatewaySignature = gatewaySignature.substring(0, gatewaySignature.length - 2) + '00';
  } else if (gatewaySignature.endsWith('00')) {
    gatewaySignature = gatewaySignature.substring(0, gatewaySignature.length - 2) + '01';
  }
  
  // Create the gateway-style DTO
  const gatewayAuthDto = {
    algorithm: localAuthDto.algorithm,
    publicKey: localAuthDto.publicKey,
    signature: gatewaySignature,
    stateHash: stateHashWithoutPrefix
  };
  
  console.log('Gateway-style authenticator:');
  console.log(JSON.stringify(gatewayAuthDto, null, 2));
  
  // 3. Try to create and verify an authenticator from the gateway-style DTO
  console.log('\n3. Creating authenticator from gateway-style DTO...');
  
  try {
    const gatewayAuth = Authenticator.fromDto(gatewayAuthDto);
    const gatewayTxHash = transactionHash; // Use the same transaction hash
    
    console.log('Successfully created authenticator from gateway-style DTO');
    
    // Try to verify it
    const gatewayVerified = await gatewayAuth.verify(gatewayTxHash);
    console.log(`Gateway-style authenticator verification: ${gatewayVerified ? 'VALID ✅' : 'INVALID ❌'}`);
    
    // 4. Try to create our authenticators in gateway format from the start
    console.log('\n4. Creating authenticator directly in gateway format...');
    
    // Create a new state hash without the prefix
    const newStateData = new Uint8Array(32);
    crypto.getRandomValues(newStateData);
    const newStateHash = await new DataHasher(HashAlgorithm.SHA256).update(newStateData).digest();
    const newStateHashHex = Buffer.from(newStateHash.imprint).toString('hex');
    const newStateHashNoPrefix = newStateHashHex.startsWith('0000') 
      ? newStateHashHex.substring(4) 
      : newStateHashHex;
    
    // Create a new transaction hash
    const newTxData = new Uint8Array(32);
    crypto.getRandomValues(newTxData);
    const newTxHash = await new DataHasher(HashAlgorithm.SHA256).update(newTxData).digest();
    
    // Create a state hash like the gateway would have
    console.log('Creating state hash for gateway format...');
    const stateHashObj = await new DataHasher(HashAlgorithm.SHA256).update(newStateData).digest();
    
    // Create an authenticator 
    console.log('Creating authenticator...');
    const newAuth = await Authenticator.create(signingService, newTxHash, stateHashObj);
    
    // Now modify the DTO to match gateway format
    const originalDto = newAuth.toDto();
    const modifiedDto = {
      ...originalDto,
      stateHash: originalDto.stateHash.startsWith('0000') 
        ? originalDto.stateHash.substring(4) 
        : originalDto.stateHash,
      signature: originalDto.signature.endsWith('01')
        ? originalDto.signature.substring(0, originalDto.signature.length - 2) + '00'
        : originalDto.signature
    };
    console.log('Original DTO:');
    console.log(JSON.stringify(originalDto, null, 2));
    
    console.log('Modified DTO (gateway format):');
    console.log(JSON.stringify(modifiedDto, null, 2));
    
    // Verify the original authenticator
    const originalVerified = await newAuth.verify(newTxHash);
    console.log(`Original authenticator verification: ${originalVerified ? 'VALID ✅' : 'INVALID ❌'}`);
    
    // Create an authenticator from the modified DTO and verify it
    const gatewayStyleAuth = Authenticator.fromDto(modifiedDto);
    const gatewayStyleVerified = await gatewayStyleAuth.verify(newTxHash);
    console.log(`Gateway-style authenticator verification: ${gatewayStyleVerified ? 'VALID ✅' : 'INVALID ❌'}`);
    
    // Now try with the transaction hash in the same format as the gateway returns it
    console.log('\n5. Verifying using gateway-style transaction hash...');
    const txHashHex = Buffer.from(newTxHash.imprint).toString('hex');
    const txHashWithoutPrefix = txHashHex.startsWith('0000') 
      ? txHashHex.substring(4) 
      : txHashHex;
      
    console.log(`Original tx hash: ${txHashHex}`);
    console.log(`Gateway-style tx hash: ${txHashWithoutPrefix}`);
    
    // Create a DataHash from the modified tx hash
    try {
      const gatewayTxHash = DataHash.fromDto(txHashWithoutPrefix);
      const fakeGatewayVerified = await gatewayStyleAuth.verify(gatewayTxHash);
      console.log(`Verification with gateway-style tx hash: ${fakeGatewayVerified ? 'VALID ✅' : 'INVALID ❌'}`);
      
      // Now fix it by adding the prefix back to the transaction hash
      console.log('\n6. Fixing the gateway response...');
      const fixedTxHash = DataHash.fromDto('0000' + txHashWithoutPrefix);
      const fixedVerified = await gatewayStyleAuth.verify(fixedTxHash);
      console.log(`Verification with fixed tx hash: ${fixedVerified ? 'VALID ✅' : 'INVALID ❌'}`);
      
      // Build a complete response like what the gateway would return
      console.log('\n7. Creating a complete gateway-style response...');
      const gatewayResponse = {
        authenticator: modifiedDto,
        transactionHash: txHashWithoutPrefix,
        merkleTreePath: {
          root: "0000e1bf83b08167e51813f45094b7e992f6a689b367ad38f7db64b3721a4bde151a",
          steps: []
        }
      };
      
      console.log('Gateway-style response:');
      console.log(JSON.stringify(gatewayResponse, null, 2));
      
      // What we would need to do to fix it
      console.log('\n8. Fix steps to verify gateway response:');
      console.log('1. Parse authenticator from response: Authenticator.fromDto(response.authenticator)');
      console.log('2. Parse transaction hash from response: DataHash.fromDto("0000" + response.transactionHash)');
      console.log('3. Verify: authenticator.verify(transactionHash)');
    } catch (e) {
      console.error('Error with gateway-style tx hash:', e);
    }
  } catch (e) {
    console.error('Error creating or verifying authenticator:', e);
  }
  
  console.log('\n=== Test complete ===');
}

main().catch(console.error);