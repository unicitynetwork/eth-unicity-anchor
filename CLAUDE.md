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
- Integration tests: `npm run test:integration`
- Lint: `cd ts-client && npm run lint`

## CI/CD Commands
- Local test workflow: `./scripts/run-ci-locally.sh --workflow=test`
- Docker isolated tests: `./scripts/run-ci-in-docker.sh --workflow=test`
- E2E testing: `./scripts/manual-e2e-test.sh`

## Code Style Guidelines
- **Solidity**: Use pragma ^0.8.13+, custom errors, NatSpec comments
- **Structure**: License → Pragma → Imports (external first) → Interfaces → Libraries → Contracts
- **Functions**: Order by visibility (external → public → internal → private)
- **Naming**: 
  - PascalCase: Contracts, interfaces, libraries, events
  - camelCase: Functions, arguments, local variables
  - UPPER_CASE: Constants, immutables
- **TypeScript**: Strong typing (no any), async/await (not promises), comprehensive test coverage
- **Security**: Follow OpenZeppelin patterns, minimal use of unsafe operations, validate all inputs