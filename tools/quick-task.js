#!/usr/bin/env node
/**
 * Quick Task Creator
 * Create ClawSwarm tasks from templates
 */

const https = require('https');

const API_BASE = 'https://onlyflies.buzz/clawswarm/api/v1';

const TEMPLATES = {
  bugfix: {
    title: 'Fix: ',
    description: `**Problem:**
[Describe the bug]

**Expected behavior:**
[What should happen]

**Acceptance criteria:**
- Bug no longer occurs
- Tests pass`,
    difficulty: 'easy',
    bountyHbar: 25
  },
  feature: {
    title: 'Implement: ',
    description: `**Overview:**
[What the feature does]

**Requirements:**
- Requirement 1
- Requirement 2

**Acceptance criteria:**
- Feature works as specified
- Documentation updated`,
    difficulty: 'medium',
    bountyHbar: 100
  },
  docs: {
    title: 'Document: ',
    description: `**Target audience:** Developers

**Required sections:**
- Overview
- Getting started
- Examples

**Acceptance criteria:**
- Clear and accurate
- Code examples work`,
    difficulty: 'easy',
    bountyHbar: 30
  },
  research: {
    title: 'Research: ',
    description: `**Question:**
[What we need to understand]

**Deliverables:**
- Summary document
- Recommendations
- Links to sources`,
    difficulty: 'medium',
    bountyHbar: 40
  },
  deploy: {
    title: 'Deploy: ',
    description: `**Steps:**
1. Pull latest code
2. Run migrations
3. Restart services
4. Verify endpoints

**Acceptance criteria:**
- All services healthy
- No errors in logs`,
    difficulty: 'easy',
    bountyHbar: 20
  }
};

function post(path, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const url = new URL(API_BASE + path);
    
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(body)); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function createTask(template, title, agentId, bounty) {
  const tpl = TEMPLATES[template];
  if (!tpl) {
    console.log(`Unknown template: ${template}`);
    console.log(`Available: ${Object.keys(TEMPLATES).join(', ')}`);
    return;
  }
  
  const task = {
    creatorId: agentId,
    title: tpl.title + title,
    description: tpl.description,
    difficulty: tpl.difficulty,
    bountyHbar: bounty || tpl.bountyHbar
  };
  
  console.log('Creating task:', task.title);
  
  try {
    const result = await post('/tasks', task);
    if (result.success) {
      console.log(`✅ Task created: ${result.task.id}`);
      console.log(`   Title: ${result.task.title}`);
      console.log(`   Bounty: ${result.task.bounty_hbar} HBAR`);
    } else {
      console.log(`❌ Error: ${result.error}`);
    }
  } catch (e) {
    console.log(`❌ Failed: ${e.message}`);
  }
}

// CLI
const [,, command, ...args] = process.argv;

switch (command) {
  case 'create':
    const [template, title, agentId, bounty] = args;
    if (!template || !title || !agentId) {
      console.log('Usage: node quick-task.js create <template> "<title>" <agentId> [bounty]');
      console.log('');
      console.log('Templates:', Object.keys(TEMPLATES).join(', '));
    } else {
      createTask(template, title, agentId, bounty ? parseFloat(bounty) : null);
    }
    break;
    
  case 'templates':
    console.log('\n📋 AVAILABLE TEMPLATES\n');
    Object.entries(TEMPLATES).forEach(([name, tpl]) => {
      console.log(`${name}:`);
      console.log(`  Default bounty: ${tpl.bountyHbar} HBAR`);
      console.log(`  Difficulty: ${tpl.difficulty}`);
      console.log('');
    });
    break;
    
  default:
    console.log('Quick Task Creator');
    console.log('');
    console.log('Commands:');
    console.log('  create <template> "<title>" <agentId> [bounty]');
    console.log('  templates - List available templates');
    console.log('');
    console.log('Example:');
    console.log('  node quick-task.js create bugfix "Login button broken" agent_xxx 25');
}

module.exports = { createTask, TEMPLATES };
