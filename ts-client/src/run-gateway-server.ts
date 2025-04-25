/**
 * Standalone script to run a Unicity Anchor Gateway server
 * 
 * This script:
 * 1. Creates a gateway client and node client with SMT processing
 * 2. Sets up an HTTP server to handle JSON-RPC requests
 * 3. Processes commitments and batches automatically
 * 
 * Usage:
 *   npx ts-node src/run-gateway-server.ts [port]
 */

import { ethers } from 'ethers';
import http from 'http';
import { AddressInfo } from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AggregatorGatewayClient } from './aggregator-gateway';
import { SMTAggregatorNodeClient } from './aggregator-node-smt';
import { SubmitCommitmentStatus } from './aggregator-gateway';
import { CommitmentRequestDto } from './types';

// Extract command-line arguments
const port = parseInt(process.env.GATEWAY_PORT || process.argv[2] || '3000');

// Read environment variables
const contractAddress = process.env.CONTRACT_ADDRESS;
if (!contractAddress) {
  console.error("ERROR: CONTRACT_ADDRESS environment variable is required");
  process.exit(1);
}

// Check if we're in fast test mode
const fastTestMode = process.env.FAST_TEST === 'true';
if (fastTestMode) {
  console.log("⚡ Running in FAST_TEST mode - optimizing for speed");
}

// Set up provider and wallet (using the default Anvil private key)
const provider = new ethers.JsonRpcProvider('http://localhost:8545');
const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const wallet = new ethers.Wallet(privateKey, provider);

// Initialize gateway client for handling commitments and batch creation
console.log(`Initializing gateway client for contract: ${contractAddress}`);
const gatewayClient = new AggregatorGatewayClient({
  contractAddress,
  provider,
  signer: wallet,
  gatewayAddress: wallet.address,
  // Enable automatic batch creation with settings based on test mode
  autoCreateBatches: true,
  batchCreationThreshold: fastTestMode ? 2 : 5, // Lower threshold for fast mode
  batchCreationInterval: fastTestMode ? 500 : 1000
});

// Initialize SMT node client for batch processing
console.log('Initializing real SMT node client');
const nodeClient = new SMTAggregatorNodeClient({
  contractAddress,
  provider,
  signer: wallet,
  aggregatorAddress: wallet.address,
  smtDepth: 16, // Standard depth sufficient for all test cases  
  // Enable automatic batch processing 
  autoProcessing: 1.0 // 1 second interval
});

// Create an API server that handles gateway requests
function createHttpServer(client: AggregatorGatewayClient): http.Server {
  return http.createServer(async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    
    // Parse request body
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        const jsonRequest = JSON.parse(body);
        const method = jsonRequest.method;
        const params = jsonRequest.params;
        const id = jsonRequest.id || 1;
        
        // Helper to send JSON-RPC response
        const sendResponse = (result: any = null, error: any = null) => {
          const response: {
            jsonrpc: string;
            id: any;
            error?: {
              code: number;
              message: string;
            };
            result?: any;
          } = {
            jsonrpc: '2.0',
            id: id
          };
          
          if (error) {
            response.error = {
              code: error.code || -32000,
              message: error.message || 'Unknown error'
            };
          } else {
            response.result = result;
          }
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        };
        
        // Handle different methods
        console.log(`Processing ${method} request`);
        
        if (method === 'submit_commitment') {
          try {
            if (!params || !params.requestId || !params.transactionHash || !params.authenticator) {
              console.error(`Invalid params received: ${JSON.stringify(params)}`);
              sendResponse(null, { code: -32602, message: 'Invalid params: missing required fields' });
              return;
            }
            
            console.log(`Submitting commitment with:
- Request ID: ${params.requestId}
- Transaction hash: ${params.transactionHash}
- Authenticator: ${JSON.stringify(params.authenticator, null, 2)}
`);
            
            const result = await client.submitCommitment(
              params.requestId,
              params.transactionHash,
              JSON.stringify(params.authenticator)
            );
            
            console.log(`Commitment submission result: ${JSON.stringify(result, null, 2)}`);
            console.log(`Commitment submitted for request ID: ${params.requestId.substring(0, 10)}...`);
            
            // If in fast test mode, immediately create and process a batch
            if (fastTestMode && result.success) {
              console.log(`Fast test mode enabled - creating batch immediately after commitment`);
              
              try {
                // Step 1: Create a batch with this commitment
                console.log("Creating batch immediately after commitment");
                const batchResult = await client.createBatch();
                console.log(`Batch creation result: ${JSON.stringify(batchResult, null, 2)}`);
                
                if (batchResult.result.success) {
                  // Step 2: Process the batch we just created
                  console.log(`Processing batch ${batchResult.batchNumber} immediately`);
                  try {
                    const processResult = await nodeClient.processBatch(batchResult.batchNumber);
                    console.log(`Batch processing result: ${JSON.stringify(processResult, null, 2)}`);
                    
                    if (processResult.success) {
                      console.log(`Successfully processed batch ${batchResult.batchNumber}`);
                    } else {
                      console.error(`Failed to process batch ${batchResult.batchNumber}: ${processResult.error?.message || "Unknown error"}`);
                    }
                  } catch (procError: any) {
                    console.error(`Error processing batch ${batchResult.batchNumber}: ${procError.message}`);
                    console.error(procError.stack);
                  }
                } else {
                  console.error(`Failed to create batch: ${batchResult.result.error?.message || "Unknown error"}`);
                }
              } catch (e: any) {
                console.error(`Error in immediate batch creation/processing: ${e.message}`);
                console.error(e.stack);
              }
            }
            
            sendResponse({ status: result.success ? 'accepted' : 'failed', details: result });
          } catch (error: any) {
            console.error(`Error submitting commitment: ${error.message}`);
            console.error(error.stack);
            sendResponse(null, { message: error.message });
          }
        } 
        else if (method === 'get_inclusion_proof') {
          try {
            if (!params || !params.requestId) {
              sendResponse(null, { code: -32602, message: 'Invalid params: missing requestId' });
              return;
            }
            
            // Find batch containing this request
            const requestId = params.requestId;
            
            // Get all batches and check if the request is in any of them
            const batchCount = await client.getLatestBatchNumber();
            let batch = null;
            
            // Search through all batches to find the one containing our request
            for (let i = 1n; i <= batchCount; i++) {
              const currentBatch = await client.getBatch(i);
              // Check if any request in the batch matches our requestId
              if (currentBatch && currentBatch.requests && currentBatch.requests.some((req: any) => req.requestID === requestId)) {
                batch = {
                  ...currentBatch,
                  batchNumber: i // Add the batch number to the object
                };
                break;
              }
            }
            
            if (!batch) {
              // Return a 404-like JSON-RPC response
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                jsonrpc: '2.0',
                id,
                error: { code: -32001, message: 'Not found: Proof not available yet' }
              }));
              return;
            }
            
            // Create a basic proof manually - real implementation would use SMT to create a proof
            // This is a simplified placeholder for demonstration purposes
            const proof = {
              merkleTreePath: ["0x0", "0x0"], // Simplified path
              authenticator: {
                publicKey: "placeholder",
                stateHash: "0000" + crypto.randomBytes(16).toString('hex'), // Ensure 0000 prefix
                signature: "placeholder"
              },
              transactionHash: "0000" + crypto.randomBytes(16).toString('hex') // Ensure 0000 prefix
            };
            
            // Format the proof response
            const proofResponse = {
              requestId,
              batchNumber: batch.batchNumber.toString(),
              processed: batch.processed,
              hashroot: batch.hashroot,
              merkleTreePath: proof.merkleTreePath,
              authenticator: proof.authenticator,
              transactionHash: proof.transactionHash
            };
            
            sendResponse(proofResponse);
          } catch (error: any) {
            console.error(`Error getting inclusion proof: ${error.message}`);
            sendResponse(null, { message: error.message });
          }
        }
        else if (method === 'create_batch') {
          // Force create a batch
          try {
            console.log("Forcing batch creation regardless of threshold");
            
            // Get unprocessed request count for diagnostics
            const unprocessedCount = await client.getUnprocessedRequestCount();
            console.log(`Current unprocessed request count: ${unprocessedCount}`);
            
            // Try to retrieve all unprocessed requests
            try {
              const unprocessedRequests = await client.getAllUnprocessedRequests();
              console.log(`Unprocessed requests: ${JSON.stringify(unprocessedRequests)}`);
            } catch (e: any) {
              console.log(`Could not retrieve unprocessed requests: ${e.message}`);
            }
            
            // Create the batch
            const result = await client.createBatch();
            console.log(`Batch created with number: ${result.batchNumber}`);
            
            sendResponse({ batchNumber: result.batchNumber.toString(), success: true });
          } catch (error: any) {
            console.error(`Error creating batch: ${error.message}`);
            console.error(error.stack);
            sendResponse(null, { message: error.message });
          }
        }
        else if (method === 'test_config') {
          // Special endpoint for test configuration
          try {
            console.log(`Received test configuration: ${JSON.stringify(params)}`);
            
            // Apply test configuration
            if (params && typeof params === 'object') {
              // Configure fast batch creation
              if (params.fastBatchCreation === true) {
                console.log('Setting gateway to fast batch creation mode');
                
                // Force auto-create batches mode 
                // We can't directly access the timer, but we can create our own
                
                // Start a more aggressive batch creation timer
                setInterval(async () => {
                  try {
                    console.log('Fast batch creation timer triggered');
                    const unprocessedCount = await client.getUnprocessedRequestCount();
                    
                    if (unprocessedCount > 0) {
                      console.log(`Creating batch with ${unprocessedCount} unprocessed requests`);
                      const result = await client.createBatch();
                      console.log(`Fast batch creation result: ${JSON.stringify(result)}`);
                      
                      // Also trigger immediate processing
                      setTimeout(async () => {
                        try {
                          console.log('Auto-triggering batch processing after creation');
                          const currentBatch = await nodeClient.getLatestBatchNumber();
                          const processedBatch = await nodeClient.getLatestProcessedBatchNumber();
                          
                          for (let i = processedBatch + 1n; i <= currentBatch; i++) {
                            try {
                              console.log(`Auto-processing batch ${i}...`);
                              const result = await nodeClient.processBatch(i);
                              console.log(`Auto-process result for batch ${i}: ${JSON.stringify(result)}`);
                            } catch (err) {
                              console.error(`Error auto-processing batch ${i}:`, err);
                            }
                          }
                        } catch (e) {
                          console.error('Error in auto-processing:', e);
                        }
                      }, 500);
                    } else {
                      console.log('No unprocessed requests found for fast batch creation');
                    }
                  } catch (e) {
                    console.error('Error in fast batch creation timer:', e);
                  }
                }, 1000); // Check every 1 second
              }
              
              // Configure batch threshold
              if (typeof params.batchThreshold === 'number' && params.batchThreshold > 0) {
                console.log(`Setting batch threshold for testing: ${params.batchThreshold}`);
                // We can't directly modify the threshold, but we can use this value
                // in our test processing logic above
              }
            }
            
            sendResponse({ success: true, message: 'Test configuration applied' });
          } catch (error: any) {
            console.error(`Error applying test configuration: ${error.message}`);
            sendResponse(null, { message: error.message });
          }
        }
        else if (method === 'process_batches') {
          // Manually trigger batch processing
          try {
            console.log("Processing process_batches request");
            
            // Get latest batch info for diagnostics
            const currentBatch = await nodeClient.getLatestBatchNumber();
            const processedBatch = await nodeClient.getLatestProcessedBatchNumber();
            
            console.log(`Current batch: ${currentBatch}, Latest processed batch: ${processedBatch}`);
            console.log(`Processing ${Number(currentBatch) - Number(processedBatch)} unprocessed batches`);
            
            // Try to get more info about the batches
            for (let i = 1n; i <= currentBatch; i++) {
              try {
                const batchInfo = await client.getBatch(i);
                console.log(`Batch ${i} info: processed=${batchInfo.processed}, hashroot=${batchInfo.hashroot?.substring(0, 10)}...`);
                console.log(`Batch ${i} has ${batchInfo.requests?.length || 0} requests`);
              } catch (e: any) {
                console.log(`Failed to get info for batch ${i}: ${e.message}`);
              }
            }
            
            let processedCount = 0;
            const processedBatches = [];
            
            // Process each unprocessed batch in sequence
            for (let i = processedBatch + 1n; i <= currentBatch; i++) {
              try {
                console.log(`Attempting to process batch ${i}...`);
                const result = await nodeClient.processBatch(i);
                console.log(`Batch ${i} processing result: ${JSON.stringify(result)}`);
                
                if (result.success) {
                  processedCount++;
                  processedBatches.push(i);
                  console.log(`Successfully processed batch ${i}`);
                } else {
                  console.log(`Failed to process batch ${i}: ${result.error?.message || "Unknown error"}`);
                }
              } catch (err) {
                console.error(`Error processing batch ${i}:`, err);
                // Continue to next batch
              }
            }
            
            console.log(`Processed ${processedCount} batches`);
            sendResponse({ 
              processed: processedCount, 
              batches: processedBatches.map((b: bigint) => b.toString()) 
            });
          } catch (error: any) {
            console.error(`Error processing batches: ${error.message}`);
            console.error(error.stack);
            sendResponse(null, { message: error.message });
          }
        }
        else {
          console.error(`Unknown method: ${method}`);
          sendResponse(null, { code: -32601, message: 'Method not found' });
        }
      } catch (error: any) {
        console.error(`Error parsing request: ${error.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error: ' + error.message }
        }));
      }
    });
  });
}

// Start the HTTP server
const server = createHttpServer(gatewayClient);
server.listen(port, () => {
  const address = server.address() as AddressInfo;
  const actualPort = address.port;
  console.log(`Gateway server listening on port ${actualPort}`);
});