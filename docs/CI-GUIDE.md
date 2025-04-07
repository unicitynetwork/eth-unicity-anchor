# CI/CD Guide for Ethereum Unicity Anchor

This guide provides information about the Continuous Integration (CI) and Continuous Deployment (CD) setup for the Ethereum Unicity Anchor project.

## Table of Contents

1. [CI Workflows](#ci-workflows)
2. [Running Tests Locally](#running-tests-locally)
3. [Test Coverage](#test-coverage)
4. [Pull Request Workflow](#pull-request-workflow)
5. [Debugging CI Failures](#debugging-ci-failures)

## CI Workflows

The project uses GitHub Actions for CI with two main workflows:

### 1. Regular CI (On Pull Request and Push)

**Workflow File:** `.github/workflows/test.yml`

This workflow runs on:
- Pushes to `main` and `develop` branches
- Pull requests targeting `main` and `develop` branches
- Manual trigger via workflow_dispatch

It consists of the following jobs:

- **Code Quality Checks**
  - Formats Solidity code
  - Checks for build errors

- **Smart Contract Tests**
  - Runs all Solidity tests with Foundry
  - Generates code coverage reports

- **TypeScript Client Tests**
  - Runs linting on TypeScript code
  - Runs unit tests with Jest
  - Generates code coverage reports

- **Integration Tests** (Only on main branch, PRs to main, or manual triggers)
  - Runs end-to-end tests with actual contract deployment
  - Uploads logs as artifacts

### 2. Nightly Build and Tests

**Workflow File:** `.github/workflows/nightly.yml`

This workflow runs:
- Every day at midnight UTC
- Manual trigger via workflow_dispatch

It runs the same jobs as the regular CI but is more comprehensive:
- Always includes integration tests
- Generates a summary report
- Monitors for regressions in test coverage

## Running Tests Locally

You can run the same tests locally that are run in the CI:

### Smart Contract Tests

```bash
# Build all contracts
forge build

# Run all tests
forge test

# Run a specific test
forge test --match-test testFunctionName

# Run with verbosity
forge test -vvv

# Run with gas report
forge test --gas-report

# Generate coverage report
forge coverage
```

### TypeScript Client Tests

```bash
# Navigate to ts-client directory
cd ts-client

# Install dependencies
npm install

# Run linting
npm run lint

# Run unit tests
npm test

# Run with coverage
npm test -- --coverage

# Run a specific test file
npm test -- tests/client.test.ts
```

### Integration Tests

```bash
# Run the complete end-to-end test
./scripts/manual-e2e-test.sh

# For manual testing with more control
./scripts/start-node-and-deploy.sh
# Then in another terminal:
cd ts-client
CONTRACT_ADDRESS=<address_from_previous_step> npm run test:integration
```

## Test Coverage

The project uses Codecov to track test coverage. Coverage reports are uploaded automatically by CI workflows.

- **Target Coverage:**
  - Smart Contracts: 80%
  - TypeScript Client: 70%

To view coverage reports locally:

- Solidity: Run `forge coverage` and check the generated report
- TypeScript: Run `npm test -- --coverage` in the ts-client directory and check the `coverage` folder

## Pull Request Workflow

1. Create a new branch from `develop`
2. Make your changes
3. Run tests locally
4. Create a pull request to `develop`
5. Wait for CI to complete and fix any issues
6. After review and approval, the PR will be merged
7. When ready for release, `develop` will be merged to `main`

## Debugging CI Failures

If the CI workflow fails:

1. Check the workflow log on GitHub Actions
2. Download artifacts for more detailed logs
3. Try to reproduce the issue locally
4. Common issues:
   - Test timeouts: Integration tests might time out if the Anvil node takes too long to respond
   - Coverage thresholds: PRs might fail if they decrease coverage below the threshold

For integration test issues, try running with more verbosity:

```bash
VERBOSE=true ./scripts/manual-e2e-test.sh
```

## CI Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Codecov Documentation](https://docs.codecov.io/docs)
- [Foundry Test Documentation](https://book.getfoundry.sh/forge/tests)
- [Jest Test Framework](https://jestjs.io/docs/getting-started)