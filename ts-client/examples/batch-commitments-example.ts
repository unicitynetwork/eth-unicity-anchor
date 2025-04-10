/**
 * This example demonstrates how to use the new batch commitment functions
 * to efficiently submit multiple commitments and create batches.
 */
import { ethers } from 'ethers';
import { AggregatorGatewayClient } from '../src/aggregator-gateway';
import { CommitmentRequest, EventType } from '../src/types';

// Sample configuration (replace with actual values in real usage)
const config = {
  providerUrl: 'https://ethereum-provider-url.example',
  contractAddress: '0x1234567890123456789012345678901234567890',
  privateKey: 'your_private_key_here',
  gatewayAddress: '0xYourGatewayAddress',
  batchCreationThreshold: 50,
  batchCreationInterval: 300000, // 5 minutes
  autoCreateBatches: true,
  maxRetries: 3,
  gasLimitMultiplier: 1.2
};

/**
 * This function demonstrates how to submit multiple commitments in a batch
 * and handle the response.
 */
async function submitMultipleCommitments() {
  // Create the gateway client
  const gateway = new AggregatorGatewayClient(config);
  
  // Prepare commitments
  const commitments: CommitmentRequest[] = [];
  
  // Generate 10 sample commitments
  for (let i = 0; i < 10; i++) {
    const requestID = BigInt(Date.now() + i); // Unique ID
    const payload = new TextEncoder().encode(`Transaction data for request ${i}`);
    const authenticator = new TextEncoder().encode(`Auth for request ${i}`);
    
    commitments.push({ requestID, payload, authenticator });
  }
  
  try {
    console.log(`Submitting ${commitments.length} commitments in a single transaction...`);
    
    // Submit all commitments in a single transaction
    const { successCount, result } = await gateway.submitCommitments(commitments);
    
    if (result.success) {
      console.log(`Successfully submitted ${successCount} commitments`);
      console.log(`Transaction hash: ${result.transactionHash}`);
      console.log(`Gas used: ${result.gasUsed?.toString()}`);
    } else {
      console.error('Failed to submit commitments:', result.error?.message);
    }
  } catch (error) {
    console.error('An error occurred:', error);
  }
}

/**
 * This function demonstrates how to submit commitments and create a batch
 * in a single transaction.
 */
async function submitAndCreateBatch() {
  // Create the gateway client
  const gateway = new AggregatorGatewayClient(config);
  
  // Listen for events
  gateway.on(EventType.RequestsSubmitted, (_, data) => {
    console.log(`Batch submission event: ${data.count} commitments submitted, ${data.successCount} successful`);
  });
  
  gateway.on(EventType.BatchCreated, (_, data) => {
    console.log(`Batch created: Batch #${data.batchNumber} with ${data.requestCount} requests`);
  });
  
  // Prepare commitments
  const commitments: CommitmentRequest[] = [];
  
  // Generate 10 sample commitments
  for (let i = 0; i < 10; i++) {
    const requestID = BigInt(Date.now() + i); // Unique ID
    const payload = new TextEncoder().encode(`Transaction data for request ${i}`);
    const authenticator = new TextEncoder().encode(`Auth for request ${i}`);
    
    commitments.push({ requestID, payload, authenticator });
  }
  
  try {
    console.log(`Submitting ${commitments.length} commitments and creating batch in a single transaction...`);
    
    // Submit commitments and create batch in a single transaction
    const { batchNumber, successCount, result } = await gateway.submitAndCreateBatch(commitments);
    
    if (result.success) {
      console.log(`Successfully submitted ${successCount} commitments and created batch #${batchNumber}`);
      console.log(`Transaction hash: ${result.transactionHash}`);
      console.log(`Gas used: ${result.gasUsed?.toString()}`);
    } else {
      console.error('Failed to submit commitments and create batch:', result.error?.message);
    }
  } catch (error) {
    console.error('An error occurred:', error);
  }
}

/**
 * This function demonstrates a more complex scenario where commitments
 * are collected and submitted in batches for efficiency.
 */
async function efficientBatchSubmission(
  commitmentQueue: CommitmentRequest[],
  batchSize: number = 50
) {
  // Create the gateway client
  const gateway = new AggregatorGatewayClient({
    ...config,
    // Turn off automatic batch creation for manual control
    autoCreateBatches: false
  });
  
  // Process commitments in batches
  while (commitmentQueue.length > 0) {
    // Take up to batchSize commitments from the queue
    const batchCommitments = commitmentQueue.splice(0, batchSize);
    
    console.log(`Processing batch of ${batchCommitments.length} commitments...`);
    
    try {
      // If there's a significant number of commitments, submit and create batch together
      if (batchCommitments.length >= batchSize / 2) {
        const { batchNumber, successCount, result } = await gateway.submitAndCreateBatch(batchCommitments);
        
        if (result.success) {
          console.log(`Created batch #${batchNumber} with ${successCount} commitments`);
        } else {
          console.error('Failed to create batch:', result.error?.message);
          // Add failed commitments back to the queue for retry
          commitmentQueue.unshift(...batchCommitments);
        }
      } 
      // For smaller batches, just submit the commitments
      else {
        const { successCount, result } = await gateway.submitCommitments(batchCommitments);
        
        if (result.success) {
          console.log(`Successfully submitted ${successCount} commitments`);
          
          // Check if we have enough unprocessed commitments to create a batch
          const unprocessedCount = await gateway.getUnprocessedRequestCount();
          
          if (unprocessedCount >= BigInt(batchSize)) {
            console.log(`Creating batch for ${unprocessedCount} unprocessed commitments...`);
            const { batchNumber, result } = await gateway.createBatch();
            
            if (result.success) {
              console.log(`Created batch #${batchNumber}`);
            } else {
              console.error('Failed to create batch:', result.error?.message);
            }
          }
        } else {
          console.error('Failed to submit commitments:', result.error?.message);
          // Add failed commitments back to the queue for retry
          commitmentQueue.unshift(...batchCommitments);
        }
      }
      
      // Add a small delay between batches to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error('An error occurred during batch processing:', error);
      // Add commitments back to the queue for retry
      commitmentQueue.unshift(...batchCommitments);
      // Wait a bit longer before retrying
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  console.log('All commitments processed successfully');
}

// Example usage:
// submitMultipleCommitments();
// submitAndCreateBatch();

// To use the efficient batch submission function, create a queue of commitments:
/*
const queue: CommitmentRequest[] = [];
// Add commitments to the queue...
efficientBatchSubmission(queue, 100);
*/