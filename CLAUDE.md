# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Ethereum Unicity Anchor Project Guidelines

## Solidity Commands
- Build: `forge build`
- Run all tests: `forge test`
- Run single test: `forge test --match-test testFunctionName`
- Debug tests: `forge test -vvv --match-test testFunctionName`
- Gas report: `forge test --gas-report`
- Coverage: `forge coverage`
- Deploy: `forge script script/AggregatorBatches.s.sol --rpc-url <RPC_URL> --broadcast`

## TypeScript Client Commands
- Build: `cd ts-client && npm run build`
- Unit tests: `cd ts-client && npm run test:unit`
- Single test: `cd ts-client && npm test -- -t "test name pattern"`
- Integration tests: `cd ts-client && npm run test:integration`
- All tests: `cd ts-client && npm run test:all`
- Lint: `cd ts-client && npm run lint`
- Format code: `cd ts-client && npm run format`

## CI/CD Commands
- Local test workflow: `./scripts/run-ci-locally.sh --workflow=test`
- Docker isolated tests: `./scripts/run-ci-in-docker.sh --workflow=test`
- E2E testing: `./scripts/manual-e2e-test.sh`
- Batch testing: `./run-batch-test.sh`
- Performance testing: `./run-perf-test.sh`

## Code Style Guidelines
- **Solidity**: 
  - Use pragma ^0.8.13+, custom errors, NatSpec comments for all functions
  - Storage variables should be grouped by related functionality with comments
  - Use modifiers for access control and input validation
  - Add event emissions for important state changes

- **Structure**: License → Pragma → Imports (external first) → Interfaces → Libraries → Contracts
- **Functions**: Order by visibility (external → public → internal → private)
- **Naming**: 
  - PascalCase: Contracts, interfaces, libraries, events
  - camelCase: Functions, arguments, local variables
  - UPPER_CASE: Constants, immutables
  - Prefix interface names with "I" (e.g., IAggregatorBatches)

- **TypeScript**: 
  - Strong typing (no any), async/await (not promises), comprehensive test coverage
  - Use TypeScript's type system fully, including interfaces and type aliases
  - Node engine requirement: >= 20.0.0
  - Keep utility functions pure and well-tested
  
- **Security**: 
  - Follow OpenZeppelin patterns and use their libraries
  - Validate all inputs with require statements or custom errors
  - Include proper access control for all sensitive functions
  - Use multiple aggregator consensus for critical operations