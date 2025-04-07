# TODO List for Ethereum Unicity Anchor

## TypeScript Unit Tests

The following unit tests need to be fixed to complete test coverage:

### Client Tests (`ts-client/tests/client.test.ts`)

- Fix the ethers mocking approach to work with Jest
- The current mocking approach results in "Cannot read properties of undefined" errors
- Primary issue is with `ethers.JsonRpcProvider` not being correctly mocked

### Aggregator Gateway Tests (`ts-client/tests/aggregator-gateway.test.ts`)

- Fix type conversion issues with string/BigInt parameters
- Update mock implementation to handle string inputs correctly
- Fix timeout issues in timer-based tests:
  - `should create a batch when threshold is reached`
  - `should not create a batch when threshold is not reached`

### Aggregator Node Tests (`ts-client/tests/aggregator-node.test.ts`)

- Fix type conversion issues with string/BigInt parameters
- Fix timeout issues in timer-based tests
- Adjust mock implementation for merkle proof generation to distinguish between existing and non-existent requests

## Test Infrastructure

- Create Jest setup file to configure longer timeouts for timer-based tests
- Add more robust mocking utilities for ethers library
- Create shared test fixtures for all test files

## Additional TypeScript Client Improvements

- Increase test coverage to at least 80% for all files
- Add more comprehensive error handling tests
- Implement proper type checking in convertBatchToDto and convertDtoToBatch
- Better handling of BigInt to string conversions

## CI Pipeline Enhancements

- Re-enable full unit test suite once fixes are implemented
- Add performance metrics collection to CI
- Set up test coverage reporting with minimum thresholds

## Documentation

- Document mocking approach for TypeScript tests
- Add examples of proper test case implementation
- Document test utilities and helper functions

The items are prioritized with the TypeScript unit test fixes being the most important to complete first.