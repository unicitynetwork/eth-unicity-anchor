/**
 * Test script for running a Unicity Anchor Gateway server and testing commits
 * 
 * This script:
 * 1. Creates a gateway client and node client with SMT processing
 * 2. Sets up an HTTP server similar to the ones used in the integration tests
 * 3. Handles submission, proofs, and batch processing
 * 4. Then runs the test-gateway.ts script against this server
 */

import { ethers } from 'ethers';
import http from 'http';
import { AddressInfo } from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import { AggregatorGatewayClient } from './aggregator-gateway';
import { SMTAggregatorNodeClient } from './aggregator-node-smt';
import { SubmitCommitmentStatus } from './aggregator-gateway';
import { CommitmentRequestDto } from './types';

// Extract command-line arguments
const port = parseInt(process.argv[2] || '0'); // Default to 0 (random port)
const commitCount = parseInt(process.argv[3] || '5'); // Default to 5 commits

// Read environment variables
const contractAddress = process.env.CONTRACT_ADDRESS;
if (!contractAddress) {
  console.error("ERROR: CONTRACT_ADDRESS environment variable is required");
  process.exit(1);
}

// Set up provider and wallet (using the default Anvil private key)
const provider = new ethers.JsonRpcProvider('http://localhost:8545');
const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const wallet = new ethers.Wallet(privateKey, provider);

// For testing authentication
const apiKey = 'test-api-key';
const jwtSecret = 'test-jwt-secret';

// Create a JWT token for testing
function generateJwt(payload: any): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
  
  // Use Node.js crypto for HMAC
  const signature = crypto
    .createHmac('sha256', jwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64');
    
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

// Initialize gateway client for handling commitments and batch creation
console.log(`Initializing gateway client for contract: ${contractAddress}`);
const gatewayClient = new AggregatorGatewayClient({
  contractAddress,
  provider,
  signer: wallet,
  gatewayAddress: wallet.address,
  // Enable automatic batch creation
  autoCreateBatches: true,
  batchCreationThreshold: 3, // Create batch after 3 commitments
  batchCreationInterval: 30000 // 30 seconds max interval
});

// Initialize SMT node client for batch processing
console.log('Initializing real SMT node client');
const nodeClient = new SMTAggregatorNodeClient({
  contractAddress,
  provider,
  signer: wallet,
  aggregatorAddress: wallet.address,
  smtDepth: 32,
  // Enable automatic batch processing
  autoProcessing: 30 // Process batches every 30 seconds
});

// Create an API server that handles gateway requests - following the pattern
// used in the integration tests
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
    
    // Parse the URL path
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;
    
    // Response factory
    const sendResponse = (statusCode: number, data: any) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    
    // Authentication helpers
    const authenticateApiKey = () => {
      const authHeader = req.headers.authorization || '';
      const key = authHeader.replace('Bearer ', '');
      return key === apiKey;
    };
    
    const authenticateJwt = () => {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace('Bearer ', '');
      try {
        // Simple JWT validation
        const [header, payload, signature] = token.split('.');
        
        // Use Node.js crypto for HMAC
        const expectedSignature = crypto
          .createHmac('sha256', jwtSecret)
          .update(`${header}.${payload}`)
          .digest('base64');
        
        return signature === expectedSignature;
      } catch (error) {
        return false;
      }
    };
    
    try {
      // Parse request body for POST requests
      let body = '';
      if (req.method === 'POST' || req.method === 'PUT') {
        await new Promise<void>((resolve) => {
          req.on('data', (chunk) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            resolve();
          });
        });
      }
      
      // Route the request
      if (path === '/submitCommitment' && req.method === 'POST') {
        try {
          // Skip authentication for testing
          // if (!authenticateApiKey() && !authenticateJwt()) {
          //   return sendResponse(401, { status: SubmitCommitmentStatus.AUTHENTICATION_FAILED });
          // }
          
          const data = JSON.parse(body);
          console.log(`Received submission for requestId: ${data.requestId}`);
          
          // Validate request body
          if (!data.requestId || !data.transactionHash || !data.authenticator) {
            return sendResponse(400, { status: SubmitCommitmentStatus.INVALID_REQUEST });
          }
          
          // Create request ID & transaction hash objects
          const requestId = data.requestId;
          const txHash = data.transactionHash;
          
          // Convert authenticator to bytes
          const authenticatorBytes = ethers.toUtf8Bytes(JSON.stringify(data.authenticator));
          
          // Submit to smart contract
          const result = await client.submitCommitment(
            requestId,
            txHash,
            authenticatorBytes
          );
          
          if (result.success) {
            return sendResponse(200, { status: SubmitCommitmentStatus.SUCCESS });
          } else {
            return sendResponse(500, { status: SubmitCommitmentStatus.BATCH_CREATION_FAILED });
          }
        } catch (error) {
          console.error('Error processing commitment submission:', error);
          return sendResponse(500, { status: SubmitCommitmentStatus.INVALID_REQUEST });
        }
      } 
      else if (path.startsWith('/getInclusionProof/') && req.method === 'GET') {
        try {
          const requestId = path.split('/').pop() || '';
          console.log(`Checking proof for requestId: ${requestId}`);
          
          // Get the latest batch number to query all batches
          const latestBatchNumber = await client.getLatestBatchNumber();
          
          // Check if the request exists in any batch
          let batchNumber = 0n;
          let foundBatch = false;
          
          // Search through all batches for the request
          for (let i = 1n; i <= latestBatchNumber; i++) {
            const batch = await client.getBatch(i);
            
            // Check if the request is in this batch's request list
            if (batch.requests.some(req => req.requestID === requestId)) {
              batchNumber = i;
              foundBatch = true;
              break;
            }
          }
          
          if (!foundBatch) {
            // Check if the request exists but is not yet in a batch
            try {
              await client.getCommitment(requestId);
              return sendResponse(202, { status: 'PENDING' });
            } catch (e) {
              return sendResponse(404, { status: 'NOT_FOUND' });
            }
          }
          
          // Get batch details
          const batch = await client.getBatch(batchNumber);
          
          // Try to generate a simple inclusion proof
          // This is a simplified version - for a real application
          // we would use the SMT to generate a proper proof
          
          const proof = {
            requestId,
            batchNumber: batchNumber.toString(),
            processed: batch.processed,
            hashroot: batch.hashroot,
            proof: '0x0000' // Simplified proof
          };
          
          return sendResponse(200, proof);
        } catch (error) {
          console.error('Error getting proof:', error);
          return sendResponse(500, { status: 'ERROR', message: (error as Error).message });
        }
      }
      else if (path === '/process-batch' && req.method === 'POST') {
        try {
          console.log('Processing batches via API...');
          
          // First create a batch if needed
          const createResult = await client.createBatch();
          console.log('Batch creation result:', createResult);
          
          // Then process all unprocessed batches
          const latestBatchNumber = await client.getLatestBatchNumber();
          let processed = 0;
          
          if (latestBatchNumber > 0n) {
            // Process each batch
            for (let i = 1n; i <= latestBatchNumber; i++) {
              const batch = await client.getBatch(i);
              
              if (!batch.processed) {
                console.log(`Processing batch #${i}...`);
                // Create hashroot and submit to contract
                const batchInfo = await client.getBatch(i);
                const requests = await Promise.all(
                  batchInfo.requests.map(async (req: CommitmentRequestDto) => {
                    return {
                      requestID: BigInt(req.requestID),
                      payload: ethers.getBytes(req.payload),
                      authenticator: ethers.getBytes(req.authenticator)
                    };
                  })
                );
                
                // Generate hashroot using SMT
                const hashroot = await nodeClient.generateHashroot(i, requests);
                
                // Submit hashroot to contract
                const result = await nodeClient.submitHashroot(i, hashroot);
                
                if (result.success) {
                  processed++;
                  console.log(`Successfully processed batch #${i}`);
                } else {
                  console.error(`Failed to process batch #${i}:`, result.error);
                }
              }
            }
          }
          
          return sendResponse(200, {
            status: 'SUCCESS',
            batchCount: latestBatchNumber.toString(),
            processed
          });
        } catch (error) {
          console.error('Error processing batch:', error);
          return sendResponse(500, { status: 'ERROR', message: (error as Error).message });
        }
      }
      else {
        return sendResponse(404, { status: 'NOT_FOUND', path });
      }
    } catch (error) {
      console.error('Server error:', error);
      return sendResponse(500, { status: 'ERROR', message: (error as Error).message });
    }
  });
}

// Create and start HTTP server
let testerProcess: ChildProcess | null = null;

async function runTest() {
  try {
    console.log(`Starting HTTP server...`);
    const httpServer = createHttpServer(gatewayClient);
    httpServer.listen(port);
    
    // Wait for server to start
    await new Promise<void>((resolve) => {
      httpServer.on('listening', () => {
        resolve();
      });
    });
    
    // Get the assigned port
    const address = httpServer.address() as AddressInfo;
    const serverPort = address.port;
    console.log(`HTTP server started on port ${serverPort}`);
    
    // Save the port to a file for shell scripts to use
    fs.writeFileSync('gateway-port.txt', serverPort.toString());
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down...');
      
      if (testerProcess) {
        console.log('Terminating test process...');
        testerProcess.kill();
      }
      
      httpServer.close();
      process.exit(0);
    });
    
    // Run the test script against the server
    console.log(`Running test script with ${commitCount} commits...`);
    testerProcess = spawn('npx', ['ts-node', 'src/test-gateway.ts', `http://localhost:${serverPort}`, commitCount.toString()], {
      stdio: 'inherit'
    });
    
    // Wait for the test process to exit
    const exitCode = await new Promise<number>((resolve) => {
      testerProcess!.on('exit', (code) => {
        resolve(code || 0);
      });
    });
    
    console.log(`Test script exited with code ${exitCode}`);
    
    // If the test failed or found pending proofs, process batches and try again
    if (exitCode !== 0) {
      console.log('Test found pending commits. Processing batches...');
      
      // Create and process batches
      try {
        // Create a batch
        const createResult = await gatewayClient.createBatch();
        console.log('Batch creation result:', createResult);
        
        // Process all batches
        const latestBatchNumber = await gatewayClient.getLatestBatchNumber();
        let processed = 0;
        
        if (latestBatchNumber > 0n) {
          for (let i = 1n; i <= latestBatchNumber; i++) {
            const batch = await gatewayClient.getBatch(i);
            
            if (!batch.processed) {
              console.log(`Processing batch #${i}...`);
              
              // Get all requests for this batch
              const batchInfo = await gatewayClient.getBatch(i);
              const requests = await Promise.all(
                batchInfo.requests.map(async (req: CommitmentRequestDto) => {
                  return {
                    requestID: BigInt(req.requestID),
                    payload: ethers.getBytes(req.payload),
                    authenticator: ethers.getBytes(req.authenticator)
                  };
                })
              );
              
              // Generate hashroot and submit
              const hashroot = await nodeClient.generateHashroot(i, requests);
              const result = await nodeClient.submitHashroot(i, hashroot);
              
              if (result.success) {
                processed++;
                console.log(`Successfully processed batch #${i}`);
              } else {
                console.error(`Failed to process batch #${i}:`, result.error);
              }
            } else {
              console.log(`Batch #${i} already processed`);
            }
          }
        }
        
        console.log(`Processed ${processed} batches out of ${latestBatchNumber.toString()}`);
        
        // Wait a moment for processing to complete
        console.log('Waiting for processing to settle...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Run the test again
        console.log('Running test script again to verify proofs...');
        const retestProcess = spawn('npx', ['ts-node', 'src/test-gateway.ts', `http://localhost:${serverPort}`, commitCount.toString()], {
          stdio: 'inherit'
        });
        
        // Wait for the retest process to exit
        const retestExitCode = await new Promise<number>((resolve) => {
          retestProcess.on('exit', (code) => {
            resolve(code || 0);
          });
        });
        
        console.log(`Final test run exited with code ${retestExitCode}`);
        process.exit(retestExitCode);
      } catch (error) {
        console.error('Error processing batches:', error);
        process.exit(1);
      }
    } else {
      process.exit(0);
    }
  } catch (error) {
    console.error('Unhandled error:', error);
    process.exit(1);
  }
}

// Start the test
runTest();