/**
 * redis-streams.js - Redis Streams messaging for ClawSwarm
 * v1.0.0 - Real-time message delivery with persistence
 */

const Redis = require("ioredis");

// Connect to existing fly-redis container
const REDIS_URL = process.env.REDIS_URL || "redis://fly-redis:6379";
const redis = new Redis(REDIS_URL);
const subscriber = new Redis(REDIS_URL);

// Stream keys
const CHANNEL_STREAM = (channelId) => `stream:channel:${channelId}`;
const AGENT_INBOX = (agentId) => `stream:agent:${agentId}:inbox`;
const CONSUMER_GROUP = "clawswarm-consumers";

// Per-agent consumer group (Phase 2: Reliable Messaging)
const AGENT_GROUP = (agentId) => `agent:${agentId}`;

// Track registered agent groups per channel
const agentSubscriptions = new Map(); // channelId -> Set<agentId>

// Initialize consumer groups
async function initStreams(channelIds = [], agentIds = []) {
  for (const channelId of channelIds) {
    try {
      await redis.xgroup("CREATE", CHANNEL_STREAM(channelId), CONSUMER_GROUP, "$", "MKSTREAM");
      console.log(`📡 Created stream for channel: ${channelId}`);
    } catch (e) {
      if (!e.message.includes("BUSYGROUP")) throw e;
    }
  }
  for (const agentId of agentIds) {
    try {
      await redis.xgroup("CREATE", AGENT_INBOX(agentId), CONSUMER_GROUP, "$", "MKSTREAM");
      console.log(`📬 Created inbox for agent: ${agentId}`);
    } catch (e) {
      if (!e.message.includes("BUSYGROUP")) throw e;
    }
  }
}

// Publish message to channel stream
async function publishToChannel(channelId, message) {
  const streamKey = CHANNEL_STREAM(channelId);
  const msgData = {
    id: message.id,
    agentId: message.agentId,
    content: message.content,
    type: message.type || "text",
    metadata: JSON.stringify(message.metadata || {}),
    timestamp: message.timestamp || new Date().toISOString()
  };

  // Add to stream
  const entryId = await redis.xadd(streamKey, "*", ...Object.entries(msgData).flat());
  console.log(`📨 Published to ${streamKey}: ${entryId}`);
  return entryId;
}

// Send direct message to agent inbox
async function sendToAgent(agentId, message) {
  const streamKey = AGENT_INBOX(agentId);
  const msgData = {
    id: message.id,
    fromAgentId: message.fromAgentId,
    content: message.content,
    type: message.type || "direct",
    metadata: JSON.stringify(message.metadata || {}),
    timestamp: new Date().toISOString()
  };

  const entryId = await redis.xadd(streamKey, "*", ...Object.entries(msgData).flat());
  console.log(`📬 Sent to ${agentId}: ${entryId}`);
  return entryId;
}

// Read messages from channel (with blocking for real-time)
async function readChannel(channelId, consumerName, count = 10, blockMs = 0) {
  const streamKey = CHANNEL_STREAM(channelId);
  
  try {
    // Try to create consumer group if not exists
    await redis.xgroup("CREATE", streamKey, CONSUMER_GROUP, "$", "MKSTREAM").catch(() => {});
    
    const result = await redis.xreadgroup(
      "GROUP", CONSUMER_GROUP, consumerName,
      "COUNT", count,
      blockMs > 0 ? "BLOCK" : null,
      blockMs > 0 ? blockMs : null,
      "STREAMS", streamKey, ">"
    ).catch(() => null);

    if (!result) return [];

    return result[0][1].map(([id, fields]) => {
      const msg = {};
      for (let i = 0; i < fields.length; i += 2) {
        msg[fields[i]] = fields[i + 1];
      }
      msg.streamId = id;
      if (msg.metadata) msg.metadata = JSON.parse(msg.metadata);
      return msg;
    });
  } catch (e) {
    console.error("Read error:", e.message);
    return [];
  }
}

// Read agent inbox
async function readInbox(agentId, consumerName, count = 10, blockMs = 0) {
  const streamKey = AGENT_INBOX(agentId);
  
  try {
    await redis.xgroup("CREATE", streamKey, CONSUMER_GROUP, "$", "MKSTREAM").catch(() => {});
    
    const result = await redis.xreadgroup(
      "GROUP", CONSUMER_GROUP, consumerName,
      "COUNT", count,
      blockMs > 0 ? "BLOCK" : null,
      blockMs > 0 ? blockMs : null,
      "STREAMS", streamKey, ">"
    ).catch(() => null);

    if (!result) return [];

    return result[0][1].map(([id, fields]) => {
      const msg = {};
      for (let i = 0; i < fields.length; i += 2) {
        msg[fields[i]] = fields[i + 1];
      }
      msg.streamId = id;
      if (msg.metadata) msg.metadata = JSON.parse(msg.metadata);
      return msg;
    });
  } catch (e) {
    console.error("Read inbox error:", e.message);
    return [];
  }
}

// Acknowledge message processed
async function ackMessage(streamKey, messageId) {
  await redis.xack(streamKey, CONSUMER_GROUP, messageId);
}

// Get channel history (last N messages)
async function getChannelHistory(channelId, count = 50) {
  const streamKey = CHANNEL_STREAM(channelId);
  const result = await redis.xrevrange(streamKey, "+", "-", "COUNT", count);
  
  return result.map(([id, fields]) => {
    const msg = {};
    for (let i = 0; i < fields.length; i += 2) {
      msg[fields[i]] = fields[i + 1];
    }
    msg.streamId = id;
    if (msg.metadata) msg.metadata = JSON.parse(msg.metadata);
    return msg;
  }).reverse();
}

// Broadcast to multiple agents
async function broadcast(agentIds, message) {
  const promises = agentIds.map(agentId => sendToAgent(agentId, message));
  await Promise.all(promises);
  console.log(`📢 Broadcast to ${agentIds.length} agents`);
}

// Health check
async function healthCheck() {
  try {
    await redis.ping();
    return { status: "connected", url: REDIS_URL };
  } catch (e) {
    return { status: "disconnected", error: e.message };
  }
}

// ============================================
// PHASE 2: Per-Agent Consumer Groups
// ============================================

/**
 * Subscribe an agent to a channel with their own consumer group
 * This allows agents to have independent read positions
 */
async function subscribeAgent(channelId, agentId, startFrom = "$") {
  const streamKey = CHANNEL_STREAM(channelId);
  const groupName = AGENT_GROUP(agentId);
  
  try {
    // Create per-agent consumer group
    // startFrom: "$" = only new messages, "0" = all messages from beginning
    await redis.xgroup("CREATE", streamKey, groupName, startFrom, "MKSTREAM");
    console.log(`🔔 Agent ${agentId} subscribed to ${channelId} (group: ${groupName})`);
    
    // Track subscription
    if (!agentSubscriptions.has(channelId)) {
      agentSubscriptions.set(channelId, new Set());
    }
    agentSubscriptions.get(channelId).add(agentId);
    
    return { success: true, group: groupName, startFrom };
  } catch (e) {
    if (e.message.includes("BUSYGROUP")) {
      // Already subscribed
      return { success: true, group: groupName, alreadyExists: true };
    }
    throw e;
  }
}

/**
 * Unsubscribe agent from channel (remove their consumer group)
 */
async function unsubscribeAgent(channelId, agentId) {
  const streamKey = CHANNEL_STREAM(channelId);
  const groupName = AGENT_GROUP(agentId);
  
  try {
    await redis.xgroup("DESTROY", streamKey, groupName);
    console.log(`🔕 Agent ${agentId} unsubscribed from ${channelId}`);
    
    if (agentSubscriptions.has(channelId)) {
      agentSubscriptions.get(channelId).delete(agentId);
    }
    
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Read messages for a specific agent (using their consumer group)
 * Returns only unread messages for this agent
 */
async function readForAgent(channelId, agentId, count = 50, blockMs = 0) {
  const streamKey = CHANNEL_STREAM(channelId);
  const groupName = AGENT_GROUP(agentId);
  const consumerName = agentId; // Use agentId as consumer name within group
  
  try {
    // Ensure group exists (auto-subscribe if not)
    await subscribeAgent(channelId, agentId);
    
    const args = [
      "GROUP", groupName, consumerName,
      "COUNT", count
    ];
    
    if (blockMs > 0) {
      args.push("BLOCK", blockMs);
    }
    
    args.push("STREAMS", streamKey, ">");
    
    const result = await redis.xreadgroup(...args);
    
    if (!result) return [];
    
    return result[0][1].map(([id, fields]) => {
      const msg = {};
      for (let i = 0; i < fields.length; i += 2) {
        msg[fields[i]] = fields[i + 1];
      }
      msg.streamId = id;
      if (msg.metadata) msg.metadata = JSON.parse(msg.metadata);
      return msg;
    });
  } catch (e) {
    console.error(`Read error for ${agentId}:`, e.message);
    return [];
  }
}

/**
 * Get pending (unacknowledged) messages for an agent
 * Use this to catch up after being offline
 */
async function getPendingForAgent(channelId, agentId, count = 100) {
  const streamKey = CHANNEL_STREAM(channelId);
  const groupName = AGENT_GROUP(agentId);
  
  try {
    // Get pending entries info
    const pending = await redis.xpending(streamKey, groupName, "-", "+", count);
    
    if (!pending || pending.length === 0) {
      return { count: 0, messages: [] };
    }
    
    // Fetch the actual messages
    const messageIds = pending.map(p => p[0]);
    const messages = [];
    
    for (const msgId of messageIds) {
      const result = await redis.xrange(streamKey, msgId, msgId);
      if (result && result.length > 0) {
        const [id, fields] = result[0];
        const msg = {};
        for (let i = 0; i < fields.length; i += 2) {
          msg[fields[i]] = fields[i + 1];
        }
        msg.streamId = id;
        if (msg.metadata) msg.metadata = JSON.parse(msg.metadata);
        messages.push(msg);
      }
    }
    
    return { count: messages.length, messages };
  } catch (e) {
    console.error(`Pending error for ${agentId}:`, e.message);
    return { count: 0, messages: [], error: e.message };
  }
}

/**
 * Acknowledge message for a specific agent
 */
async function ackForAgent(channelId, agentId, messageId) {
  const streamKey = CHANNEL_STREAM(channelId);
  const groupName = AGENT_GROUP(agentId);
  
  const result = await redis.xack(streamKey, groupName, messageId);
  return result > 0;
}

/**
 * Acknowledge multiple messages for an agent
 */
async function ackBatchForAgent(channelId, agentId, messageIds) {
  const streamKey = CHANNEL_STREAM(channelId);
  const groupName = AGENT_GROUP(agentId);
  
  const result = await redis.xack(streamKey, groupName, ...messageIds);
  return result;
}

/**
 * Get agent's subscription status and pending count
 */
async function getAgentStatus(channelId, agentId) {
  const streamKey = CHANNEL_STREAM(channelId);
  const groupName = AGENT_GROUP(agentId);
  
  try {
    const info = await redis.xinfo("GROUPS", streamKey);
    const group = info.find(g => {
      // Parse XINFO response (alternating key-value pairs)
      for (let i = 0; i < g.length; i += 2) {
        if (g[i] === "name" && g[i + 1] === groupName) return true;
      }
      return false;
    });
    
    if (!group) {
      return { subscribed: false };
    }
    
    // Parse group info
    const status = { subscribed: true };
    for (let i = 0; i < group.length; i += 2) {
      status[group[i]] = group[i + 1];
    }
    
    return status;
  } catch (e) {
    return { subscribed: false, error: e.message };
  }
}

/**
 * List all agents subscribed to a channel
 */
async function getChannelSubscribers(channelId) {
  const streamKey = CHANNEL_STREAM(channelId);
  
  try {
    const info = await redis.xinfo("GROUPS", streamKey);
    const agents = [];
    
    for (const group of info) {
      // Parse group info
      let name = null, pending = 0, consumers = 0;
      for (let i = 0; i < group.length; i += 2) {
        if (group[i] === "name") name = group[i + 1];
        if (group[i] === "pending") pending = group[i + 1];
        if (group[i] === "consumers") consumers = group[i + 1];
      }
      
      // Check if it's an agent group (starts with "agent:")
      if (name && name.startsWith("agent:")) {
        agents.push({
          agentId: name.replace("agent:", ""),
          pending,
          consumers
        });
      }
    }
    
    return agents;
  } catch (e) {
    return [];
  }
}

module.exports = {
  redis,
  initStreams,
  publishToChannel,
  sendToAgent,
  readChannel,
  readInbox,
  ackMessage,
  getChannelHistory,
  broadcast,
  healthCheck,
  CHANNEL_STREAM,
  AGENT_INBOX,
  // Phase 2: Per-Agent Consumer Groups
  AGENT_GROUP,
  subscribeAgent,
  unsubscribeAgent,
  readForAgent,
  getPendingForAgent,
  ackForAgent,
  ackBatchForAgent,
  getAgentStatus,
  getChannelSubscribers
};
