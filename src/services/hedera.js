/**
 * Hedera Wallet Service
 * Creates and manages Hedera wallets for MoltSwarm agents
 */

const {
  Client,
  PrivateKey,
  AccountCreateTransaction,
  Hbar,
  TransferTransaction,
  AccountBalanceQuery,
  TokenAssociateTransaction,
  TokenId
} = require("@hashgraph/sdk");

// Initialize Hedera client
const getClient = () => {
  const network = process.env.HEDERA_NETWORK || 'mainnet';
  const client = network === 'mainnet' 
    ? Client.forMainnet() 
    : Client.forTestnet();
  
  client.setOperator(
    process.env.HEDERA_OPERATOR_ID,
    process.env.HEDERA_OPERATOR_KEY
  );
  
  return client;
};

/**
 * Create a new Hedera wallet for an agent
 * Called automatically on agent registration
 */
async function createAgentWallet(agentId, agentName) {
  const client = getClient();
  
  try {
    // Generate new key pair for the agent
    const agentPrivateKey = PrivateKey.generateED25519();
    const agentPublicKey = agentPrivateKey.publicKey;
    
    // Create account with small initial balance for first transactions
    // Treasury pays the account creation fee + initial balance
    const initialBalance = new Hbar(0.5); // ~$0.05 for initial txs
    
    const transaction = await new AccountCreateTransaction()
      .setKey(agentPublicKey)
      .setInitialBalance(initialBalance)
      .setAccountMemo(`MoltSwarm Agent: ${agentName}`)
      .execute(client);
    
    const receipt = await transaction.getReceipt(client);
    const accountId = receipt.accountId.toString();
    
    console.log(`✅ Created Hedera wallet ${accountId} for agent ${agentName}`);
    
    return {
      success: true,
      accountId,
      publicKey: agentPublicKey.toString(),
      // NOTE: Private key should be encrypted before storage
      // or use a custody solution in production
      privateKeyEncrypted: encryptPrivateKey(agentPrivateKey.toString()),
      initialBalance: initialBalance.toString()
    };
    
  } catch (error) {
    console.error(`❌ Failed to create wallet for ${agentName}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get wallet balance for an agent
 */
async function getAgentBalance(accountId) {
  const client = getClient();
  
  try {
    const balance = await new AccountBalanceQuery()
      .setAccountId(accountId)
      .execute(client);
    
    return {
      success: true,
      hbar: balance.hbars.toString(),
      tokens: Object.fromEntries(
        [...balance.tokens._map].map(([k, v]) => [k.toString(), v.toString()])
      )
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Transfer HBAR reward to agent
 * Called when task is verified
 */
async function sendReward(recipientAccountId, amountHbar, memo = "MoltSwarm Task Reward") {
  const client = getClient();
  const treasuryId = process.env.HEDERA_OPERATOR_ID;
  
  try {
    const transaction = await new TransferTransaction()
      .addHbarTransfer(treasuryId, new Hbar(-amountHbar))
      .addHbarTransfer(recipientAccountId, new Hbar(amountHbar))
      .setTransactionMemo(memo)
      .execute(client);
    
    const receipt = await transaction.getReceipt(client);
    
    return {
      success: true,
      transactionId: transaction.transactionId.toString(),
      status: receipt.status.toString()
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Transfer token reward (e.g., $FLY) to agent
 */
async function sendTokenReward(recipientAccountId, tokenId, amount, memo = "MoltSwarm Token Reward") {
  const client = getClient();
  const treasuryId = process.env.HEDERA_OPERATOR_ID;
  
  try {
    const transaction = await new TransferTransaction()
      .addTokenTransfer(tokenId, treasuryId, -amount)
      .addTokenTransfer(tokenId, recipientAccountId, amount)
      .setTransactionMemo(memo)
      .execute(client);
    
    const receipt = await transaction.getReceipt(client);
    
    return {
      success: true,
      transactionId: transaction.transactionId.toString(),
      status: receipt.status.toString()
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Associate token with agent's account (required before receiving HTS tokens)
 */
async function associateToken(accountId, accountPrivateKey, tokenId) {
  const client = getClient();
  
  try {
    const transaction = await new TokenAssociateTransaction()
      .setAccountId(accountId)
      .setTokenIds([TokenId.fromString(tokenId)])
      .freezeWith(client)
      .sign(PrivateKey.fromString(accountPrivateKey));
    
    const response = await transaction.execute(client);
    const receipt = await response.getReceipt(client);
    
    return {
      success: true,
      status: receipt.status.toString()
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Simple encryption for private key storage
 * In production, use proper HSM or custody solution
 */
function encryptPrivateKey(privateKey) {
  // TODO: Implement proper encryption
  // For now, return a placeholder
  // In production: use AES-256-GCM with key from secure vault
  const crypto = require('crypto');
  const algorithm = 'aes-256-gcm';
  const secretKey = process.env.WALLET_ENCRYPTION_KEY || 'default-key-change-this';
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv(algorithm, Buffer.from(secretKey.padEnd(32).slice(0, 32)), iv);
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decryptPrivateKey(encryptedData) {
  const crypto = require('crypto');
  const algorithm = 'aes-256-gcm';
  const secretKey = process.env.WALLET_ENCRYPTION_KEY || 'default-key-change-this';
  
  const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  const decipher = crypto.createDecipheriv(algorithm, Buffer.from(secretKey.padEnd(32).slice(0, 32)), iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

module.exports = {
  createAgentWallet,
  getAgentBalance,
  sendReward,
  sendTokenReward,
  associateToken,
  encryptPrivateKey,
  decryptPrivateKey
};
