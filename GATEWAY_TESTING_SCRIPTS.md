# Gateway Testing Scripts

This document provides an overview of the various gateway testing scripts developed for the Ethereum Unicity Anchor project. These scripts are used for testing different aspects of the gateway functionality, particularly focusing on authenticator verification.

## Main Testing Scripts

| File | Description | Status |
|------|-------------|--------|
| `scripts/test-gateway.js` | JavaScript implementation of the gateway test that submits commitments and polls for inclusion proofs. Modified to handle authenticator verification with "0000" prefix fix. | Production-ready |
| `ts-client/src/test-gateway.ts` | TypeScript implementation with enhanced error handling, polling mechanisms and improved diagnostics. Includes "0000" prefix fix for authenticator verification. | Production-ready |
| `scripts/test-gateway-e2e.sh` | Shell script that sets up a complete end-to-end testing environment including starting an Anvil node, deploying contracts, and running tests. | Production-ready |

## Authenticator Verification Debugging Tools

| File | Description | Status |
|------|-------------|--------|
| `scripts/verify-proof.ts` | Specialized tool for verifying an inclusion proof for a given request ID. Tests prefix handling and provides detailed verification diagnostics. | Debug tool |
| `scripts/verify-local.ts` | Creates and verifies a local authenticator without sending to gateway to establish a baseline for correct verification. | Debug tool |
| `scripts/compare-auth.ts` | Compares a locally-generated authenticator with one returned from the gateway to identify format differences. | Debug tool |
| `scripts/mimick-gateway.ts` | Creates mock authenticators in gateway format to test and isolate the root cause of verification failures. | Debug tool |

## Gateway Server Tools

| File | Description | Status |
|------|-------------|--------|
| `start-gateway.js` | Starts a local gateway server for development and testing. | Utility |
| `ts-client/src/simple-gateway-test.js` | Simplified gateway implementation with in-memory storage for quick functional tests. | Example code |
| `ts-client/src/gateway-test.ts` | TypeScript implementation of a test client that works with the gateway server. | Utility |

## Issue Summary

The key issue addressed in these scripts was the authenticator verification failure. This was caused by:

1. **"0000" SHA-256 prefix handling**: The gateway returns transaction hashes without the "0000" SHA-256 hash algorithm prefix, but the verification libraries expect this prefix to be present.

2. **Signature format difference**: There are minor differences in how signatures are formatted between local and gateway-returned authenticators.

The primary fix that resolves the issue is adding the "0000" prefix to transaction hashes received from the gateway before performing verification.

## File Organization Recommendations

- **Keep in repository**:
  - `scripts/test-gateway.js`
  - `ts-client/src/test-gateway.ts`
  - `scripts/test-gateway-e2e.sh`
  - `start-gateway.js`

- **Move to examples or tools directory**:
  - `scripts/verify-proof.ts`
  - `scripts/compare-auth.ts`
  - `scripts/mimick-gateway.ts`
  - `scripts/verify-local.ts`

- **Consider removing when production-ready**:
  - `ts-client/src/simple-gateway-test.js` (replace with proper examples)

For details on the authenticator verification fix implementation, see the [AUTHENTICATOR_VERIFICATION_GUIDE.md](./docs/AUTHENTICATOR_VERIFICATION_GUIDE.md).