#!/usr/bin/env node
/**
 * Schedule Post Tool
 * Read scheduled content and post to platforms
 * 
 * Usage: node schedule-post.js [--dry-run] [--platform twitter|discord]
 */

const fs = require('fs');
const path = require('path');

// Optional Twitter API (not required for dry-run)
let TwitterApi = null;
try {
  TwitterApi = require('twitter-api-v2').TwitterApi;
} catch (e) {
  // Twitter API not installed, posting disabled
}

// Config
const CONTENT_DIR = path.join(__dirname, '../content/scheduled');
const CREDENTIALS_PATH = '/home/xubadm/.config/twitter/credentials.json';

// Parse markdown content file
function parseContentFile(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  const posts = [];
  
  // Extract code blocks (tweets)
  const codeBlockRegex = /```\n?([\s\S]*?)```/g;
  let match;
  
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const text = match[1].trim();
    if (text.length > 0 && text.length <= 280) {
      posts.push({ text, chars: text.length });
    }
  }
  
  return posts;
}

// Post to Twitter
async function postToTwitter(text, dryRun = false) {
  if (dryRun) {
    console.log(`[DRY RUN] Would tweet: ${text.slice(0, 50)}... (${text.length} chars)`);
    return { success: true, dryRun: true };
  }
  
  if (!TwitterApi) {
    console.log('Twitter API not installed. Run: npm install twitter-api-v2');
    return { success: false, error: 'Twitter API not available' };
  }
  
  try {
    const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const client = new TwitterApi({
      appKey: creds.api_key,
      appSecret: creds.api_secret,
      accessToken: creds.access_token,
      accessSecret: creds.access_token_secret,
    });
    
    const result = await client.v2.tweet(text);
    console.log(`✅ Posted tweet: ${result.data.id}`);
    return { success: true, id: result.data.id };
  } catch (e) {
    console.error(`❌ Twitter error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const platform = args.find(a => a.startsWith('--platform='))?.split('=')[1] || 'twitter';
  const specificFile = args.find(a => !a.startsWith('--'));
  
  console.log(`\n📅 Schedule Post Tool\n`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Platform: ${platform}\n`);
  
  // Find content files
  let files = [];
  if (specificFile) {
    files = [path.join(CONTENT_DIR, specificFile)];
  } else {
    // Get today's date
    const today = new Date().toISOString().split('T')[0];
    const todayFile = path.join(CONTENT_DIR, `${today}-tweets.md`);
    
    if (fs.existsSync(todayFile)) {
      files = [todayFile];
    } else {
      // List all scheduled files
      if (fs.existsSync(CONTENT_DIR)) {
        files = fs.readdirSync(CONTENT_DIR)
          .filter(f => f.endsWith('.md'))
          .map(f => path.join(CONTENT_DIR, f));
      }
    }
  }
  
  if (files.length === 0) {
    console.log('No scheduled content found.');
    console.log(`Looking in: ${CONTENT_DIR}`);
    return;
  }
  
  console.log(`Found ${files.length} content file(s)\n`);
  
  for (const file of files) {
    console.log(`📄 ${path.basename(file)}`);
    
    if (!fs.existsSync(file)) {
      console.log(`   File not found: ${file}`);
      continue;
    }
    
    const posts = parseContentFile(file);
    console.log(`   Found ${posts.length} posts\n`);
    
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      console.log(`--- Post ${i + 1} (${post.chars} chars) ---`);
      console.log(post.text);
      console.log('');
      
      if (platform === 'twitter' && !dryRun) {
        // Only post if explicitly requested
        if (args.includes('--post')) {
          await postToTwitter(post.text, dryRun);
        } else {
          console.log('[PREVIEW] Add --post flag to actually post\n');
        }
      }
    }
  }
  
  console.log('Done.\n');
}

main().catch(console.error);
