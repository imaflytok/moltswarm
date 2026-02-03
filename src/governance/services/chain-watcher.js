/**
 * Chain Watcher Service
 * Monitors Hedera Mirror Node for $FLY token transfers to/from escrow
 * Auto-records stakes when tokens are transferred to escrow wallet
 */

const config = require('../config');
const staking = require('./staking');

// Escrow wallet for staking - tokens sent here count as staked
const ESCROW_WALLET = process.env.GOVERNANCE_ESCROW || '0.0.10176974';
const MIRROR_NODE = 'https://mainnet.mirrornode.hedera.com';
const FLY_TOKEN = config.token.id;  // 0.0.8012032
const POLL_INTERVAL = 30000;  // 30 seconds

// Track last processed timestamp to avoid duplicates
let lastProcessedTimestamp = null;
let isRunning = false;

/**
 * Start watching for transfers
 */
async function start() {
  if (isRunning) {
    console.log('⚠️ Chain watcher already running');
    return;
  }
  
  isRunning = true;
  console.log(`👁️ Chain watcher started`);
  console.log(`   Token: ${FLY_TOKEN}`);
  console.log(`   Escrow: ${ESCROW_WALLET}`);
  console.log(`   Poll interval: ${POLL_INTERVAL / 1000}s`);
  
  // Initial poll
  await pollTransfers();
  
  // Start polling loop
  setInterval(pollTransfers, POLL_INTERVAL);
}

/**
 * Poll for new transfers
 */
async function pollTransfers() {
  try {
    // Get recent token transfers to escrow (stakes)
    const stakeTxs = await getTransfersTo(ESCROW_WALLET);
    for (const tx of stakeTxs) {
      await processStake(tx);
    }
    
    // Get recent token transfers from escrow (unstakes)
    const unstakeTxs = await getTransfersFrom(ESCROW_WALLET);
    for (const tx of unstakeTxs) {
      await processUnstake(tx);
    }
  } catch (e) {
    console.error('Chain watcher poll error:', e.message);
  }
}

/**
 * Get $FLY transfers TO an account (stakes)
 */
async function getTransfersTo(accountId) {
  const url = `${MIRROR_NODE}/api/v1/transactions?account.id=${accountId}&transactiontype=CRYPTOTRANSFER&order=desc&limit=20`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.transactions) return [];
    
    const flyTransfers = [];
    
    for (const tx of data.transactions) {
      // Skip if already processed
      if (lastProcessedTimestamp && tx.consensus_timestamp <= lastProcessedTimestamp) {
        continue;
      }
      
      // Look for FLY token transfers in this transaction
      if (tx.token_transfers) {
        for (const transfer of tx.token_transfers) {
          if (transfer.token_id === FLY_TOKEN && 
              transfer.account === accountId && 
              transfer.amount > 0) {
            
            // Find the sender (negative amount in same tx)
            const sender = tx.token_transfers.find(t => 
              t.token_id === FLY_TOKEN && t.amount < 0
            );
            
            if (sender) {
              flyTransfers.push({
                txId: tx.transaction_id,
                timestamp: tx.consensus_timestamp,
                from: sender.account,
                to: accountId,
                amount: transfer.amount / Math.pow(10, config.token.decimals),
                rawAmount: transfer.amount
              });
            }
          }
        }
      }
    }
    
    return flyTransfers;
  } catch (e) {
    console.error('Error fetching transfers to:', e.message);
    return [];
  }
}

/**
 * Get $FLY transfers FROM an account (unstakes)
 */
async function getTransfersFrom(accountId) {
  const url = `${MIRROR_NODE}/api/v1/transactions?account.id=${accountId}&transactiontype=CRYPTOTRANSFER&order=desc&limit=20`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.transactions) return [];
    
    const flyTransfers = [];
    
    for (const tx of data.transactions) {
      if (lastProcessedTimestamp && tx.consensus_timestamp <= lastProcessedTimestamp) {
        continue;
      }
      
      if (tx.token_transfers) {
        for (const transfer of tx.token_transfers) {
          if (transfer.token_id === FLY_TOKEN && 
              transfer.account === accountId && 
              transfer.amount < 0) {
            
            // Find the recipient (positive amount in same tx)
            const recipient = tx.token_transfers.find(t => 
              t.token_id === FLY_TOKEN && t.amount > 0
            );
            
            if (recipient) {
              flyTransfers.push({
                txId: tx.transaction_id,
                timestamp: tx.consensus_timestamp,
                from: accountId,
                to: recipient.account,
                amount: Math.abs(transfer.amount) / Math.pow(10, config.token.decimals),
                rawAmount: Math.abs(transfer.amount)
              });
            }
          }
        }
      }
    }
    
    return flyTransfers;
  } catch (e) {
    console.error('Error fetching transfers from:', e.message);
    return [];
  }
}

/**
 * Process a stake transaction
 */
async function processStake(tx) {
  console.log(`📥 Stake detected: ${tx.from} -> ${tx.amount} $FLY`);
  
  try {
    // Check if wallet is linked
    const existingStake = await staking.getStakeByWallet(tx.from);
    
    if (!existingStake) {
      // Auto-link wallet (without Telegram for now)
      console.log(`   Auto-linking wallet: ${tx.from}`);
      await staking.linkWallet(tx.from, `auto_${tx.from}`);
    }
    
    // Record the stake
    await staking.recordStake(tx.from, tx.amount);
    console.log(`   ✅ Stake recorded: ${tx.amount} $FLY from ${tx.from}`);
    
    // Update last processed
    lastProcessedTimestamp = tx.timestamp;
  } catch (e) {
    console.error(`   ❌ Error processing stake:`, e.message);
  }
}

/**
 * Process an unstake transaction
 */
async function processUnstake(tx) {
  console.log(`📤 Unstake detected: ${tx.to} <- ${tx.amount} $FLY`);
  
  try {
    // This is trickier - we need to reduce the stake
    // For now, just log it (manual unstake handling)
    console.log(`   ⚠️ Unstake from escrow to ${tx.to} - manual review needed`);
    
    // Update last processed
    lastProcessedTimestamp = tx.timestamp;
  } catch (e) {
    console.error(`   ❌ Error processing unstake:`, e.message);
  }
}

/**
 * Get current escrow balance
 */
async function getEscrowBalance() {
  const url = `${MIRROR_NODE}/api/v1/accounts/${ESCROW_WALLET}/tokens?token.id=${FLY_TOKEN}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.tokens && data.tokens.length > 0) {
      const balance = data.tokens[0].balance / Math.pow(10, config.token.decimals);
      return balance;
    }
    return 0;
  } catch (e) {
    console.error('Error fetching escrow balance:', e.message);
    return 0;
  }
}

/**
 * Manual check - verify a specific transaction
 */
async function verifyTransaction(txId) {
  const url = `${MIRROR_NODE}/api/v1/transactions/${txId}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    return data;
  } catch (e) {
    console.error('Error verifying transaction:', e.message);
    return null;
  }
}

/**
 * Get watcher status
 */
function getStatus() {
  return {
    running: isRunning,
    escrowWallet: ESCROW_WALLET,
    tokenId: FLY_TOKEN,
    pollInterval: POLL_INTERVAL,
    lastProcessed: lastProcessedTimestamp
  };
}

module.exports = {
  start,
  getStatus,
  getEscrowBalance,
  verifyTransaction,
  ESCROW_WALLET
};
