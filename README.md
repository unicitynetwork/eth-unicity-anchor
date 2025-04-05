# Ethereum Unicity Anchor

This repository contains Ethereum smart contracts for the Unicity Network's anchor system, which allows for batch processing of commitment requests through trusted aggregators.

## Overview

The Unicity Aggregator Batches system manages:
- Collection of commitment requests from trusted aggregator gateway services
- Organization of requests into batches for processing
- SMT (Sparse Merkle Tree) hashroot consensus between aggregators
- Verification of processed batches

## Architecture

The system consists of the following key components:

1. **IAggregatorBatches Interface**: Defines the core functionality for commitment request submission, batch creation, and hashroot consensus.

2. **AggregatorBatches Implementation**: Provides the concrete implementation with:
   - Commitment request storage and management
   - Batch creation and processing
   - Aggregator voting mechanism
   - Administrative functions

## Smart Contracts

### IAggregatorBatches

An interface defining the core functionality for managing commitment requests and batches:

- Submit commitment requests with unique request IDs, payloads, and authenticators
- Create batches from unprocessed commitment requests
- Retrieve batch information and status
- Submit and track hashroot consensus

### AggregatorBatches

The implementation of the IAggregatorBatches interface with:

- Storage for commitment requests and batches
- Trusted aggregator management
- Consensus mechanism for batch processing
- Administrative functions for system management

## Development

This project uses the [Foundry](https://book.getfoundry.sh/) development environment for Ethereum.

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation.html)

### Setup

```bash
# Clone the repository
git clone https://github.com/unicitynetwork/eth_unicity_anchor.git
cd eth_unicity_anchor

# Install dependencies
forge install

# Build the project
forge build

# Run tests
forge test
```

## Foundry Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Deploy

```shell
$ forge script script/AggregatorBatchesScript.s.sol:AggregatorBatchesScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

### Help

```shell
$ forge --help
```

## License

This project is licensed under the UNLICENSED License.
