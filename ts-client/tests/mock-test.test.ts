// Note: importing directly from 'ethers' here is fine
// jest.setup.js is handling the mocking for us globally
import { ethers } from 'ethers';

describe('Mock Test', () => {
  it('should use the mocked ethers library', async () => {
    // Create a provider
    const provider = new ethers.JsonRpcProvider('http://non-existent-url');
    
    // This would fail if using real ethers.js, but should pass with our mock
    const network = await provider.getNetwork();
    expect(network.chainId).toBe(1);
    
    // Test transaction receipt mock for existing transaction
    const receipt = await provider.getTransactionReceipt('0xfakeHash');
    expect(receipt).toBeDefined();
    expect(receipt).not.toBeNull();
    
    if (receipt) {
      // Using proper null check instead of non-null assertion
      expect(receipt.hash).toBe('0xmocktx');
      expect(receipt.blockNumber).toBe(12345);
    }
    
    // Test null receipt for non-existent transaction
    const nullReceipt = await provider.getTransactionReceipt('0xnonexistent');
    expect(nullReceipt).toBeNull();
    
    // Test additional utilities
    const bytes = ethers.getBytes('0x1234');
    expect(bytes).toBeInstanceOf(Uint8Array);
    
    const hash = ethers.keccak256('test');
    expect(hash).toContain('0x');
    
    // Just confirm we can complete the test without hanging
    expect(true).toBe(true);
  });
});