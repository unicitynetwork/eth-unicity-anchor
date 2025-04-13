/**
 * Setup file specific to integration tests
 */
const fs = require('fs');
const path = require('path');

// Mock the SparseMerkleTree and HashAlgorithm from @unicitylabs/commons for integration tests
// This is an enhanced simulation that maintains an actual tree structure and calculates real hashroots
jest.mock('@unicitylabs/commons/lib/smt/SparseMerkleTree.js', () => {
  const crypto = require('crypto');
  
  // Simple hash function for SMT simulation
  const sha256 = (data) => {
    if (!(data instanceof Uint8Array)) {
      if (typeof data === 'bigint') {
        // Convert BigInt to buffer
        const hex = data.toString(16);
        const buffer = Buffer.from(hex.padStart(64, '0'), 'hex');
        data = new Uint8Array(buffer);
      } else if (typeof data === 'string') {
        data = new TextEncoder().encode(data);
      } else if (Buffer.isBuffer(data)) {
        // Already a buffer, just use it directly
        return crypto.createHash('sha256').update(data).digest();
      } else {
        // Default fallback
        data = new Uint8Array(8);
      }
    }
    return crypto.createHash('sha256').update(Buffer.from(data)).digest();
  };
  
  return {
    SparseMerkleTree: class SparseMerkleTree {
      constructor(algorithm) {
        this.algorithm = algorithm;
        // Store leaves in a map: path => value
        this.leaves = new Map();
        // Generate new root hash
        this.updateRootHash();
      }
      
      static async create(algorithm) {
        return new SparseMerkleTree(algorithm);
      }
      
      get rootHash() {
        return {
          data: this._rootHashData,
          toString: () => `[SHA256]${Buffer.from(this._rootHashData).toString('hex').substring(0, 10)}...`
        };
      }
      
      // Add a leaf and update the root hash
      async addLeaf(path, value) {
        // Ensure value is a Uint8Array
        if (!(value instanceof Uint8Array)) {
          if (Buffer.isBuffer(value)) {
            value = new Uint8Array(value);
          } else if (typeof value === 'string') {
            value = new TextEncoder().encode(value);
          }
        }
        
        this.leaves.set(path.toString(), value);
        // Update root hash after adding a leaf
        this.updateRootHash();
        return Promise.resolve();
      }
      
      // Update the root hash based on current leaves
      updateRootHash() {
        if (this.leaves.size === 0) {
          // Empty tree - default hash
          this._rootHashData = new Uint8Array([0, 0, 0, 0]);
          return;
        }
        
        // Sort leaf paths for consistent hashing
        const sortedLeaves = Array.from(this.leaves.entries()).sort((a, b) => 
          BigInt(a[0]) < BigInt(b[0]) ? -1 : BigInt(a[0]) > BigInt(b[0]) ? 1 : 0
        );
        
        // If only one leaf, use a simple hash
        if (sortedLeaves.length === 1) {
          const [path, value] = sortedLeaves[0];
          const pathBuffer = Buffer.from(path);
          const valueBuffer = Buffer.from(value);
          this._rootHashData = sha256(Buffer.concat([pathBuffer, valueBuffer]));
          return;
        }
        
        // Create combined buffer of all path+value pairs
        let combinedData = Buffer.alloc(0);
        
        // Combine all leaf data
        for (const [path, value] of sortedLeaves) {
          // Convert path to buffer
          let pathBuffer;
          try {
            pathBuffer = Buffer.from(path);
          } catch (e) {
            // Alternative conversion if direct buffer conversion fails
            pathBuffer = Buffer.from(path.toString());
          }
          
          // Ensure value is a buffer
          let valueBuffer;
          if (Buffer.isBuffer(value)) {
            valueBuffer = value;
          } else {
            valueBuffer = Buffer.from(value);
          }
          
          // Hash this leaf
          const leafHash = sha256(Buffer.concat([pathBuffer, valueBuffer]));
          
          // Add to combined data
          combinedData = Buffer.concat([combinedData, leafHash]);
        }
        
        // Create root hash from all leaf hashes
        this._rootHashData = sha256(combinedData);
        
        // The root hash data should always be a Uint8Array
        if (!(this._rootHashData instanceof Uint8Array)) {
          this._rootHashData = new Uint8Array(this._rootHashData);
        }
      }
      
      // Get a verification path for a leaf
      getPath(path) {
        const pathStr = path.toString();
        const hasLeaf = this.leaves.has(pathStr);
        
        return {
          verify: async (verifyPath) => {
            const verifyPathStr = verifyPath.toString();
            return {
              isPathIncluded: verifyPathStr === pathStr && hasLeaf,
              isPathValid: true,
              result: verifyPathStr === pathStr && hasLeaf
            };
          },
          toString: () => `MerkleTreePath for path ${path} (exists: ${hasLeaf})`
        };
      }
      
      toString() {
        return `SparseMerkleTree [Simulated] with ${this.leaves.size} leaves, root: ${this.rootHash.toString()}`;
      }
    }
  };
}, { virtual: true });

jest.mock('@unicitylabs/commons/lib/hash/HashAlgorithm.js', () => {
  return {
    HashAlgorithm: {
      SHA256: 0,
      SHA224: 1,
      SHA384: 2,
      SHA512: 3,
      RIPEMD160: 4
    }
  };
}, { virtual: true });

// Set a longer timeout for integration tests
jest.setTimeout(90000);

// Load the contract ABI
let cachedContractAbi = null;

// Helper to read the contract ABI
global.getContractABI = () => {
  if (cachedContractAbi) return cachedContractAbi;
  
  try {
    // Try to load from the generated contract-abi.json file
    const abiPath = path.resolve(__dirname, '../contract-abi.json');
    if (fs.existsSync(abiPath)) {
      console.log('Using ABI from contract-abi.json');
      cachedContractAbi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
      return cachedContractAbi;
    }
  } catch (err) {
    console.warn('Failed to load ABI from contract-abi.json:', err.message);
  }
  
  // Fallback to the default ABI from the client
  console.log('Using default ABI from client');
  const { ABI } = require('./src/abi');
  cachedContractAbi = ABI;
  return cachedContractAbi;
};

// Global beforeAll hook for integration test suites
beforeAll(() => {
  console.log('Starting integration test suite');
  
  // Preload the contract ABI
  const abi = global.getContractABI();
  console.log(`Loaded contract ABI with ${abi.length} entries`);
  
  // Give the node some time to stabilize
  return new Promise(resolve => setTimeout(resolve, 1000));
});

// Global afterAll hook for integration test suites
afterAll(() => {
  console.log('Completed integration test suite');
  
  // Allow time for provider cleanup
  return new Promise(resolve => setTimeout(resolve, 1000));
});