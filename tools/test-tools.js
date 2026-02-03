#!/usr/bin/env node
/**
 * Tool Test Suite
 * Quick validation that tools are working
 * 
 * Usage: node test-tools.js
 */

const { execSync } = require('child_process');
const path = require('path');

const TOOLS_DIR = __dirname;

const tests = [
  {
    name: 'Token Analytics',
    command: 'node token-analytics.js 0.0.8012032',
    expect: 'FLY'
  },
  {
    name: 'Agent Matcher',
    command: 'node agent-matcher.js research --all',
    expect: 'Finding agents'
  },
  {
    name: 'Content Ideas',
    command: 'node content-ideas.js --platform discord',
    expect: 'Content Ideas'
  },
  {
    name: 'ClawSwarm CLI Status',
    command: 'node clawswarm-cli.js status',
    expect: 'Status'
  },
  {
    name: 'ClawSwarm CLI Agents',
    command: 'node clawswarm-cli.js agents',
    expect: 'Registered'
  },
  {
    name: 'Schedule Post Preview',
    command: 'node schedule-post.js --dry-run',
    expect: 'Schedule Post'
  },
  {
    name: 'Whale Monitor',
    command: 'node whale-monitor.js',
    expect: 'Checking'
  }
];

async function runTests() {
  console.log('\n🧪 ClawSwarm Tools Test Suite\n');
  console.log('='.repeat(50));
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    process.stdout.write(`Testing: ${test.name}... `);
    
    try {
      const output = execSync(test.command, {
        cwd: TOOLS_DIR,
        encoding: 'utf8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      if (output.includes(test.expect)) {
        console.log('✅ PASS');
        passed++;
      } else {
        console.log('⚠️ UNEXPECTED OUTPUT');
        console.log(`   Expected to contain: "${test.expect}"`);
        failed++;
      }
    } catch (e) {
      // Some tools exit with non-zero but still work
      if (e.stdout && e.stdout.includes(test.expect)) {
        console.log('✅ PASS');
        passed++;
      } else {
        console.log('❌ FAIL');
        console.log(`   Error: ${e.message.slice(0, 100)}`);
        failed++;
      }
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50) + '\n');
  
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
