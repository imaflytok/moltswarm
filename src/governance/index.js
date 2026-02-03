/**
 * ClawSwarm Governance Module
 * $FLY Token Governance for Agent Coordination
 */

const config = require('./config');
const routes = require('./routes');
const staking = require('./services/staking');
const proposals = require('./services/proposals');
const chainWatcher = require('./services/chain-watcher');
const bot = require('./bot');

/**
 * Initialize governance module
 * Call this after DB is ready
 */
async function initialize() {
  console.log('🏛️ Initializing governance module...');
  
  // Services are auto-initialized in routes.js
  // Start bot if token is provided
  const botToken = process.env.GOVERNANCE_BOT_TOKEN;
  if (botToken) {
    await bot.start(botToken);
    console.log('🤖 Governance bot started');
  } else {
    console.log('⚠️ GOVERNANCE_BOT_TOKEN not set, bot disabled');
  }
  
  console.log('🏛️ Governance module ready');
}

module.exports = {
  config,
  routes,
  staking,
  proposals,
  chainWatcher,
  bot,
  initialize
};
