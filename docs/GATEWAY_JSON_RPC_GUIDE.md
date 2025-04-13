# Ethereum Unicity Anchor: Gateway JSON-RPC API Guide

This document provides detailed instructions for working with the Ethereum Unicity Anchor Gateway's JSON-RPC API. It covers how to interact with the gateway via HTTP, how to use the Swagger documentation, and provides examples for all API endpoints.

## Table of Contents

1. [Overview](#1-overview)
2. [API Endpoints](#2-api-endpoints)
3. [Authentication](#3-authentication)
4. [Swagger Documentation](#4-swagger-documentation)
5. [Making Requests](#5-making-requests)
6. [Explicit Batch Numbering](#6-explicit-batch-numbering)
7. [Error Handling](#7-error-handling)
8. [Examples](#8-examples)
9. [Running Your Own Gateway](#9-running-your-own-gateway)
10. [Troubleshooting](#10-troubleshooting)

## 1. Overview

The Ethereum Unicity Anchor Gateway provides a JSON-RPC API for interacting with the Unicity Anchor smart contract. The API allows clients to:

- Submit individual commitments
- Submit multiple commitments in a single transaction
- Create batches (with auto-numbering or explicit batch numbers)
- Submit commitments and create batches in a single operation
- Retrieve inclusion proofs for processed commitments

The gateway acts as a middleware between clients and the Ethereum blockchain, handling transaction management, error recovery, and batch optimization.

## 2. API Endpoints

The gateway provides the following HTTP endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/submitCommitment` | POST | Submit a single commitment |
| `/submitMultipleCommitments` | POST | Submit multiple commitments in one transaction |
| `/submitBatch` | POST | Submit commitments and create a batch in one transaction |
| `/submitBatchWithNumber` | POST | Submit commitments and create a batch with explicit number |
| `/getInclusionProof/{requestId}` | GET | Get inclusion proof for a commitment |
| `/swagger` | GET | Access Swagger documentation UI |

## 3. Authentication

The gateway supports multiple authentication methods:

### API Key Authentication

Include an API key in the `Authorization` header:

```
Authorization: Bearer your-api-key-here
```

### JWT Authentication

Include a JWT token in the `Authorization` header:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Ethereum Signature Authentication

For certain endpoints, you can authenticate using Ethereum signatures:

```json
{
  "auth": {
    "signature": "0x...",
    "message": "I authorize this request",
    "signer": "0x1234..."
  }
}
```

## 4. Swagger Documentation

The gateway includes interactive Swagger documentation that allows you to explore and test the API directly from your browser.

### Accessing Swagger UI

To access the Swagger UI, navigate to:

```
https://{gateway-host}/swagger
```

For example, if your gateway is running at `https://gateway.example.com`, you would access the Swagger UI at `https://gateway.example.com/swagger`.

### Using Swagger UI

The Swagger UI provides:

1. **Interactive Documentation**: Detailed information about all API endpoints
2. **Request/Response Examples**: Sample payloads and responses
3. **Try It Out**: Test API calls directly from the browser
4. **Schema Definitions**: Data models used by the API

### Running Swagger Locally

If you're running your own gateway, you can start the Swagger documentation server using:

```bash
# From the ts-client directory
npm run swagger
```

This will start a server at `http://localhost:3000/swagger` by default.

You can specify a custom port:

```bash
npm run swagger -- 8080
```

## 5. Making Requests

### Submitting a Single Commitment

```bash
curl -X POST "https://gateway.example.com/submitCommitment" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "requestId": "1234567890",
    "transactionHash": "0d89c2fd427b3e71dee9f7cf7dab610f7db0f40b9d27160f2f93e6dc5ad271b0",
    "authenticator": {
      "publicKey": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "stateHash": "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
      "signature": "001122334455667788990011223344556677889900112233445566778899001122334455667788990011223344556677889900112233445566778899001122"
    }
  }'
```

### Submitting Multiple Commitments

```bash
curl -X POST "https://gateway.example.com/submitMultipleCommitments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "requests": [
      {
        "requestId": "1234567890",
        "transactionHash": "0d89c2fd427b3e71dee9f7cf7dab610f7db0f40b9d27160f2f93e6dc5ad271b0",
        "authenticator": {
          "publicKey": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          "stateHash": "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
          "signature": "001122334455667788990011223344556677889900112233445566778899001122334455667788990011223344556677889900112233445566778899001122"
        }
      },
      {
        "requestId": "1234567891",
        "transactionHash": "1d89c2fd427b3e71dee9f7cf7dab610f7db0f40b9d27160f2f93e6dc5ad271b1",
        "authenticator": {
          "publicKey": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          "stateHash": "bbccddeeee00112233445566778899aabbccddeeff00112233445566778899aa",
          "signature": "112233445566778899001122334455667788990011223344556677889900112233445566778899001122334455667788990011223344556677889900112233"
        }
      }
    ],
    "createBatch": true
  }'
```

### Submitting and Creating a Batch in One Transaction

```bash
curl -X POST "https://gateway.example.com/submitBatch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "commitments": [
      {
        "requestID": "1234567890",
        "payload": "0x0d89c2fd427b3e71dee9f7cf7dab610f7db0f40b9d27160f2f93e6dc5ad271b0",
        "authenticator": "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      },
      {
        "requestID": "1234567891",
        "payload": "0x1d89c2fd427b3e71dee9f7cf7dab610f7db0f40b9d27160f2f93e6dc5ad271b1",
        "authenticator": "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      }
    ]
  }'
```

### Getting an Inclusion Proof

```bash
curl -X GET "https://gateway.example.com/getInclusionProof/1234567890" \
  -H "Authorization: Bearer your-api-key"
```

## 6. Explicit Batch Numbering

The gateway supports creating batches with explicit batch numbers using the `/submitBatchWithNumber` endpoint. This is useful for scenarios where you need to create batches with specific numbers rather than relying on auto-numbering.

### Creating a Batch with Explicit Number

```bash
curl -X POST "https://gateway.example.com/submitBatchWithNumber" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "commitments": [
      {
        "requestID": "1234567890",
        "payload": "0x0d89c2fd427b3e71dee9f7cf7dab610f7db0f40b9d27160f2f93e6dc5ad271b0",
        "authenticator": "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      },
      {
        "requestID": "1234567891",
        "payload": "0x1d89c2fd427b3e71dee9f7cf7dab610f7db0f40b9d27160f2f93e6dc5ad271b1",
        "authenticator": "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      }
    ],
    "batchNumber": "42"
  }'
```

### Important Considerations for Explicit Batch Numbering

1. **Sequential Processing**: Batches must still be processed in sequential order, regardless of their numbers.

2. **Gap Filling**: When using explicit batch numbers, you may create gaps in the sequence. These gaps can be filled with auto-numbered batches.

3. **Processing Order Requirements**: You cannot process a batch with a high number until all lower-numbered batches are processed.

4. **Error Handling**: If you try to create a batch with a number that already exists, the request will fail.

## 7. Error Handling

The API uses standard HTTP status codes along with detailed error messages:

| Status Code | Description |
|-------------|-------------|
| 200 | Success |
| 400 | Bad request (invalid parameters) |
| 401 | Unauthorized (authentication failure) |
| 404 | Resource not found |
| 500 | Server error |

Error responses include an error code and message:

```json
{
  "success": false,
  "error": "Invalid request - missing commitments"
}
```

For authentication errors:

```json
{
  "status": "AUTHENTICATION_FAILED"
}
```

## 8. Examples

### JavaScript Examples

#### Submit a Commitment

```javascript
async function submitCommitment() {
  const response = await fetch('https://gateway.example.com/submitCommitment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer your-api-key'
    },
    body: JSON.stringify({
      requestId: "1234567890",
      transactionHash: "0d89c2fd427b3e71dee9f7cf7dab610f7db0f40b9d27160f2f93e6dc5ad271b0",
      authenticator: {
        publicKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        stateHash: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
        signature: "001122334455667788990011223344556677889900112233445566778899001122334455667788990011223344556677889900112233445566778899001122"
      }
    })
  });
  
  const result = await response.json();
  console.log(result);
}
```

#### Submit a Batch with Explicit Number

```javascript
async function submitBatchWithExplicitNumber() {
  const response = await fetch('https://gateway.example.com/submitBatchWithNumber', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer your-api-key'
    },
    body: JSON.stringify({
      commitments: [
        {
          requestID: "1234567890",
          payload: "0x0d89c2fd427b3e71dee9f7cf7dab610f7db0f40b9d27160f2f93e6dc5ad271b0",
          authenticator: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        }
      ],
      batchNumber: "42"
    })
  });
  
  const result = await response.json();
  console.log(result);
}
```

### Python Examples

#### Submit a Commitment

```python
import requests
import json

def submit_commitment():
    url = "https://gateway.example.com/submitCommitment"
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer your-api-key"
    }
    data = {
        "requestId": "1234567890",
        "transactionHash": "0d89c2fd427b3e71dee9f7cf7dab610f7db0f40b9d27160f2f93e6dc5ad271b0",
        "authenticator": {
            "publicKey": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "stateHash": "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
            "signature": "001122334455667788990011223344556677889900112233445566778899001122334455667788990011223344556677889900112233445566778899001122"
        }
    }
    
    response = requests.post(url, headers=headers, data=json.dumps(data))
    return response.json()
```

#### Submit a Batch with Explicit Number

```python
import requests
import json

def submit_batch_with_explicit_number():
    url = "https://gateway.example.com/submitBatchWithNumber"
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer your-api-key"
    }
    data = {
        "commitments": [
            {
                "requestID": "1234567890",
                "payload": "0x0d89c2fd427b3e71dee9f7cf7dab610f7db0f40b9d27160f2f93e6dc5ad271b0",
                "authenticator": "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            }
        ],
        "batchNumber": "42"
    }
    
    response = requests.post(url, headers=headers, data=json.dumps(data))
    return response.json()
```

## 9. Running Your Own Gateway

To run your own gateway with the JSON-RPC API:

### Prerequisites

- Node.js v20.0.0 or higher
- Ethereum node access (via RPC)
- Gateway private key with gas funds
- Trusted aggregator status on the contract

### Installation

```bash
# Clone the repository
git clone https://github.com/example/eth-unicity-anchor.git
cd eth-unicity-anchor/ts-client

# Install dependencies
npm install

# Build the client
npm run build
```

### Configuration

Create a `.env` file with your configuration:

```
ETHEREUM_RPC_URL=https://eth-mainnet.provider.com
CONTRACT_ADDRESS=0x1234567890123456789012345678901234567890
GATEWAY_PRIVATE_KEY=0x...
API_KEY=your-api-key
JWT_SECRET=your-jwt-secret
PORT=3000
SWAGGER_PORT=3001
```

### Starting the Gateway Server

```bash
# Start the API server
node scripts/start-gateway.js

# Start the Swagger documentation server
npm run swagger
```

### Docker Deployment

```bash
# Build Docker image
docker build -t eth-unicity-gateway .

# Run container
docker run -p 3000:3000 -p 3001:3001 --env-file .env eth-unicity-gateway
```

## 10. Troubleshooting

### Common Issues and Solutions

| Issue | Possible Causes | Solutions |
|-------|-----------------|-----------|
| Authentication Error | Invalid API key or JWT | Check your authorization header |
| Invalid Request | Missing or malformed parameters | Check the request structure against the Swagger docs |
| Batch Already Exists | Attempted to create a batch with a number that already exists | Use a different batch number |
| Sequential Processing Error | Trying to process batches out of order | Process batches in sequential order |
| Gateway Timeout | Long-running transactions | Increase timeout settings |

### Debugging Tools

1. **Swagger UI**: Use the Swagger UI to test API calls directly in the browser
2. **Batch Status Inspection**: Check batch status through the contract directly
3. **Transaction Tracing**: Use Etherscan or other block explorers to trace transactions

### Getting Help

If you encounter issues that aren't covered here:

1. Check the Swagger documentation for the exact API requirements
2. Review the smart contract documentation for any constraints
3. Contact the support team at support@example.com

---

This documentation is maintained by the Ethereum Unicity Anchor team. For updates or contributions, please submit issues or pull requests to the repository.