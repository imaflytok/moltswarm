#!/usr/bin/env node
/**
 * Token Analytics Tool
 * Query Hedera token data for analytics
 * 
 * Usage: node token-analytics.js <token_id> [--json]
 */

const https = require('https');

const MIRROR_NODE = 'mainnet.mirrornode.hedera.com';

// Fetch JSON from Mirror Node
function fetch(path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: MIRROR_NODE,
      path: `/api/v1${path}`,
      headers: { 'Accept': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Format number with commas
function formatNum(n, decimals = 0) {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

// Get token info
async function getTokenInfo(tokenId) {
  const token = await fetch(`/tokens/${tokenId}`);
  return {
    id: token.token_id,
    name: token.name,
    symbol: token.symbol,
    decimals: token.decimals,
    totalSupply: parseInt(token.total_supply) / Math.pow(10, token.decimals),
    maxSupply: token.max_supply ? parseInt(token.max_supply) / Math.pow(10, token.decimals) : null,
    treasury: token.treasury_account_id,
    supplyType: token.supply_type,
    createdAt: token.created_timestamp
  };
}

// Get top holders
async function getTopHolders(tokenId, decimals, limit = 10) {
  const data = await fetch(`/tokens/${tokenId}/balances?limit=50&order=desc`);
  
  const holders = data.balances
    .filter(b => b.balance > 0)
    .map(b => ({
      account: b.account,
      balance: b.balance / Math.pow(10, decimals),
      decimals: b.decimals
    }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit);
  
  return holders;
}

// Get recent transfers
async function getRecentTransfers(tokenId, decimals, limit = 10) {
  const data = await fetch(`/transactions?transactiontype=CRYPTOTRANSFER&limit=100&order=desc`);
  
  const transfers = [];
  for (const tx of data.transactions) {
    if (!tx.token_transfers) continue;
    
    const tokenTx = tx.token_transfers.filter(t => t.token_id === tokenId);
    if (tokenTx.length === 0) continue;
    
    const sender = tokenTx.find(t => t.amount < 0);
    const receiver = tokenTx.find(t => t.amount > 0);
    
    if (sender && receiver) {
      transfers.push({
        txId: tx.transaction_id,
        from: sender.account,
        to: receiver.account,
        amount: Math.abs(sender.amount) / Math.pow(10, decimals),
        timestamp: tx.consensus_timestamp
      });
    }
    
    if (transfers.length >= limit) break;
  }
  
  return transfers;
}

// Calculate holder stats
function analyzeHolders(holders, totalSupply) {
  const total = holders.reduce((sum, h) => sum + h.balance, 0);
  const top10 = holders.slice(0, 10).reduce((sum, h) => sum + h.balance, 0);
  
  return {
    holderCount: holders.length,
    totalHeld: total,
    percentHeld: (total / totalSupply * 100).toFixed(2),
    top10Held: top10,
    top10Percent: (top10 / totalSupply * 100).toFixed(2),
    giniCoefficient: calculateGini(holders.map(h => h.balance))
  };
}

// Simple Gini coefficient (0 = equal, 1 = one holds all)
function calculateGini(values) {
  const n = values.length;
  if (n === 0) return 0;
  
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  
  let cumulativeSum = 0;
  let giniSum = 0;
  
  for (let i = 0; i < n; i++) {
    cumulativeSum += sorted[i];
    giniSum += (2 * (i + 1) - n - 1) * sorted[i];
  }
  
  return giniSum / (n * sum);
}

// Main analysis function
async function analyzeToken(tokenId) {
  console.log(`\n📊 Analyzing token: ${tokenId}\n`);
  
  // Get token info
  const info = await getTokenInfo(tokenId);
  console.log('=== Token Info ===');
  console.log(`Name: ${info.name} (${info.symbol})`);
  console.log(`ID: ${info.id}`);
  console.log(`Supply: ${formatNum(info.totalSupply)} / ${info.maxSupply ? formatNum(info.maxSupply) : '∞'}`);
  console.log(`Treasury: ${info.treasury}`);
  console.log(`Created: ${new Date(parseFloat(info.createdAt) * 1000).toISOString()}`);
  
  // Get holders
  const holders = await getTopHolders(tokenId, info.decimals, 20);
  const stats = analyzeHolders(holders, info.totalSupply);
  
  console.log('\n=== Holder Analysis ===');
  console.log(`Active Holders: ${stats.holderCount}`);
  console.log(`Top 10 Hold: ${stats.top10Percent}%`);
  console.log(`Gini Coefficient: ${stats.giniCoefficient.toFixed(3)} (0=equal, 1=concentrated)`);
  
  console.log('\n=== Top Holders ===');
  for (let i = 0; i < Math.min(holders.length, 5); i++) {
    const h = holders[i];
    const pct = (h.balance / info.totalSupply * 100).toFixed(2);
    console.log(`${i + 1}. ${h.account}: ${formatNum(h.balance, 2)} (${pct}%)`);
  }
  
  // Get recent transfers
  const transfers = await getRecentTransfers(tokenId, info.decimals, 5);
  
  if (transfers.length > 0) {
    console.log('\n=== Recent Transfers ===');
    for (const tx of transfers) {
      const time = new Date(parseFloat(tx.timestamp) * 1000).toLocaleTimeString();
      console.log(`${time}: ${tx.from} → ${tx.to}: ${formatNum(tx.amount, 2)}`);
    }
  }
  
  // Return data for JSON output
  return {
    token: info,
    holders: holders.slice(0, 10),
    stats,
    recentTransfers: transfers
  };
}

// CLI
const args = process.argv.slice(2);
const tokenId = args[0] || '0.0.8012032'; // Default to $FLY
const jsonOutput = args.includes('--json');

analyzeToken(tokenId)
  .then(data => {
    if (jsonOutput) {
      console.log('\n=== JSON Output ===');
      console.log(JSON.stringify(data, null, 2));
    }
  })
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
