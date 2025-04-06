# Ethereum Unicity Anchor: Comprehensive Specification

## 1. System Overview

The Ethereum Unicity Anchor is a smart contract system designed to provide a trustless, decentralized commitment submission and batch processing framework. It allows multiple authorized aggregator gateways to collect user commitment requests, organize them into sequential batches, and process them through a consensus mechanism that ensures all participants maintain a unified view of the commitment state and verification data.

## 2. Commitment Processing Flow

### 2.1 Commitment Request Submission

1. **User Submission**: 
   - Users submit their commitments through authorized aggregator gateway services
   - Each commitment consists of:
     - `requestID` (uint256): A unique identifier for the commitment
     - `payload` (bytes): The data payload (typically a hash of a transaction or document)
     - `authenticator` (bytes): A verification key or signature

2. **Commitment Validation**:
   - Aggregator gateways validate the commitments based on application-specific logic
   - Validated commitments are forwarded to the AggregatorBatches smart contract

3. **On-Chain Storage**:
   - The smart contract stores commitments in its global storage, maintaining:
     - All submitted commitments (processed and unprocessed)
     - A dedicated pool of unprocessed commitments awaiting batch inclusion

4. **Commitment Modification Rules**:
   - Commitments that have not yet been included in a batch can be modified
   - Once a commitment has been included in a batch, it cannot be modified
   - Exact duplicate submissions of already-processed commitments are silently ignored
   - Attempted modifications of already-processed commitments are rejected with an error

### 2.2 Batch Creation Process

1. **Batch Initialization**:
   - Trusted aggregator gateways can trigger batch creation in two ways:
     - Create a batch containing all currently unprocessed commitments
     - Create a batch with a specific subset of unprocessed commitments

2. **Batch Formation**:
   - Each new batch receives a sequential batch number
   - The batch stores only the request IDs of included commitments (not full data)
   - Included commitments are removed from the unprocessed pool
   - Commitments in batches are marked as processed to prevent further modification

3. **Sequential Ordering**:
   - Batches receive sequential numbers (1, 2, 3, ...)
   - Batches must be processed in sequential order without skipping
   - A new batch can be created before previous batches are fully processed

### 2.3 Batch Processing Workflow

1. **Aggregator Processing**:
   - Trusted aggregator services identify the next unprocessed batch
   - Each aggregator processes the batch commitments offline, typically by:
     - Generating a Sparse Merkle Tree (SMT) containing all commitments
     - Computing the new hashroot of the tree

2. **Hashroot Submission**:
   - Each aggregator submits their computed hashroot for the batch to the smart contract
   - Aggregators must process batches in sequential order
   - Each aggregator can submit only one hashroot per batch

3. **Consensus Mechanism**:
   - The smart contract tracks all submitted hashroots and their vote counts
   - When sufficient votes (configurable threshold) converge on the same hashroot:
     - The batch is marked as processed
     - The hashroot is officially assigned to the batch
     - The latest processed batch counter is updated
   - If aggregators submit different hashroots, consensus is reached when one hashroot receives sufficient votes

## 3. Data Model

### 3.1 Core Data Structures

```solidity
// Commitment Request
struct CommitmentRequest {
    uint256 requestID;      // Unique identifier
    bytes payload;          // Commitment data (typically a hash)
    bytes authenticator;    // Verification data
}

// Batch of Commitment Requests
struct Batch {
    uint256 batchNumber;    // Sequential batch identifier
    uint256[] requestIds;   // IDs of included commitments
    bytes hashroot;         // Consensus hashroot (when processed)
    bool processed;         // Processing status flag
}
```

### 3.2 Global State

1. **Commitment Storage**:
   - `mapping(uint256 => CommitmentRequest)`: All commitments, indexed by requestID
   - `EnumerableSet.UintSet`: Set of currently unprocessed commitment IDs

2. **Batch Tracking**:
   - `mapping(uint256 => Batch)`: All batches, indexed by batch number
   - `uint256 latestBatchNumber`: The highest batch number created
   - `uint256 latestProcessedBatchNumber`: The highest batch number processed

3. **Consensus Management**:
   - `mapping(address => bool)`: Authorized aggregator addresses
   - Vote tracking for each (batch, hashroot) combination
   - Hashroot registry for each batch

## 4. System Functionality

### 4.1 Core Functions

1. **Commitment Management**:
   - `submitCommitment(uint256 requestID, bytes calldata payload, bytes calldata authenticator)`
   - `getCommitment(uint256 requestID)`
   - Various functions to query unprocessed commitment pool

2. **Batch Operations**:
   - `createBatch()`: Create batch with all unprocessed commitments
   - `createBatchForRequests(uint256[] calldata requestIDs)`: Create batch with specified commitments
   - `getBatch(uint256 batchNumber)`: Retrieve full batch data
   - `getLatestBatchNumber()` and `getLatestProcessedBatchNumber()`

3. **Hashroot Consensus**:
   - `submitHashroot(uint256 batchNumber, bytes calldata hashroot)`
   - `getBatchHashroot(uint256 batchNumber)`
   - Functions to track hashroot votes and submissions

### 4.2 Administrative Functions

1. **Aggregator Management**:
   - Add and remove trusted aggregator addresses
   - Update the required vote threshold for consensus

2. **Ownership Controls**:
   - Transfer contract ownership
   - Only owner can modify system parameters

### 4.3 Event System

1. **Core Events**:
   - `RequestSubmitted(uint256 indexed requestID, bytes payload)`
   - `BatchCreated(uint256 indexed batchNumber, uint256 requestCount)`
   - `BatchProcessed(uint256 indexed batchNumber, bytes hashroot)`
   - `HashrootSubmitted(uint256 indexed batchNumber, address indexed aggregator, bytes hashroot)`

## 5. Security and Invariants

### 5.1 Key Security Guarantees

1. **Commitment Immutability**:
   - Once a commitment is included in a batch, its content cannot be modified
   - Prevents retroactive changes to commitments that may have already been relied upon

2. **Sequential Processing**:
   - Batches must be processed in strict numerical order
   - Prevents processing gaps or out-of-order processing that could lead to inconsistent state

3. **Consensus Requirements**:
   - Configurable threshold of aggregator votes required for hashroot acceptance
   - Prevents individual aggregators from dictating the official hashroot

4. **Access Controls**:
   - Only authorized aggregators can submit commitments and hashroots
   - Only contract owner can modify system configuration

### 5.2 System Invariants

1. **Commitment Handling**:
   - A commitment can only appear in one batch
   - A processed commitment maintains the same data forever

2. **Batch Progression**:
   - `latestBatchNumber >= latestProcessedBatchNumber`
   - Processed batch numbers are contiguous (no gaps)

3. **Voting Constraints**:
   - An aggregator can only vote once per batch
   - A batch is only processed when sufficient aggregators agree on the same hashroot

## 6. Comprehensive Test Specification

### 6.1 Core Functionality Tests

1. **Commitment Submission Testing**
   - Test basic commitment submission and storage
   - Verify commitment data retrieval
   - Test submission with both valid and invalid parameters
   - Verify operation of the unprocessed request pool

2. **Batch Creation Testing**
   - Test creating batches with all unprocessed commitments
   - Test creating batches with specified commitment subsets
   - Verify proper batch numbering and sequential ordering
   - Test batch creation with empty/invalid inputs

3. **Batch Processing Testing**
   - Test hashroot submission from different aggregators
   - Verify vote counting mechanism
   - Test batch processing completion when threshold is reached
   - Verify processed batch data and status

### 6.2 Rule Enforcement Tests

1. **Commitment Modification Rule Tests**
   - Test that unprocessed commitments can be modified
   - Verify that batched commitments cannot be modified
   - Test handling of duplicate submissions
   - Test rejection of attempted modifications to processed commitments

2. **Sequential Processing Tests**
   - Verify batches must be processed in order
   - Test rejection of out-of-order batch processing attempts
   - Verify correct updating of latest processed batch number

3. **Voting Rule Tests**
   - Verify one-vote-per-aggregator rule
   - Test consensus mechanism with various vote patterns
   - Test handling of conflicting hashroot submissions
   - Verify proper consensus resolution

### 6.3 Administrative Function Tests

1. **Aggregator Management Tests**
   - Test adding new aggregators
   - Test removing existing aggregators
   - Verify impact on voting requirements

2. **Threshold Configuration Tests**
   - Test updating required vote threshold
   - Verify threshold constraints (>0, <=total aggregators)

3. **Access Control Tests**
   - Verify only owner can call administrative functions
   - Verify only trusted aggregators can submit commitments and hashroots

### 6.4 Edge Case Tests

1. **Empty/Boundary Tests**
   - Test with empty commitment pools
   - Test with empty request ID lists
   - Test with minimum and maximum values

2. **Gas Optimization Tests**
   - Verify gas-efficient storage of batches (request IDs vs. full data)
   - Test gas consumption with different batch sizes

3. **Recovery Testing**
   - Test system behavior after failed operations
   - Verify system can continue processing after errors

## 7. Implementation Guidance for Other Languages/Frameworks

### 7.1 Core Requirements

1. **Data Storage**:
   - Efficient storage of commitment requests
   - Tracking of processed vs. unprocessed commitments
   - Sequential batch management
   - Vote tracking for consensus

2. **Cryptographic Requirements**:
   - Secure hashing for comparing commitments
   - Byte array handling for payloads and hashroots

3. **Access Control**:
   - Authentication of aggregator addresses
   - Permission management

### 7.2 Alternative Implementation Approaches

1. **Non-Ethereum Blockchain Platforms**:
   - Adapt the contract to other smart contract platforms (Solana, NEAR, etc.)
   - Maintain equivalent data models and consensus rules
   - Utilize platform-specific optimizations where applicable

2. **Traditional Database Implementations**:
   - Replace blockchain with a distributed database
   - Implement equivalent cryptographic verification
   - Use digital signatures for aggregator authentication
   - Maintain an append-only log of all operations

3. **Distributed Systems Approach**:
   - Implement as a distributed state machine
   - Use consensus protocols (Raft, Paxos) for hashroot agreement
   - Maintain cryptographic verification of all state transitions

### 7.3 Critical Implementation Considerations

1. **Concurrency Handling**:
   - Ensure atomic updates to prevent race conditions
   - Maintain consistent views during batch processing

2. **Performance Optimization**:
   - Minimize storage requirements for batches
   - Optimize hashroot consensus mechanism
   - Implement efficient lookup structures for commitments

3. **Scalability**:
   - Design for high throughput of commitment submissions
   - Consider sharding or partitioning for large-scale deployments
   - Implement efficient batch retrieval for downstream consumers

## 8. Integration Guidelines

### 8.1 External System Integration

1. **User-Facing Applications**:
   - Provide APIs for commitment submission
   - Implement cryptographic verification of commitment inclusion
   - Display batch processing status

2. **Aggregator Implementation**:
   - Create efficient off-chain processing of commitment batches
   - Implement Sparse Merkle Tree construction
   - Provide monitoring of batch processing

3. **Event Consumers**:
   - Monitor BatchProcessed events for downstream actions
   - Implement verification using hashroots

### 8.2 Deployment Considerations

1. **Network Selection**:
   - Ethereum mainnet for production systems
   - Test networks for development and staging

2. **Gas Optimization**:
   - Batch submission of commitments where possible
   - Optimize storage structures

3. **Security Measures**:
   - Regular security audits
   - Formal verification of critical components
   - Monitoring for unusual patterns

## 9. Future Extensions

1. **Dynamic Aggregator Management**:
   - Implement governance mechanisms for aggregator addition/removal
   - Allow staking and slashing for aggregator accountability

2. **Enhanced Merkle Proofs**:
   - Add functions to verify inclusion proofs
   - Support off-chain proof generation and on-chain verification

3. **Rollup Integration**:
   - Adapt the system to function within Layer 2 rollups
   - Optimize for lower gas costs in rollup environments