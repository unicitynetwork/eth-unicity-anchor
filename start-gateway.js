const { ethers } = require('ethers');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Get environment variables
const contractAddress = process.env.CONTRACT_ADDRESS;
const port = parseInt(process.env.GATEWAY_PORT || '3000');

if (!contractAddress) {
  console.error('CONTRACT_ADDRESS environment variable is required');
  process.exit(1);
}

// Read contract ABI
const abi = JSON.parse(fs.readFileSync('./contract-abi.json', 'utf8'));

// Connect to Ethereum
const provider = new ethers.JsonRpcProvider('http://localhost:8545');
const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const wallet = new ethers.Wallet(privateKey, provider);

// Initialize contract
const contract = new ethers.Contract(contractAddress, abi, wallet);

// Create HTTP server
const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // Parse URL
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;
  
  // Helper to send JSON response
  const sendResponse = (statusCode, data) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  
  // Helper to send JSON-RPC response
  const sendJsonRpcResponse = (id, result = null, error = null) => {
    const response = {
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
  
  try {
    // Parse request body for POST requests
    let body = '';
    if (req.method === 'POST' || req.method === 'PUT') {
      await new Promise((resolve) => {
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          resolve();
        });
      });
    }
    
    // Handle JSON-RPC requests to root path
    if (path === '/' && req.method === 'POST') {
      try {
        const jsonRpcRequest = JSON.parse(body);
        
        // Validate JSON-RPC request format
        if (!jsonRpcRequest || jsonRpcRequest.jsonrpc !== '2.0' || !jsonRpcRequest.method) {
          return sendJsonRpcResponse(jsonRpcRequest?.id, null, {
            code: -32600,
            message: 'Invalid Request'
          });
        }
        
        const { method, params, id } = jsonRpcRequest;
        
        // Handle different methods
        switch (method) {
          case 'submit_commitment': {
            if (!params || !params.requestId || !params.transactionHash || !params.authenticator) {
              return sendJsonRpcResponse(id, null, {
                code: -32602,
                message: 'Invalid params: missing required fields'
              });
            }
            
            console.log('Received submission:', params.requestId);
            
            // Convert data to Ethereum format
            const requestId = params.requestId;
            const txHash = params.transactionHash;
            const authData = Buffer.from(
              JSON.stringify(params.authenticator),
              'utf-8'
            ).toString('hex');
            
            // Submit to contract
            const tx = await contract.submitCommitment(
              requestId,
              txHash,
              '0x' + authData
            );
            await tx.wait();
            
            return sendJsonRpcResponse(id, { status: 'SUCCESS' });
          }
          
          case 'get_inclusion_proof': {
            if (!params || !params.requestId) {
              return sendJsonRpcResponse(id, null, {
                code: -32602,
                message: 'Invalid params: missing requestId'
              });
            }
            
            const requestId = params.requestId;
            console.log('Looking up proof for:', requestId);
            
            // Check if request exists in contract
            const exists = await contract.requestExists(requestId);
            if (!exists) {
              return sendJsonRpcResponse(id, null);
            }
            
            // Get request batch number
            const requestBatchNumber = await contract.getRequestBatchNumber(requestId);
            if (requestBatchNumber === 0n) {
              return sendJsonRpcResponse(id, null);
            }
            
            // Get batch details
            const batch = await contract.getBatch(requestBatchNumber);
            
            // Create a simplified proof structure
            const proof = {
              requestId: requestId,
              batchNumber: requestBatchNumber.toString(),
              processed: batch.processed,
              hashroot: batch.hashroot,
              // This would typically be a Merkle proof, but we're simplifying
              proof: Array(32).fill('0').join('')
            };
            
            return sendJsonRpcResponse(id, proof);
          }
          
          default:
            return sendJsonRpcResponse(id, null, {
              code: -32601,
              message: 'Method not found'
            });
        }
      } catch (error) {
        console.error('Error processing request:', error);
        return sendJsonRpcResponse(
          jsonRpcRequest?.id, 
          null, 
          { code: -32000, message: error.message }
        );
      }
    }
    // Legacy route support
    else if (path === '/api/v1/submitCommitment' && req.method === 'POST') {
      console.warn('WARNING: Using deprecated route /api/v1/submitCommitment. Please update to use JSON-RPC interface.');
      try {
        const data = JSON.parse(body);
        console.log('Received submission:', data.requestId);
        
        // Basic validation
        if (!data.requestId || !data.transactionHash || !data.authenticator) {
          return sendResponse(400, { status: 'INVALID_REQUEST' });
        }
        
        // Convert data to Ethereum format
        const requestId = data.requestId;
        const txHash = data.transactionHash;
        const authData = Buffer.from(
          JSON.stringify(data.authenticator),
          'utf-8'
        ).toString('hex');
        
        // Submit to contract
        const tx = await contract.submitCommitment(
          requestId,
          txHash,
          '0x' + authData
        );
        await tx.wait();
        
        return sendResponse(200, { status: 'SUCCESS' });
      } catch (error) {
        console.error('Error processing commitment:', error);
        return sendResponse(500, { status: 'ERROR', message: error.message });
      }
    }
    else if (path.startsWith('/api/v1/getInclusionProof/') && req.method === 'GET') {
      console.warn('WARNING: Using deprecated route /api/v1/getInclusionProof. Please update to use JSON-RPC interface.');
      try {
        const requestId = path.split('/').pop();
        console.log('Looking up proof for:', requestId);
        
        // Check if request exists in contract
        const exists = await contract.requestExists(requestId);
        if (!exists) {
          return sendResponse(404, { status: 'NOT_FOUND' });
        }
        
        // Get request batch number
        const requestBatchNumber = await contract.getRequestBatchNumber(requestId);
        if (requestBatchNumber === 0n) {
          return sendResponse(202, { status: 'PENDING' });
        }
        
        // Get batch details
        const batch = await contract.getBatch(requestBatchNumber);
        
        // Create a simplified proof structure
        const proof = {
          requestId: requestId,
          batchNumber: requestBatchNumber.toString(),
          processed: batch.processed,
          hashroot: batch.hashroot,
          // This would typically be a Merkle proof, but we're simplifying
          proof: Array(32).fill('0').join('')
        };
        
        return sendResponse(200, proof);
      } catch (error) {
        console.error('Error getting proof:', error);
        return sendResponse(500, { status: 'ERROR', message: error.message });
      }
    }
    else {
      // Method not found
      return sendResponse(404, { status: 'NOT_FOUND' });
    }
  } catch (error) {
    console.error('Server error:', error);
    return sendResponse(500, { status: 'SERVER_ERROR', message: error.message });
  }
});

// Save port to file for other scripts to use
fs.writeFileSync('gateway-port.txt', port.toString());

// Start server
server.listen(port, () => {
  console.log(`Gateway server running at http://localhost:${port}`);
  console.log('JSON-RPC methods available:');
  console.log('  - submit_commitment');
  console.log('  - get_inclusion_proof');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gateway server...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});