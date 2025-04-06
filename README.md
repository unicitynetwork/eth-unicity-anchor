# Ethereum Unicity Anchor

A decentralized commitment management system that ensures consensus on the state of submitted data through a batch processing mechanism and aggregator voting.

## Overview

The Ethereum Unicity Anchor provides a trustless framework for processing user commitments with guaranteed consistency across all participants. It enables multiple trusted aggregator services to collect, process, and verify commitment requests in an orderly, immutable manner.

### Key Features:

- **Decentralized Commitment Management**: Secure submission and storage of user commitments
- **Batch Processing**: Efficient organization of commitments into sequential batches
- **Consensus Mechanism**: Multi-aggregator voting system for hashroot verification
- **Immutability Guarantees**: Once processed, commitments cannot be modified
- **Sequential Processing**: Strict ordering of batch processing to maintain data consistency

## System Architecture

The system operates through three main components:

1. **User Submissions**: Users submit commitment requests through aggregator gateway services
2. **Aggregator Gateways**: Trusted services that validate and forward commitments to the smart contract
3. **Smart Contract**: Manages commitment storage, batch creation, and consensus verification

### Workflow:

```
User → Aggregator Gateway → Smart Contract (storage) → Batch Creation 
    → Aggregator Processing → Hashroot Consensus → Verified Batch
```

## Smart Contracts

### IAggregatorBatches

An interface defining the commitment management and batch processing API:

- Submit and retrieve commitment requests
- Create and manage batches of commitments
- Submit and verify hashroots through aggregator consensus
- Track batch processing status

### AggregatorBatches

The implementation provides:

- Efficient storage of commitment data
- Rules for commitment modification and immutability
- Sequential batch processing mechanisms
- Consensus voting system for hashroot verification
- Administrative functions for system management

## Development

This project uses [Foundry](https://book.getfoundry.sh/) for Ethereum smart contract development.

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation.html)

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Setup

```bash
# Clone the repository
git clone <repository-url>
cd eth_unicity_anchor

# Install dependencies
forge install

# Build the project
forge build
```

### Testing

```bash
# Run all tests
forge test

# Run tests with verbosity for detailed output
forge test -vvv

# Run a specific test
forge test --match-test testFunctionName

# Generate gas report
forge test --gas-report
```

### Deployment

1. Create a deployment script in the `script` directory (if not already present)
2. Configure your RPC endpoint and account
3. Run the deployment script:

```bash
# Deploy to testnet
forge script script/AggregatorBatches.s.sol --rpc-url <testnet-rpc-url> --private-key <your-private-key> --broadcast

# Deploy to mainnet (with confirmation)
forge script script/AggregatorBatches.s.sol --rpc-url <mainnet-rpc-url> --private-key <your-private-key> --broadcast --verify
```

## Documentation

For detailed documentation:
- See the `docs/` directory for comprehensive specifications
- Review code comments for implementation details
- Run `forge doc` to generate documentation from NatSpec comments

## Contributing

Contributions are welcome:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests to ensure functionality
5. Submit a pull request

## License

This project is licensed under the UNLICENSED License.
