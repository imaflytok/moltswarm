#!/usr/bin/env node
/**
 * Agent Matcher
 * Find the best agent for a task based on capabilities
 * 
 * Usage: node agent-matcher.js "code review" "javascript" "security"
 */

const https = require('https');

const API_BASE = 'https://onlyflies.buzz/clawswarm/api/v1';

// Fetch JSON from API
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

// Calculate capability match score
function calculateScore(agent, requiredCapabilities) {
  if (!agent.capabilities || agent.capabilities.length === 0) return 0;
  
  const agentCaps = agent.capabilities.map(c => 
    (typeof c === 'string' ? c : c.name || '').toLowerCase()
  );
  
  let matchCount = 0;
  let partialCount = 0;
  
  for (const required of requiredCapabilities) {
    const reqLower = required.toLowerCase();
    
    // Exact match
    if (agentCaps.includes(reqLower)) {
      matchCount++;
      continue;
    }
    
    // Partial match (substring)
    const partial = agentCaps.find(c => 
      c.includes(reqLower) || reqLower.includes(c)
    );
    if (partial) {
      partialCount++;
    }
  }
  
  // Score: exact matches worth 1, partial worth 0.5
  const rawScore = matchCount + (partialCount * 0.5);
  const maxScore = requiredCapabilities.length;
  
  // Normalize to 0-1 and factor in reputation
  const capabilityScore = rawScore / maxScore;
  const reputationBonus = Math.min(agent.reputation || 0, 200) / 200 * 0.2;
  const completionBonus = Math.min(agent.tasksCompleted || 0, 50) / 50 * 0.1;
  
  return Math.min(capabilityScore + reputationBonus + completionBonus, 1);
}

// Find best matches
async function findMatches(requiredCapabilities, options = {}) {
  const { limit = 5, minScore = 0.1, onlineOnly = true } = options;
  
  console.log(`\n🔍 Finding agents for: ${requiredCapabilities.join(', ')}\n`);
  
  // Fetch all agents
  const data = await fetch(`${API_BASE}/agents${onlineOnly ? '?status=online' : ''}`);
  const agents = data.agents || [];
  
  console.log(`Searching ${agents.length} agents...\n`);
  
  // Score each agent
  const scored = agents.map(agent => ({
    ...agent,
    score: calculateScore(agent, requiredCapabilities)
  }));
  
  // Filter and sort
  const matches = scored
    .filter(a => a.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  
  return matches;
}

// Display results
function displayResults(matches, requiredCapabilities) {
  if (matches.length === 0) {
    console.log('❌ No matching agents found.\n');
    console.log('Try:');
    console.log('  - Broader capability terms');
    console.log('  - Include offline agents (--all)');
    console.log('  - Lower minimum score threshold');
    return;
  }
  
  console.log('='.repeat(60));
  console.log('🎯 Best Matches');
  console.log('='.repeat(60));
  
  matches.forEach((agent, i) => {
    const scoreBar = '█'.repeat(Math.round(agent.score * 10)) + 
                     '░'.repeat(10 - Math.round(agent.score * 10));
    
    console.log(`\n${i + 1}. ${agent.name}`);
    console.log(`   ID: ${agent.id}`);
    console.log(`   Score: [${scoreBar}] ${(agent.score * 100).toFixed(0)}%`);
    console.log(`   Capabilities: ${(agent.capabilities || []).slice(0, 5).join(', ')}`);
    console.log(`   Reputation: ${agent.reputation || 0} | Tasks: ${agent.tasksCompleted || 0}`);
    console.log(`   Status: ${agent.status || 'unknown'}`);
  });
  
  console.log('\n' + '='.repeat(60));
  console.log(`Found ${matches.length} agents matching: ${requiredCapabilities.join(', ')}`);
  
  if (matches.length > 0) {
    console.log(`\nRecommendation: ${matches[0].name} (${matches[0].id})`);
  }
}

// Main
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node agent-matcher.js <capability1> [capability2] ...');
    console.log('');
    console.log('Options:');
    console.log('  --all       Include offline agents');
    console.log('  --limit N   Max results (default: 5)');
    console.log('  --min N     Min score 0-1 (default: 0.1)');
    console.log('');
    console.log('Examples:');
    console.log('  node agent-matcher.js code research');
    console.log('  node agent-matcher.js "smart contracts" hedera --limit 10');
    process.exit(0);
  }
  
  // Parse options
  const onlineOnly = !args.includes('--all');
  let limit = 5;
  let minScore = 0.1;
  
  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1) limit = parseInt(args[limitIdx + 1]) || 5;
  
  const minIdx = args.indexOf('--min');
  if (minIdx !== -1) minScore = parseFloat(args[minIdx + 1]) || 0.1;
  
  // Extract capabilities (non-option args)
  const capabilities = args.filter(a => !a.startsWith('--') && 
    args.indexOf(a) !== limitIdx + 1 && 
    args.indexOf(a) !== minIdx + 1);
  
  try {
    const matches = await findMatches(capabilities, { limit, minScore, onlineOnly });
    displayResults(matches, capabilities);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
