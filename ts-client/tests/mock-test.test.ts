import { ethers } from 'ethers';

describe('Mock Test', () => {
  it('should use the mocked ethers library', async () => {
    // Create a provider
    const provider = new ethers.JsonRpcProvider('http://non-existent-url');
    
    // This would fail if using real ethers.js, but should pass with our mock
    const network = await provider.getNetwork();
    expect(network.chainId).toBe(1);
    
    // Test transaction receipt mock
    const receipt = await provider.getTransactionReceipt('0xfakeHash');
    expect(receipt).toBeDefined();
    expect(receipt.hash).toBe('0xmocktx');
    
    // Just confirm we can complete the test without hanging
    expect(true).toBe(true);
  });
});