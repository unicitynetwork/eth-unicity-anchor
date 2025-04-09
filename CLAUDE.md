# Foundry Smart Contract Project Guidelines

## Build & Test Commands
- Build all contracts: `forge build`
- Run all tests: `forge test`
- Run a single test: `forge test --match-test testFunctionName`
- Run tests with verbosity: `forge test -vvv`
- Gas report: `forge test --gas-report`
- Coverage report: `forge coverage`
- Deploy script: `forge script script/ScriptName.s.sol --rpc-url <RPC_URL> --broadcast`

## TypeScript Client Commands
- Build client: `cd ts-client && npm run build`
- All unit tests: `cd ts-client && npm run test:unit`
- Integration tests: `npm run test:integration`
- TypeScript lint: `cd ts-client && npm run lint`

## CI/CD Commands
- Run test workflow locally: `./scripts/run-ci-locally.sh --workflow=test`
- Run nightly workflow locally: `./scripts/run-ci-locally.sh --workflow=nightly`
- Run tests in Docker (isolated): `./scripts/run-ci-in-docker.sh --workflow=test`
- Show script usage: `./scripts/run-ci-locally.sh --help`

## Code Style Guidelines
- **Solidity Version**: Use pragma ^0.8.13 or higher
- **Imports**: Group external imports first, then internal imports
- **Contract Structure**: License -> Pragma -> Imports -> Interfaces -> Libraries -> Contracts
- **Naming**: 
  - Contracts/Libraries: PascalCase
  - Functions/Variables: camelCase
  - Constants: UPPER_CASE
- **Function Order**: External -> Public -> Internal -> Private
- **Error Handling**: Use custom errors instead of require statements with strings
- **Documentation**: NatSpec format for all public functions
- **Security**: Follow best practices from OpenZeppelin and Trail of Bits