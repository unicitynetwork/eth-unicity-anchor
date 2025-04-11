import { 
  AggregatorGateway,
  AuthMethod,
  SubmitCommitmentStatus,
  BatchSubmissionDto,
  CommitmentRequestDto,
  DataHash,
  RequestId,
  Authenticator,
  Commitment
} from '../src';
import { ethers } from 'ethers';
import crypto from 'crypto';

// Example of using the enhanced AggregatorGateway with authentication

async function main() {
  // 1. Create an enhanced gateway with API key authentication
  const gateway = new AggregatorGateway({
    providerUrl: 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY',
    contractAddress: '0x1234567890123456789012345678901234567890',
    privateKey: 'YOUR_PRIVATE_KEY',
    gatewayAddress: '0xYOUR_GATEWAY_ADDRESS',
    autoCreateBatches: true,
    authMethod: AuthMethod.API_KEY,
    apiKeys: {
      'testkey123': {
        name: 'Test API Key',
        role: 'submitter',
        permissions: ['batch:submit', 'batch:read']
      }
    },
    // Optionally configure other auth methods
    jwtSecret: 'your-jwt-secret-key',
    trustedSigners: ['0xYourTrustedSignerAddress']
  });

  console.log('AggregatorGateway initialized with authentication');

  // 2. Example: Single commitment submission (compatible with aggregators_net interface)
  const singleResult = await gateway.submitCommitment({
    requestId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    authenticator: {
      publicKey: '0x1111111111111111111111111111111111111111111111111111111111111111',
      stateHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
      signature: '0x3333333333333333333333333333333333333333333333333333333333333333'
    }
  });

  console.log('Single commitment submission result:', singleResult);

  // 3. Example: Multiple commitments in one call (new method)
  const multipleCommitments = [
    {
      requestId: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      transactionHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      authenticator: {
        publicKey: '0x1111111111111111111111111111111111111111111111111111111111111111',
        stateHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
        signature: '0x3333333333333333333333333333333333333333333333333333333333333333'
      }
    },
    {
      requestId: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      transactionHash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      authenticator: {
        publicKey: '0x4444444444444444444444444444444444444444444444444444444444444444',
        stateHash: '0x5555555555555555555555555555555555555555555555555555555555555555',
        signature: '0x6666666666666666666666666666666666666666666666666666666666666666'
      }
    }
  ];

  const multiResult = await gateway.submitMultipleCommitments(
    multipleCommitments,
    { apiKey: 'testkey123' }
  );

  console.log('Multiple commitments submission result:', multiResult);

  // 4. Example: Entire batch submission in one call (new method)
  const batchToSubmit: BatchSubmissionDto = {
    commitments: [
      {
        requestID: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        payload: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        authenticator: '0x111111111111111111111111111111111111111111111111111111111111111122222222222222222222222222222222222222222222222222222222222222223333333333333333333333333333333333333333333333333333333333333333'
      },
      {
        requestID: '0x9999999999999999999999999999999999999999999999999999999999999999',
        payload: '0x8888888888888888888888888888888888888888888888888888888888888888', 
        authenticator: '0x444444444444444444444444444444444444444444444444444444444444444455555555555555555555555555555555555555555555555555555555555555556666666666666666666666666666666666666666666666666666666666666666'
      }
    ],
    apiKey: 'testkey123'
  };

  const batchResult = await gateway.submitBatch(
    batchToSubmit,
    { apiKey: 'testkey123' }
  );

  console.log('Batch submission result:', batchResult);

  // 5. Example: Ethereum signature authentication
  const wallet = ethers.Wallet.createRandom();
  console.log('Test wallet address:', wallet.address);

  const message = `Submit batch to aggregator. Timestamp: ${Date.now()}`;
  const signature = await wallet.signMessage(message);

  // Assuming the wallet address is in the trusted signers list
  const ethAuthResult = await gateway.submitBatch(
    batchToSubmit,
    { 
      signature: {
        message,
        signature,
        signer: wallet.address
      } 
    }
  );

  console.log('Ethereum signature authentication result:', ethAuthResult);

  // 6. Example: Getting inclusion proof
  const inclusionProof = await gateway.getInclusionProof(
    '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
  );

  console.log('Inclusion proof:', inclusionProof);
}

// Run the example
main().catch(error => {
  console.error('Error in example:', error);
});