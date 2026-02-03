/**
 * Analytics API Routes
 * Public endpoints for Hedera token analytics
 * Building blocks for OnlyFlies.buzz
 */

const express = require('express');
const router = express.Router();
const https = require('https');

const MIRROR_NODE = 'mainnet.mirrornode.hedera.com';
const CACHE_TTL = 60000; // 1 minute cache

// Simple in-memory cache
const cache = new Map();

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCache(key, data, ttl = CACHE_TTL) {
  cache.set(key, { data, expiresAt: Date.now() + ttl });
}

// Fetch from Mirror Node
function fetchMirror(path) {
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
        catch (e) { reject(new Error('Invalid JSON from Mirror Node')); }
      });
    }).on('error', reject);
  });
}

/**
 * GET /analytics/token/:tokenId
 * Get comprehensive token analytics
 */
router.get('/token/:tokenId', async (req, res) => {
  const { tokenId } = req.params;
  const cacheKey = `token:${tokenId}`;
  
  // Check cache
  const cached = getCached(cacheKey);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }
  
  try {
    // Fetch token info
    const token = await fetchMirror(`/tokens/${tokenId}`);
    
    if (!token.token_id) {
      return res.status(404).json({ error: 'Token not found' });
    }
    
    const decimals = token.decimals || 0;
    const totalSupply = parseInt(token.total_supply) / Math.pow(10, decimals);
    const maxSupply = token.max_supply ? parseInt(token.max_supply) / Math.pow(10, decimals) : null;
    
    // Fetch holders
    const holdersData = await fetchMirror(`/tokens/${tokenId}/balances?limit=100&order=desc`);
    const holders = holdersData.balances
      .filter(b => b.balance > 0)
      .map(b => ({
        account: b.account,
        balance: b.balance / Math.pow(10, decimals)
      }))
      .sort((a, b) => b.balance - a.balance);
    
    // Calculate stats
    const totalHeld = holders.reduce((sum, h) => sum + h.balance, 0);
    const top10 = holders.slice(0, 10);
    const top10Balance = top10.reduce((sum, h) => sum + h.balance, 0);
    
    const result = {
      token: {
        id: token.token_id,
        name: token.name,
        symbol: token.symbol,
        decimals,
        totalSupply,
        maxSupply,
        treasury: token.treasury_account_id,
        supplyType: token.supply_type,
        createdAt: token.created_timestamp
      },
      stats: {
        holderCount: holders.length,
        totalHeld,
        circulatingPercent: totalSupply > 0 ? (totalHeld / totalSupply * 100).toFixed(2) : 0,
        top10Percent: totalSupply > 0 ? (top10Balance / totalSupply * 100).toFixed(2) : 0
      },
      topHolders: top10.map(h => ({
        account: h.account,
        balance: h.balance,
        percent: totalSupply > 0 ? (h.balance / totalSupply * 100).toFixed(4) : 0
      })),
      timestamp: new Date().toISOString()
    };
    
    setCache(cacheKey, result);
    res.json(result);
  } catch (e) {
    console.error('Token analytics error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /analytics/token/:tokenId/holders
 * Get holder distribution
 */
router.get('/token/:tokenId/holders', async (req, res) => {
  const { tokenId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  
  try {
    const token = await fetchMirror(`/tokens/${tokenId}`);
    const decimals = token.decimals || 0;
    
    const holdersData = await fetchMirror(`/tokens/${tokenId}/balances?limit=${limit}&order=desc`);
    const holders = holdersData.balances
      .filter(b => b.balance > 0)
      .map(b => ({
        account: b.account,
        balance: b.balance / Math.pow(10, decimals)
      }));
    
    res.json({
      tokenId,
      count: holders.length,
      holders,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /analytics/token/:tokenId/transfers
 * Get recent transfers
 */
router.get('/token/:tokenId/transfers', async (req, res) => {
  const { tokenId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  
  try {
    const token = await fetchMirror(`/tokens/${tokenId}`);
    const decimals = token.decimals || 0;
    
    // Fetch recent transactions
    const txData = await fetchMirror(`/transactions?transactiontype=CRYPTOTRANSFER&limit=100&order=desc`);
    
    const transfers = [];
    for (const tx of txData.transactions) {
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
          timestamp: tx.consensus_timestamp,
          time: new Date(parseFloat(tx.consensus_timestamp) * 1000).toISOString()
        });
      }
      
      if (transfers.length >= limit) break;
    }
    
    res.json({
      tokenId,
      count: transfers.length,
      transfers,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /analytics/fly
 * Quick access to $FLY token data
 */
router.get('/fly', async (req, res) => {
  // Redirect to FLY token endpoint
  req.params.tokenId = '0.0.8012032';
  return router.handle(req, res);
});

/**
 * GET /analytics/health
 * Health check
 */
router.get('/health', async (req, res) => {
  try {
    await fetchMirror('/network/supply');
    res.json({ status: 'healthy', mirrorNode: MIRROR_NODE });
  } catch (e) {
    res.status(503).json({ status: 'unhealthy', error: e.message });
  }
});

module.exports = router;
