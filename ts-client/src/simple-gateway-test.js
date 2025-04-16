#!/usr/bin/env node

/**
 * Simple Gateway Test Script for Ethereum Unicity Anchor
 * This script simulates a gateway server and tests it with the test-gateway.ts client
 */

const { ethers } = require('ethers');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// __dirname and __filename are already available in CommonJS modules

// Extract command-line arguments
const port = parseInt(process.argv[2] || '0', 10); // Default to 0 (random port)
const commitCount = parseInt(process.argv[3] || '5', 10); // Default to 5 commits

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

// In-memory storage for our mock gateway
const pendingRequests = [];
const batches = [];
let nextBatchNumber = 1;

// Create an HTTP server that simulates a gateway
const server = http.createServer(async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // Parse the URL path
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  
  // Helper to send JSON responses
  const sendResponse = (statusCode, data) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  
  // Process request body
  let body = '';
  if (req.method === 'POST') {
    await new Promise((resolve) => {
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', resolve);
    });
  }
  
  try {
    // Handle different endpoints
    if (path === '/submitCommitment' && req.method === 'POST') {
      // Parse commitment data
      const data = JSON.parse(body);
      
      // Validate required fields
      if (!data.requestId || !data.transactionHash || !data.authenticator) {
        return sendResponse(400, { status: 'INVALID_REQUEST' });
      }
      
      // Store the commitment in our in-memory storage
      const requestInfo = {
        requestId: data.requestId,
        txHash: data.transactionHash,
        publicKey: data.authenticator.publicKey,
        processed: false
      };
      
      // Add to pending requests
      pendingRequests.push(requestInfo);
      
      console.log(`Received commitment: ${data.requestId}`);
      
      // Automatically create batches after 3 commitments
      if (pendingRequests.filter(r => !r.processed).length >= 3) {
        // Create a batch with pending requests
        const unprocessedRequests = pendingRequests.filter(r => !r.processed);
        const requestsToProcess = unprocessedRequests.slice(0, 10);
        
        const batch = {
          batchNumber: nextBatchNumber++,
          requests: requestsToProcess.map(r => r.requestId),
          processed: false
        };
        
        // Mark requests as processed and assign to batch
        requestsToProcess.forEach(req => {
          req.processed = true;
          req.batchNumber = batch.batchNumber;
        });
        
        // Add batch to our list
        batches.push(batch);
        
        console.log(`Created batch #${batch.batchNumber} with ${batch.requests.length} requests`);
        
        // Process the batch after a short delay to simulate blockchain anchoring
        setTimeout(() => {
          batch.processed = true;
          batch.hashroot = '0x' + crypto.randomBytes(32).toString('hex');
          console.log(`Processed batch #${batch.batchNumber}, hashroot: ${batch.hashroot}`);
        }, 2000);
      }
      
      return sendResponse(200, { 
        status: 'SUCCESS',
        message: 'Commitment received successfully'
      });
    }
    else if (path.startsWith('/getInclusionProof/') && req.method === 'GET') {
      // Extract requestId from URL
      const requestId = path.split('/').pop();
      
      // Find the request
      const request = pendingRequests.find(r => r.requestId === requestId);
      
      if (!request) {
        return sendResponse(404, { 
          error: 'Request not found',
          status: 'NOT_FOUND' 
        });
      }
      
      // Check if the request is in a processed batch
      if (!request.processed || !request.batchNumber) {
        return sendResponse(202, { 
          status: 'PENDING',
          message: 'Request is pending processing'
        });
      }
      
      const batch = batches.find(b => b.batchNumber === request.batchNumber);
      
      if (!batch || !batch.processed) {
        return sendResponse(202, { 
          status: 'BATCH_PENDING',
          message: 'Batch is pending processing'
        });
      }
      
      // Generate mock proof
      const proof = {
        requestId: request.requestId,
        batchNumber: request.batchNumber.toString(),
        processed: true,
        hashroot: batch.hashroot,
        proof: '0x' + crypto.randomBytes(64).toString('hex')
      };
      
      return sendResponse(200, proof);
    }
    else {
      // Handle unknown endpoints
      return sendResponse(404, { error: 'Not found' });
    }
  } catch (error) {
    console.error('Error processing request:', error);
    return sendResponse(500, { error: 'Internal server error' });
  }
});

// Start the server on the specified port
server.listen(port, () => {
  const address = server.address();
  const actualPort = address.port;
  
  // Save port to a file for the parent process to find
  fs.writeFileSync(path.resolve('../gateway-port.txt'), actualPort.toString());
  
  console.log(`Gateway server listening on port ${actualPort}`);
  
  // Run the test client to test gateway
  const testProcess = spawn('npx', [
    'ts-node', 
    path.join(__dirname, 'test-gateway.ts'), 
    `http://localhost:${actualPort}`, 
    commitCount.toString()
  ], {
    stdio: 'inherit'
  });
  
  testProcess.on('close', (code) => {
    console.log(`Test process exited with code ${code}`);
    server.close(() => {
      process.exit(code || 0);
    });
  });
});

// Handle server errors
server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

console.log('Gateway test script started');