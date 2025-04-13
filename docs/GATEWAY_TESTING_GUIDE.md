# Ethereum Unicity Anchor: Gateway Testing Guide

This guide provides comprehensive instructions for testing and validating Ethereum Unicity Anchor Gateways using the provided CLI testing tools.

## Table of Contents

1. [Introduction](#1-introduction)
2. [Test Gateway CLI Tool](#2-test-gateway-cli-tool)
3. [Manual Testing Workflow](#3-manual-testing-workflow)
4. [Integration Testing](#4-integration-testing)
5. [Interpreting Test Results](#5-interpreting-test-results)
6. [Troubleshooting](#6-troubleshooting)

## 1. Introduction

The Ethereum Unicity Anchor Gateway is a critical component that accepts user commitment submissions and manages their inclusion in the SMT (Sparse Merkle Tree) through batch processing. The test tools provided in this repository help verify that gateways correctly:

- Accept commitment submissions
- Create batches
- Process batches with SMT implementation
- Generate valid inclusion proofs
- Provide appropriate non-inclusion and inclusion proofs via the API

## 2. Test Gateway CLI Tool

The Test Gateway CLI tool (`test-gateway.ts`) is designed to test gateway endpoints by:

1. Sending random commitment requests
2. Polling for inclusion proofs
3. Verifying the validity of these proofs
4. Reporting detailed results

### Installation

The test tool is part of the TypeScript client package:

```bash
cd ts-client
npm install
npm run build
```

### Usage

```bash
npx ts-node src/test-gateway.ts <gateway-url> [options]
```

#### Arguments

- `gateway-url`: URL of the gateway endpoint (e.g., http://localhost:3000)

#### Options

- `--count, -c N`: Number of commitments to send (default: 1)
- `--attempts, -a N`: Maximum polling attempts (default: 20)
- `--interval, -i N`: Polling interval in seconds (default: 2)
- `--timeout, -t N`: Maximum total polling time in seconds (default: 120)
- `--verbose, -v`: Enable verbose output
- `--help, -h`: Show help message

#### Example

```bash
# Basic test with default options
npx ts-node src/test-gateway.ts http://localhost:3000

# Send 5 commitments with 30 second timeout
npx ts-node src/test-gateway.ts http://localhost:3000 --count 5 --timeout 30

# Verbose mode with shorter polling interval
npx ts-node src/test-gateway.ts http://localhost:3000 --verbose --interval 1
```

### Exit Codes

The tool returns different exit codes to indicate test status:

- `0`: All tests passed successfully
- `1`: Submission failures occurred
- `2`: Some commitments are pending (not yet included in processed batches)
- `3`: Proof verification failures occurred

## 3. Manual Testing Workflow

For manual gateway testing, follow these steps:

1. **Start the gateway service** you wish to test

2. **Run the test tool**:
   ```bash
   npx ts-node src/test-gateway.ts http://your-gateway-url --verbose
   ```

3. **Monitor the output** as the tool:
   - Submits random commitments
   - Polls for inclusion proofs
   - Verifies returned proofs

4. **Check the final report** with statistics on:
   - Successful submissions
   - Proofs found
   - Proofs verified
   - Pending commitments

5. **Check the result JSON file** saved in the current directory:
   ```
   gateway-test-results-TIMESTAMP.json
   ```

## 4. Integration Testing

For more extensive testing with a local setup, use the provided script:

```bash
# Run gateway e2e tests with default settings
./scripts/manual-e2e-test.sh gateway

# Specify number of commitments
./scripts/manual-e2e-test.sh gateway 5
```

This script:
1. Starts a local Ethereum node (Anvil)
2. Deploys the AggregatorBatches contract
3. Runs a local gateway server with automatic batch processing
4. Executes test-gateway.ts against this server
5. Reports results

## 5. Interpreting Test Results

The test tool provides several metrics to evaluate gateway performance:

- **Submission Success Rate**: Percentage of successfully submitted commitments
- **Proof Retrieval Success**: Rate at which inclusion proofs were successfully retrieved
- **Proof Verification**: Rate at which proofs passed cryptographic verification
- **End-to-End Response Time**: Time from submission to proof verification

### Success Criteria

A properly functioning gateway should exhibit:

1. 100% successful submissions
2. 100% inclusion proof retrieval (given sufficient polling time)
3. 100% proof verification
4. Response times within expected parameters

### Non-Inclusion vs. Inclusion Proofs

The tool differentiates between:

- **Non-Inclusion Proofs**: Commitments exist but aren't yet in a processed batch
- **Inclusion Proofs**: Commitments are included in a processed batch with a valid hashroot

## 6. Troubleshooting

### Common Issues

#### Proof Verification Failures

- **Status "PENDING"**: Batch containing commitment hasn't been processed yet
- **Missing hashroot**: Batch processing didn't complete successfully
- **Invalid proof structure**: Gateway may not be properly implementing SMT

#### Gateway Connectivity

- **Connection refused**: Gateway not running or wrong URL
- **Authentication failures**: Check if auth headers are required

#### Contract Interaction

- **Batch creation failures**: Ensure gateway has sufficient gas and permissions
- **Processing delays**: Check gateway batch creation/processing configuration

### Logs and Debugging

For more detailed logs, use:

```bash
# Enable verbose mode
npx ts-node src/test-gateway.ts http://localhost:3000 --verbose
```

Detailed test results are also saved to a JSON file in the current directory.