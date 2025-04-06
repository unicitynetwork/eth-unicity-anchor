# Ethereum Unicity Anchor: Deployment Guide

This guide provides detailed instructions for deploying the Ethereum Unicity Anchor system to different networks, configuring the contract parameters, and verifying the deployment.

## 1. Prerequisites

Before deploying the contract, ensure you have:

- [Foundry](https://book.getfoundry.sh/) installed and updated
- An Ethereum wallet with sufficient ETH for deployment
- RPC URL for the target network
- Addresses of trusted aggregators

## 2. Environment Setup

### 2.1 Configure Environment Variables

Create a `.env` file in the project root with the following variables:

```
PRIVATE_KEY=your_private_key_here
ETHEREUM_RPC_URL=your_rpc_url_here
ETHERSCAN_API_KEY=your_etherscan_api_key  # For contract verification
```

Load the environment variables:

```bash
source .env
```

### 2.2 Customize Deployment Parameters

Update the `script/AggregatorBatches.s.sol` file with your desired configuration:

```solidity
// Replace these with actual trusted aggregator addresses
trustedAggregators[0] = address(0x1111111111111111111111111111111111111111);
trustedAggregators[1] = address(0x2222222222222222222222222222222222222222);
trustedAggregators[2] = address(0x3333333333333333333333333333333333333333);

// Adjust the required votes threshold as needed
AggregatorBatches aggregator = new AggregatorBatches(trustedAggregators, 2);
```

## 3. Deployment Process

### 3.1 Testnet Deployment

Deploy to a testnet first for testing:

```bash
# Deploy to Sepolia testnet
forge script script/AggregatorBatches.s.sol:AggregatorBatchesScript \
  --rpc-url $ETHEREUM_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  -vvv
```

### 3.2 Mainnet Deployment

For production deployment:

```bash
# Deploy to Ethereum mainnet
forge script script/AggregatorBatches.s.sol:AggregatorBatchesScript \
  --rpc-url $ETHEREUM_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  -vvv
```

### 3.3 Contract Verification

If the automatic verification fails, verify manually:

```bash
forge verify-contract \
  --chain-id <chain_id> \
  --compiler-version <compiler_version> \
  --constructor-args $(cast abi-encode "constructor(address[],uint256)" "[$TRUSTED_AGGREGATORS]" "$REQUIRED_VOTES") \
  <deployed_address> \
  src/AggregatorBatches.sol:AggregatorBatches \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

## 4. Post-Deployment Configuration

### 4.1 Administrative Setup

After deployment, you may need to adjust the contract settings:

1. **Add Additional Aggregators**:
   ```solidity
   // Call from owner account
   aggregator.addAggregator(newAggregatorAddress);
   ```

2. **Update Required Votes**:
   ```solidity
   // Call from owner account
   aggregator.updateRequiredVotes(newThreshold);
   ```

3. **Transfer Ownership** (if needed):
   ```solidity
   // Call from owner account
   aggregator.transferOwnership(newOwnerAddress);
   ```

### 4.2 Verify Contract Parameters

Confirm the contract has been configured correctly:

```bash
# Get current aggregator information
cast call <contract_address> "getLatestBatchNumber()" --rpc-url $ETHEREUM_RPC_URL
cast call <contract_address> "getLatestProcessedBatchNumber()" --rpc-url $ETHEREUM_RPC_URL
```

## 5. Multi-Environment Deployment

### 5.1 Multiple Network Configuration

Create configuration files for different networks:

```bash
# Create network-specific configuration
mkdir -p deployments/networks
touch deployments/networks/mainnet.json
touch deployments/networks/sepolia.json
```

Example network configuration file:

```json
{
  "rpc_url": "https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY",
  "chain_id": 1,
  "trusted_aggregators": [
    "0x...",
    "0x...",
    "0x..."
  ],
  "required_votes": 2,
  "deployed_address": null
}
```

### 5.2 Deployment Record

After successful deployment, update the configuration with the deployed address:

```json
{
  "deployed_address": "0x1234...",
  "deployment_tx": "0xabcd...",
  "deployment_block": 12345678,
  "deployment_timestamp": "2023-06-15T14:30:00Z"
}
```

## 6. Security Best Practices

### 6.1 Secure Key Management

- Use hardware wallets for mainnet deployments
- Consider multi-signature wallets for contract ownership
- Never commit private keys to version control

### 6.2 Deployment Checklist

Before deploying to mainnet:

- [ ] All tests pass (`forge test -vvv`)
- [ ] Contract has been audited
- [ ] Aggregator addresses are correct
- [ ] Required votes threshold is appropriate (not too low, not too high)
- [ ] Sufficient ETH for deployment and gas
- [ ] Testnet deployment has been thoroughly tested

### 6.3 Monitoring Setup

Configure monitoring after deployment:

1. Set up alerts for:
   - BatchCreated events
   - BatchProcessed events
   - Ownership transfers

2. Monitor gas usage trends

3. Track system metrics:
   - Number of unprocessed commitments
   - Batch processing time
   - Consensus time

## 7. Upgradeability Considerations

The current contract implementation is not upgradeable. If upgrades are needed:

1. Deploy a new version of the contract
2. Migrate required state from the old contract
3. Update external systems to point to the new contract

For future versions, consider implementing a proxy pattern for upgradability.

## 8. Common Deployment Issues

### 8.1 Gas Limit Errors

If you encounter gas limit errors:

```bash
# Adjust gas limit for deployment
forge script script/AggregatorBatches.s.sol:AggregatorBatchesScript \
  --gas-limit 5000000 \
  --rpc-url $ETHEREUM_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast
```

### 8.2 Nonce Management

If you need to manually set the nonce:

```bash
# Set custom nonce for deployment
forge script script/AggregatorBatches.s.sol:AggregatorBatchesScript \
  --nonce <nonce_value> \
  --rpc-url $ETHEREUM_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast
```

## 9. Post-Deployment Testing

Verify the deployed contract is functioning correctly:

```bash
# Test commitment submission
cast send <contract_address> "submitCommitment(uint256,bytes,bytes)" \
  1 0x1234 0x5678 \
  --rpc-url $ETHEREUM_RPC_URL \
  --private-key $AGGREGATOR_PRIVATE_KEY

# Create a batch
cast send <contract_address> "createBatch()" \
  --rpc-url $ETHEREUM_RPC_URL \
  --private-key $AGGREGATOR_PRIVATE_KEY

# Verify batch creation
cast call <contract_address> "getLatestBatchNumber()" \
  --rpc-url $ETHEREUM_RPC_URL
```

## 10. Troubleshooting

### 10.1 Contract Creation Reverted

If contract creation reverts:

1. Check constructor arguments are valid
2. Ensure you have sufficient ETH for deployment
3. Check gas limit and price settings

### 10.2 Verification Failures

If contract verification fails:

1. Ensure compiler version matches exactly
2. Check constructor arguments are encoded correctly
3. Verify flattened contract if needed

```bash
# Flatten contract for manual verification
forge flatten src/AggregatorBatches.sol > AggregatorBatches_flat.sol
```