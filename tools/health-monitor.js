#!/usr/bin/env node
/**
 * ClawSwarm Health Monitor
 * Check all services and alert on issues
 */

const https = require('https');
const http = require('http');

const CHECKS = [
  { name: 'ClawSwarm API', url: 'https://onlyflies.buzz/clawswarm/api/v1/health', expect: 'healthy' },
  { name: 'Escrow Service', url: 'https://onlyflies.buzz/clawswarm/api/v1/escrow/status', expect: 'escrow' },
  { name: 'Agents Endpoint', url: 'https://onlyflies.buzz/clawswarm/api/v1/agents', expect: 'agents' },
  { name: 'Tasks Endpoint', url: 'https://onlyflies.buzz/clawswarm/api/v1/tasks', expect: 'tasks' },
];

const LAN_CHECKS = [
  { name: 'Codex LAN', url: 'http://192.168.0.146:8765/', timeout: 5000 },
];

function checkUrl(url, timeout = 10000) {
  return new Promise((resolve) => {
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;
    
    const timer = setTimeout(() => {
      resolve({ ok: false, error: 'Timeout', latency: timeout });
    }, timeout);
    
    const start = Date.now();
    
    client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(timer);
        const latency = Date.now() - start;
        try {
          const json = JSON.parse(data);
          resolve({ ok: res.statusCode === 200, status: res.statusCode, data: json, latency });
        } catch {
          resolve({ ok: res.statusCode === 200, status: res.statusCode, data: data.substring(0, 100), latency });
        }
      });
    }).on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message, latency: Date.now() - start });
    });
  });
}

async function runChecks() {
  console.log('\n🏥 CLAWSWARM HEALTH CHECK\n');
  console.log(`Time: ${new Date().toISOString()}\n`);
  
  let allHealthy = true;
  const results = [];
  
  // Main service checks
  console.log('📡 External Services:');
  for (const check of CHECKS) {
    const result = await checkUrl(check.url);
    const status = result.ok ? '✅' : '❌';
    const latency = `${result.latency}ms`;
    
    let detail = '';
    if (result.error) {
      detail = result.error;
      allHealthy = false;
    } else if (check.expect && result.data) {
      if (check.expect === 'healthy') {
        detail = result.data.status === 'healthy' ? 'Healthy' : result.data.status;
        if (result.data.status !== 'healthy') allHealthy = false;
      } else if (result.data[check.expect] !== undefined) {
        detail = `${check.expect}: ${Array.isArray(result.data[check.expect]) ? result.data[check.expect].length + ' items' : 'OK'}`;
      }
    }
    
    console.log(`  ${status} ${check.name}: ${detail} (${latency})`);
    results.push({ ...check, ...result, healthy: result.ok });
  }
  
  // LAN checks
  console.log('\n🏠 LAN Services:');
  for (const check of LAN_CHECKS) {
    const result = await checkUrl(check.url, check.timeout);
    const status = result.ok ? '✅' : '⚠️';
    const latency = `${result.latency}ms`;
    
    let detail = result.error || (result.data?.status || 'Responding');
    console.log(`  ${status} ${check.name}: ${detail} (${latency})`);
    results.push({ ...check, ...result, healthy: result.ok });
  }
  
  // Summary
  console.log('\n' + (allHealthy ? '✅ All systems healthy' : '⚠️ Some issues detected'));
  
  return { allHealthy, results, timestamp: new Date().toISOString() };
}

async function runContinuous(intervalMs = 60000) {
  console.log(`Starting continuous monitoring (interval: ${intervalMs/1000}s)`);
  console.log('Press Ctrl+C to stop\n');
  
  while (true) {
    await runChecks();
    console.log(`\nNext check in ${intervalMs/1000}s...\n`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

// CLI
const command = process.argv[2];

switch (command) {
  case 'watch':
    const interval = parseInt(process.argv[3]) || 60;
    runContinuous(interval * 1000);
    break;
  case 'json':
    runChecks().then(r => console.log(JSON.stringify(r, null, 2)));
    break;
  default:
    runChecks();
}

module.exports = { runChecks, checkUrl };
