import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';

/**
 * Simple HTTP server to serve Swagger documentation
 */
export class SwaggerServer {
  private server: http.Server;
  private port: number;

  /**
   * Constructor for SwaggerServer
   * @param port Port to listen on (default 3000)
   */
  constructor(port: number = 3000) {
    this.port = port;
    this.server = http.createServer(this.requestHandler.bind(this));
  }

  /**
   * Start the server
   * @returns Promise that resolves when server is listening
   */
  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`Swagger documentation server running at http://localhost:${this.port}/swagger`);
        resolve();
      });
    });
  }

  /**
   * Stop the server
   * @returns Promise that resolves when server is closed
   */
  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        console.log('Swagger documentation server stopped');
        resolve();
      });
    });
  }

  /**
   * Handle incoming HTTP requests
   * @param req HTTP request
   * @param res HTTP response
   */
  private async requestHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      // Parse URL
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const pathname = url.pathname;

      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      // Handle OPTIONS requests (CORS preflight)
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Only handle GET requests
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
      }

      // Handle the Swagger endpoints
      if (pathname === '/swagger' || pathname === '/swagger/') {
        // Redirect to index.html
        res.writeHead(302, { 'Location': '/swagger/index.html' });
        res.end();
        return;
      }

      if (pathname.startsWith('/swagger/')) {
        // Get the file path relative to the swagger directory
        const filePath = pathname.slice('/swagger/'.length);
        
        // Resolve the file path to the actual file system path
        const swaggerDir = path.resolve(__dirname, '..', 'swagger');
        const fullPath = path.join(swaggerDir, filePath || 'index.html');
        
        // Check if the file exists
        if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }
        
        // Get content type based on file extension
        const ext = path.extname(fullPath).toLowerCase();
        const contentTypes: Record<string, string> = {
          '.html': 'text/html',
          '.css': 'text/css',
          '.js': 'application/javascript',
          '.json': 'application/json',
          '.yaml': 'text/yaml',
          '.yml': 'text/yaml',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
        };
        
        const contentType = contentTypes[ext] || 'text/plain';
        
        // Read and serve the file
        const content = fs.readFileSync(fullPath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
        return;
      }

      // Default response for other routes
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (error) {
      console.error('Error handling request:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }
}

// If this file is run directly, start the server
if (require.main === module) {
  const port = parseInt(process.env.PORT || '3000', 10);
  const server = new SwaggerServer(port);
  server.start()
    .catch(error => {
      console.error('Error starting server:', error);
      process.exit(1);
    });
}