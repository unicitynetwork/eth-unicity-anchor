/**
 * Fetch Logs Script
 * 
 * A utility script for retrieving and parsing logs from Ethereum nodes
 * during development and testing.
 */

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// Configuration
const DEFAULT_CONFIG = {
  logPath: './logs',
  nodeUrl: 'http://localhost:8545',
  contractAddress: process.env.CONTRACT_ADDRESS,
  startBlock: 0,
  endBlock: 'latest',
  maxResults: 1000,
  eventSignatures: {
    BatchCreated: 'BatchCreated(uint256,uint256)',
    CommitmentSubmitted: 'CommitmentSubmitted(uint256,bytes32,bytes32)',
    HashrootSubmitted: 'HashrootSubmitted(uint256,bytes32)',
  }
};

// Parse command line arguments
const args = process.argv.slice(2);
const parsedArgs = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
    parsedArgs[key] = value;
    if (value !== true) i++;
  }
}

// Merge default config with command line args
const config = { ...DEFAULT_CONFIG, ...parsedArgs };

// Initialize provider
const provider = new ethers.JsonRpcProvider(config.nodeUrl);

// Set up ABI interface for event decoding
const iface = new ethers.Interface([
  `event ${config.eventSignatures.BatchCreated}`,
  `event ${config.eventSignatures.CommitmentSubmitted}`,
  `event ${config.eventSignatures.HashrootSubmitted}`,
]);

// Print config information
console.log('Fetching logs with configuration:');
console.log(`  Node URL: ${config.nodeUrl}`);
console.log(`  Contract Address: ${config.contractAddress || 'Not specified'}`);
console.log(`  Start Block: ${config.startBlock}`);
console.log(`  End Block: ${config.endBlock}`);
console.log(`  Max Results: ${config.maxResults}`);
console.log(`  Output Path: ${config.logPath}`);
console.log('');

// Ensure the logs directory exists
if (!fs.existsSync(config.logPath)) {
  fs.mkdirSync(config.logPath, { recursive: true });
}

// Main function to fetch logs
async function fetchLogs() {
  if (!config.contractAddress) {
    console.error('Error: Contract address is required. Use --contractAddress or set CONTRACT_ADDRESS env variable.');
    process.exit(1);
  }

  try {
    // Get the events from specified contract
    console.log(`Fetching logs for contract ${config.contractAddress}...`);
    
    const filter = {
      address: config.contractAddress,
      fromBlock: config.startBlock,
      toBlock: config.endBlock,
    };
    
    const logs = await provider.getLogs(filter);
    console.log(`Found ${logs.length} logs`);
    
    if (logs.length > config.maxResults) {
      console.warn(`Warning: Found ${logs.length} logs, limiting to ${config.maxResults}`);
      logs.length = config.maxResults;
    }
    
    // Process and decode logs
    const processedLogs = logs.map(log => {
      try {
        const parsedLog = iface.parseLog(log);
        return {
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          logIndex: log.logIndex,
          name: parsedLog.name,
          args: Array.from(parsedLog.args).map(arg => 
            typeof arg === 'bigint' ? arg.toString() : arg
          )
        };
      } catch (e) {
        // If we can't parse the log with our interface, return minimal info
        return {
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          logIndex: log.logIndex,
          topics: log.topics,
          data: log.data,
          error: 'Could not parse log'
        };
      }
    });
    
    // Save logs to file
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filename = path.join(config.logPath, `logs-${timestamp}.json`);
    
    fs.writeFileSync(filename, JSON.stringify(processedLogs, null, 2));
    console.log(`Logs saved to ${filename}`);
    
    // Print summary
    const eventCount = {};
    processedLogs.forEach(log => {
      if (log.name) {
        eventCount[log.name] = (eventCount[log.name] || 0) + 1;
      } else {
        eventCount['unknown'] = (eventCount['unknown'] || 0) + 1;
      }
    });
    
    console.log('\nEvent Summary:');
    Object.entries(eventCount).forEach(([event, count]) => {
      console.log(`  ${event}: ${count}`);
    });
    
  } catch (error) {
    console.error('Error fetching logs:', error);
    process.exit(1);
  }
}

// Execute the main function
fetchLogs().catch(console.error);