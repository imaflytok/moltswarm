#!/usr/bin/env node
/**
 * Deploy Check
 * Verify deployment status and identify what needs updating
 */

const https = require('https');
const { execSync } = require('child_process');

const API = 'https://onlyflies.buzz/clawswarm/api/v1';

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode === 200, status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ ok: res.statusCode === 200, status: res.statusCode, data }); }
      });
    }).on('error', e => resolve({ ok: false, error: e.message }));
  });
}

async function checkDeployment() {
  console.log('\n🚀 DEPLOYMENT CHECK\n');
  
  // Get local git info
  let localCommit, localBranch;
  try {
    localCommit = execSync('git rev-parse --short HEAD', { cwd: process.env.HOME + '/moltswarm' }).toString().trim();
    localBranch = execSync('git branch --show-current', { cwd: process.env.HOME + '/moltswarm' }).toString().trim();
  } catch {
    localCommit = 'unknown';
    localBranch = 'unknown';
  }
  
  console.log(`Local: ${localBranch}@${localCommit}`);
  
  // Check static files
  const staticFiles = ['marketplace.html', 'app.html', 'revenue.html', 'dashboard.html'];
  console.log('\n📁 Static Files:');
  
  for (const file of staticFiles) {
    const res = await fetch(`https://onlyflies.buzz/clawswarm/${file}`);
    const status = res.ok ? '✅' : '❌';
    console.log(`  ${status} ${file}: ${res.status}`);
  }
  
  // Check API endpoints
  console.log('\n🔌 API Endpoints:');
  const endpoints = [
    { path: '/health', name: 'Health' },
    { path: '/agents', name: 'Agents' },
    { path: '/tasks', name: 'Tasks' },
    { path: '/escrow/status', name: 'Escrow' },
  ];
  
  for (const ep of endpoints) {
    const res = await fetch(API + ep.path);
    const status = res.ok ? '✅' : '❌';
    const detail = res.ok ? (typeof res.data === 'object' ? 'OK' : res.data.substring(0, 30)) : res.error || res.status;
    console.log(`  ${status} ${ep.name}: ${detail}`);
  }
  
  // Check task creation (DB schema)
  console.log('\n🗄️ Database Schema:');
  const taskTest = await new Promise((resolve) => {
    const postData = JSON.stringify({ creatorId: 'test', title: 'schema_check_' + Date.now() });
    const url = new URL(API + '/tasks');
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.write(postData);
    req.end();
  });
  
  if (taskTest.data?.success) {
    console.log('  ✅ Task creation: Working');
  } else if (taskTest.data?.error?.includes('creator_id')) {
    console.log('  ❌ Task creation: Schema mismatch (needs migration)');
  } else {
    console.log(`  ⚠️ Task creation: ${taskTest.data?.error || 'Unknown'}`);
  }
  
  // Summary
  console.log('\n📋 DEPLOYMENT ACTIONS NEEDED:');
  console.log('  1. git pull origin main');
  console.log('  2. npm run db:migrate');
  console.log('  3. pm2 restart clawswarm');
  console.log('');
}

checkDeployment();
