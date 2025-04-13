#!/usr/bin/env node

/**
 * Standalone script to start the Swagger documentation server
 */

// Load the compiled swagger-server module
try {
  const { SwaggerServer } = require('../dist/swagger-server');
  
  // Get port from command line arguments or environment variable, or use default
  const port = process.argv[2] || process.env.PORT || 3000;
  
  // Create and start the server
  console.log(`Starting Swagger documentation server on port ${port}...`);
  const server = new SwaggerServer(parseInt(port, 10));
  
  server.start()
    .then(() => {
      console.log(`Swagger UI is now available at http://localhost:${port}/swagger`);
      console.log('Press Ctrl+C to stop the server');
    })
    .catch(err => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('Shutting down server...');
    server.stop()
      .then(() => {
        console.log('Server stopped');
        process.exit(0);
      })
      .catch(err => {
        console.error('Error shutting down server:', err);
        process.exit(1);
      });
  });
} catch (error) {
  console.error('Error loading SwaggerServer module:', error);
  console.error('\nMake sure you have built the TypeScript project:');
  console.error('  cd ts-client && npm run build');
  process.exit(1);
}