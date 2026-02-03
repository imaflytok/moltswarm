#!/usr/bin/env node
/**
 * $FLY Whale Monitor
 * Monitors large transfers and posts alerts to Discord
 * 
 * Run: node whale-monitor.js
 * Cron: run every 5 minutes
 */

const https = require('https');

const CONFIG = {
  TOKEN_ID: '0.0.8012032',
  TOKEN_SYMBOL: 'FLY',
  DECIMALS: 8,
  WHALE_THRESHOLD: 100, // Alert on transfers >= 100 FLY
  DISCORD_WEBHOOK: process.env.DISCORD_WHALE_WEBHOOK,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL: '-1002484820466', // @ima_fly channel
  STATE_FILE: '/tmp/whale-monitor-state.json'
};

// Simple HTTPS fetch
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Post to Discord webhook
async function postDiscord(message) {
  if (!CONFIG.DISCORD_WEBHOOK) return;
  
  const url = new URL(CONFIG.DISCORD_WEBHOOK);
  const postData = JSON.stringify({ content: message });
  
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Post to Telegram
async function postTelegram(message) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN) return;
  
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const postData = JSON.stringify({
    chat_id: CONFIG.TELEGRAM_CHANNEL,
    text: message,
    parse_mode: 'HTML'
  });
  
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Load last processed timestamp
function loadState() {
  try {
    const fs = require('fs');
    return JSON.parse(fs.readFileSync(CONFIG.STATE_FILE, 'utf8'));
  } catch {
    return { lastTimestamp: null, processedTxs: [] };
  }
}

// Save state
function saveState(state) {
  const fs = require('fs');
  fs.writeFileSync(CONFIG.STATE_FILE, JSON.stringify(state, null, 2));
}

// Format amount with decimals
function formatAmount(rawAmount) {
  const amount = rawAmount / Math.pow(10, CONFIG.DECIMALS);
  return amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Shorten account ID for display
function shortAccount(accountId) {
  return accountId; // Hedera IDs are already short
}

// Get recent token transfers
async function getTransfers() {
  const url = `https://mainnet.mirrornode.hedera.com/api/v1/tokens/${CONFIG.TOKEN_ID}/balances?limit=50&order=desc`;
  
  // Get transactions instead for transfer history
  const txUrl = `https://mainnet.mirrornode.hedera.com/api/v1/transactions?transactiontype=CRYPTOTRANSFER&limit=100&order=desc`;
  
  try {
    const data = await fetch(txUrl);
    return data.transactions || [];
  } catch (e) {
    console.error('Failed to fetch transactions:', e.message);
    return [];
  }
}

// Filter for FLY token transfers
function filterFlyTransfers(transactions) {
  return transactions.filter(tx => {
    if (!tx.token_transfers) return false;
    return tx.token_transfers.some(t => 
      t.token_id === CONFIG.TOKEN_ID && 
      Math.abs(t.amount) >= CONFIG.WHALE_THRESHOLD * Math.pow(10, CONFIG.DECIMALS)
    );
  });
}

// Format whale alert message
function formatAlert(tx) {
  const flyTransfers = tx.token_transfers.filter(t => t.token_id === CONFIG.TOKEN_ID);
  
  // Find sender (negative amount) and receiver (positive amount)
  const sender = flyTransfers.find(t => t.amount < 0);
  const receiver = flyTransfers.find(t => t.amount > 0);
  
  if (!sender || !receiver) return null;
  
  const amount = formatAmount(Math.abs(sender.amount));
  
  return {
    discord: `🐋 **WHALE ALERT**\n\n${amount} $${CONFIG.TOKEN_SYMBOL} transferred\n\nFrom: \`${sender.account}\`\nTo: \`${receiver.account}\`\n\n[View on HashScan](https://hashscan.io/mainnet/transaction/${tx.transaction_id})`,
    telegram: `🐋 <b>WHALE ALERT</b>\n\n${amount} $${CONFIG.TOKEN_SYMBOL} transferred\n\nFrom: <code>${sender.account}</code>\nTo: <code>${receiver.account}</code>\n\n<a href="https://hashscan.io/mainnet/transaction/${tx.transaction_id}">View on HashScan</a>`
  };
}

// Main monitoring function
async function monitor() {
  console.log(`[${new Date().toISOString()}] Checking for whale transfers...`);
  
  const state = loadState();
  const transactions = await getTransfers();
  const flyTransfers = filterFlyTransfers(transactions);
  
  console.log(`Found ${flyTransfers.length} FLY whale transfers`);
  
  let newAlerts = 0;
  
  for (const tx of flyTransfers) {
    // Skip already processed
    if (state.processedTxs.includes(tx.transaction_id)) continue;
    
    const alert = formatAlert(tx);
    if (!alert) continue;
    
    console.log(`New whale transfer: ${tx.transaction_id}`);
    
    // Post alerts
    try {
      if (CONFIG.DISCORD_WEBHOOK) {
        await postDiscord(alert.discord);
        console.log('Posted to Discord');
      }
      if (CONFIG.TELEGRAM_BOT_TOKEN) {
        await postTelegram(alert.telegram);
        console.log('Posted to Telegram');
      }
    } catch (e) {
      console.error('Failed to post alert:', e.message);
    }
    
    // Mark as processed
    state.processedTxs.push(tx.transaction_id);
    newAlerts++;
  }
  
  // Keep only last 1000 processed txs
  if (state.processedTxs.length > 1000) {
    state.processedTxs = state.processedTxs.slice(-500);
  }
  
  state.lastRun = new Date().toISOString();
  saveState(state);
  
  console.log(`Processed ${newAlerts} new alerts`);
}

// Run
monitor().catch(console.error);
