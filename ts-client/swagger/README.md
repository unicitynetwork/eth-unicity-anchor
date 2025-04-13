# Swagger Documentation for Ethereum Unicity Anchor Gateway API

This directory contains the Swagger/OpenAPI documentation for the Ethereum Unicity Anchor Gateway API.

## Files

- `api-docs.yaml` - The OpenAPI 3.0 specification for the Gateway API
- `index.html` - The Swagger UI page that renders the API documentation

## Viewing the Documentation

There are two ways to view the Swagger documentation:

### 1. Using the Built-in Swagger Server

You can start a dedicated Swagger documentation server by running:

```bash
# From the ts-client directory
npm run swagger
```

This will start a server at http://localhost:3000/swagger

If you want to build the TypeScript project and then start the server:

```bash
npm run swagger:build
```

You can also specify a custom port:

```bash
node scripts/start-swagger.js 8080
```

### 2. Using the Gateway HTTP Server

The API Gateway server itself also serves the Swagger documentation at the `/swagger` endpoint.

When the Gateway HTTP server is running, you can access the documentation at:

```
http://<gateway-host>:<gateway-port>/swagger
```

## Modifying the Documentation

To update the API documentation, edit the `api-docs.yaml` file. This file follows the OpenAPI 3.0 specification.

After making changes, the updates will be immediately visible when accessing the documentation through either method described above.

## Authentication

The API supports two authentication methods:

1. API Key Authentication - Using a Bearer token in the Authorization header
2. JWT Authentication - Using a JWT token in the Authorization header

Both authentication methods are described in the Swagger documentation.

## API Endpoints

The API provides endpoints for:

- Submitting individual commitments
- Submitting multiple commitments in a single transaction
- Creating batches with and without explicit batch numbers
- Retrieving inclusion proofs for commitments

See the full Swagger documentation for details on each endpoint.