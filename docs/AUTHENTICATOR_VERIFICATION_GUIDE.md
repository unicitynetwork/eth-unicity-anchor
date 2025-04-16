# Authenticator Verification Guide

This document explains the authenticator verification process for the Ethereum Unicity Anchor system and provides solutions for common verification issues.

## Understanding Authenticator Verification

An authenticator in the Unicity Anchor system contains three key components:
1. **Public Key**: The public key of the entity that created the commitment
2. **State Hash**: A hash representing the state at the time of signing
3. **Signature**: A cryptographic signature over the transaction hash and state hash

When verifying an authenticator, the system checks that the signature matches the transaction hash and was created by the owner of the specified public key.

## Common Verification Issues

### The "0000" Hash Algorithm Prefix Issue

The most common authenticator verification issue occurs because the gateway returns transaction hashes without the `0000` SHA-256 algorithm prefix, but the verification libraries expect this prefix to be present.

#### Symptoms:
- Locally created authenticators verify successfully
- Gateway-returned authenticators fail verification
- Merkle tree path verification works correctly
- The only difference is in the format of the transaction hash

#### Solution:

When processing authenticators from the gateway, add the `0000` prefix to the transaction hash:

```typescript
// Before verification, check if the transaction hash has the '0000' prefix
if (response.data.result.transactionHash && 
    !response.data.result.transactionHash.startsWith('0000')) {
  // Add the prefix if it's missing
  response.data.result.transactionHash = '0000' + response.data.result.transactionHash;
}
```

## Verification Workflow

1. **Local Authenticator Creation**:
   - Generate a key pair
   - Create a transaction hash and state hash
   - Sign them to create an authenticator
   - Verify locally (should succeed)

2. **Gateway Submission**:
   - Submit the commitment to the gateway
   - Retrieve the inclusion proof
   - The transaction hash in the response will be missing the '0000' prefix

3. **Verification Fix**:
   - Add the '0000' prefix to the transaction hash
   - Use the modified transaction hash for verification
   - Verify the authenticator (should now succeed)

## Testing Tools

The following scripts are available to test authenticator verification:

- `verify-local.ts`: Tests local authenticator creation and verification
- `compare-auth.ts`: Compares local vs. gateway authenticator formats
- `mimick-gateway.ts`: Creates authenticators in gateway format
- `verify-proof.ts`: Verifies specific inclusion proofs

## Implementation Details

The fix has been implemented in the following files:

1. `scripts/test-gateway.js`: Updates the `getInclusionProof` function to add the '0000' prefix
2. `ts-client/src/test-gateway.ts`: Updates both `getProof` and the final verification check to add the '0000' prefix

## Further Recommendations

1. Consider modifying the gateway to include the '0000' prefix in transaction hashes
2. Update the commons library to handle both formats gracefully
3. Add documentation to all verification-related code to explain this requirement
4. Include unit tests that verify both prefixed and non-prefixed hashes

## References

- [SHA-256 Hash Algorithm](https://en.wikipedia.org/wiki/SHA-2)
- [Algorithm Identifiers](https://tools.ietf.org/html/rfc5758)
- [@unicitylabs/commons Library](https://github.com/unicitylabs/commons)