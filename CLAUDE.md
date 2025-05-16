# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Session Summary (2025-04-26)

We've been working on fixing issues with the Ethereum Unicity Anchor gateway implementation, focusing on:

1. Correcting requestId handling as bytes sequences (not BigInt)
2. Implementing proper SMT (Sparse Merkle Tree) integration for inclusion proof generation

Key files modified:
- `/ts-client/src/aggregator-node-smt.ts`: Implemented persistent SMT with proper leaf generation
- `/ts-client/src/aggregator-gateway.ts`: Fixed submitCommitment for bytes-based requestIds
- `/ts-client/src/abi.ts`: Updated function signatures to use bytes instead of uint256
- `/ts-client/src/run-gateway-server.ts`: Updated get_inclusion_proof handler to use SMT directly

Next steps:
- Implement storage for original request data (authenticator and tx hash) 
- Update inclusion proof generation to include complete data
- Run integration tests to verify end-to-end functionality

# Ethereum Unicity Anchor Project Guidelines

## Solidity Commands
- Build: `forge build` or `forge build --via-ir` (optimized)
- Run all tests: `forge test`
- Run single test: `forge test --match-test testFunctionName`
- Debug tests: `forge test -vvv --match-test testFunctionName`
- Gas report: `forge test --gas-report`
- Coverage: `forge coverage` or `forge coverage --report lcov` (detailed)
- Format code: `forge fmt`
- Deploy: `forge script script/AggregatorBatches.s.sol --rpc-url <RPC_URL> --broadcast`

## TypeScript Client Commands
- Build: `cd ts-client && npm run build`
- Unit tests: `cd ts-client && npm run test:unit`
- Single test: `cd ts-client && npm test -- -t "test name pattern"`
- Integration tests: `cd ts-client && npm run test:integration`
- All tests: `cd ts-client && npm run test:all`
- Test utils only: `cd ts-client && npm run test:utils`
- Test coverage: `cd ts-client && npm run test:coverage`
- Lint: `cd ts-client && npm run lint`
- Format code: `cd ts-client && npm run format`
- Run node: `npm run node` (starts local Anvil node)
- Swagger docs: `cd ts-client && npm run swagger` or `npm run swagger:build`
- Gateway server: `CONTRACT_ADDRESS=0x... GATEWAY_PORT=3000 node start-gateway.js`
- Gateway testing: `./scripts/test-gateway-e2e.sh`

## Debug/Verification Commands
- Verify proof: `NODE_OPTIONS=--experimental-specifier-resolution=node ts-node --esm scripts/verify-proof.ts`
- Compare authenticators: `ts-node --esm scripts/compare-auth.ts`
- Mimick gateway: `ts-node --esm scripts/mimick-gateway.ts`
- Verify local: `ts-node --esm scripts/verify-local.ts`
- Test gateway CLI: `npm run test:gateway`

## CI/CD Commands
- Local test workflow: `./scripts/run-ci-locally.sh --workflow=test`
- Docker isolated tests: `./scripts/run-ci-in-docker.sh --workflow=test`
- E2E testing: `./scripts/manual-e2e-test.sh`
- Batch testing: `./run-batch-test.sh`
- Performance testing: `./run-perf-test.sh`
- Sync testing: `./scripts/sync-test.sh`

## Project Architecture
- **Batch Processing**: Commitments follow submission → batching → processing lifecycle
- **SMT Integration**: Uses Sparse Merkle Trees for efficient inclusion proofs
- **Aggregator System**: Multiple aggregators provide consensus for critical operations
- **Batch Numbering**: Supports both explicit and auto-incrementing batch numbers

## Code Style Guidelines
- **Solidity**: 
  - Use pragma ^0.8.13+, custom errors, detailed NatSpec comments for all functions
  - Storage variables should be grouped by related functionality with comments
  - Implement BytesSet pattern for handling arbitrary length bytes
  - Use modifiers for access control and validation; emit events for state changes

- **Structure**: License → Pragma → Imports (external first) → Interfaces → Libraries → Contracts
- **Functions**: Order by visibility (external → public → internal → private)
- **Naming**: 
  - PascalCase: Contracts, interfaces, libraries, events, types, structs
  - camelCase: Functions, arguments, local variables, methods, properties
  - UPPER_CASE: Constants, immutables
  - Prefix interface names with "I" (e.g., IAggregatorBatches)

- **TypeScript**: 
  - Strong typing (avoid `any`), async/await (prefer over promises)
  - Use TypeScript's type system fully: interfaces, type aliases, generics
  - Node engine: >= 20.0.0, use ethers v6 for blockchain interactions
  - Utility functions should be pure and extensively tested
  - Follow functional programming principles where appropriate
  - Format: 2 space indentation, 100 chars line length, single quotes, trailing commas
  
- **Error Handling**:
  - Solidity: Custom errors with descriptive names and parameters
  - TypeScript: Try/catch with specific error types, avoid generic catches
  - Include proper error reporting and logging
  - Use detailed console logging for important operations

- **Security**: 
  - Follow OpenZeppelin patterns and use their libraries
  - Validate all inputs with require statements or custom errors
  - Include proper access control for all sensitive functions
  - Use multiple aggregator consensus for critical operations
  - Implement comprehensive validation when handling cryptographic operations