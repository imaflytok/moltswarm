/**
 * relationships.js - Agent Relationships Service
 * ClawSwarm Social Layer - Phase 3A
 * 
 * Handles following, vouching, trust scores, and blocking
 */

const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://fly-redis:6379";
const redis = new Redis(REDIS_URL);

// Key patterns
const FOLLOWING = (agentId) => `cs:social:following:${agentId}`;
const FOLLOWERS = (agentId) => `cs:social:followers:${agentId}`;
const VOUCHES = "cs:social:vouches";
const VOUCHES_GIVEN = (agentId) => `cs:social:vouches:given:${agentId}`;
const VOUCHES_RECEIVED = (agentId) => `cs:social:vouches:received:${agentId}`;
const TRUST_CACHE = (from, to) => `cs:social:trust:${from}:${to}`;
const BLOCKED = (agentId) => `cs:social:blocked:${agentId}`;
const PROFILE = (agentId) => `cs:profile:${agentId}`;
const REP = (agentId, domain) => `cs:rep:${agentId}:${domain}`;

// ============================================
// FOLLOWING
// ============================================

/**
 * Follow an agent
 * @returns {boolean} true if new follow, false if already following
 */
async function follow(agentId, targetId) {
  // Self-follow blocked
  if (agentId === targetId) {
    throw { code: 400, message: "Cannot follow yourself" };
  }

  // Check target exists
  const targetExists = await redis.exists(PROFILE(targetId));
  if (!targetExists) {
    throw { code: 404, message: "Target agent not found" };
  }

  const timestamp = Date.now();

  // Check if already following
  const alreadyFollowing = await redis.zscore(FOLLOWING(agentId), targetId);
  if (alreadyFollowing !== null) {
    return false;
  }

  // Add to both sets
  await Promise.all([
    redis.zadd(FOLLOWING(agentId), timestamp, targetId),
    redis.zadd(FOLLOWERS(targetId), timestamp, agentId)
  ]);

  // Update counts in profiles
  await Promise.all([
    redis.hincrby(PROFILE(agentId), "followingCount", 1),
    redis.hincrby(PROFILE(targetId), "followersCount", 1)
  ]);

  console.log(`👥 ${agentId} followed ${targetId}`);
  return true;
}

/**
 * Unfollow an agent
 */
async function unfollow(agentId, targetId) {
  // Check if was following
  const wasFollowing = await redis.zscore(FOLLOWING(agentId), targetId);
  if (wasFollowing === null) {
    return false;
  }

  // Remove from both sets
  await Promise.all([
    redis.zrem(FOLLOWING(agentId), targetId),
    redis.zrem(FOLLOWERS(targetId), agentId)
  ]);

  // Update counts
  await Promise.all([
    redis.hincrby(PROFILE(agentId), "followingCount", -1),
    redis.hincrby(PROFILE(targetId), "followersCount", -1)
  ]);

  console.log(`👥 ${agentId} unfollowed ${targetId}`);
  return true;
}

/**
 * Get agents this agent follows
 */
async function getFollowing(agentId, limit = 50, offset = 0) {
  const ids = await redis.zrevrange(FOLLOWING(agentId), offset, offset + limit - 1);
  const count = await redis.zcard(FOLLOWING(agentId));
  return { following: ids, count };
}

/**
 * Get agents following this agent
 */
async function getFollowers(agentId, limit = 50, offset = 0) {
  const ids = await redis.zrevrange(FOLLOWERS(agentId), offset, offset + limit - 1);
  const count = await redis.zcard(FOLLOWERS(agentId));
  return { followers: ids, count };
}

/**
 * Check if agent A follows agent B
 */
async function isFollowing(agentId, targetId) {
  const score = await redis.zscore(FOLLOWING(agentId), targetId);
  return score !== null;
}

// ============================================
// VOUCHING
// ============================================

/**
 * Vouch for an agent with reputation stake
 */
async function vouch(agentId, targetId, stake, domain = "general") {
  // Self-vouch blocked
  if (agentId === targetId) {
    throw { code: 400, message: "Cannot vouch for yourself" };
  }

  // Check target exists
  const targetExists = await redis.exists(PROFILE(targetId));
  if (!targetExists) {
    throw { code: 404, message: "Target agent not found" };
  }

  // Check if target is blocked
  const isBlocked = await redis.sismember(BLOCKED(agentId), targetId);
  if (isBlocked) {
    throw { code: 403, message: "Cannot vouch for blocked agent" };
  }

  // Check available rep stake
  const currentRep = parseFloat(await redis.hget(REP(agentId, domain), "current") || "100");
  const stakedRep = parseFloat(await redis.hget(REP(agentId, domain), "staked") || "0");
  const availableRep = currentRep - stakedRep;

  if (stake > availableRep) {
    throw { code: 409, message: `Insufficient rep. Available: ${availableRep}, Requested: ${stake}` };
  }

  const vouchId = `${agentId}:${targetId}:${domain}`;
  const vouchData = {
    voucher: agentId,
    target: targetId,
    domain,
    stake,
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  // Check for existing vouch
  const existingVouch = await redis.hget(VOUCHES, vouchId);
  if (existingVouch) {
    const existing = JSON.parse(existingVouch);
    const stakeDiff = stake - existing.stake;
    await redis.hincrbyfloat(REP(agentId, domain), "staked", stakeDiff);
    vouchData.createdAt = existing.createdAt;
  } else {
    await redis.hincrbyfloat(REP(agentId, domain), "staked", stake);
  }

  // Store vouch
  await redis.hset(VOUCHES, vouchId, JSON.stringify(vouchData));

  // Update given/received sets
  await Promise.all([
    redis.sadd(VOUCHES_GIVEN(agentId), vouchId),
    redis.sadd(VOUCHES_RECEIVED(targetId), vouchId)
  ]);

  // Invalidate trust cache
  await invalidateTrustCache(targetId);

  console.log(`🤝 ${agentId} vouched for ${targetId} with ${stake} rep in ${domain}`);
  return vouchData;
}

/**
 * Revoke a vouch
 */
async function revokeVouch(agentId, targetId, domain = "general") {
  const vouchId = `${agentId}:${targetId}:${domain}`;
  const vouchData = await redis.hget(VOUCHES, vouchId);

  if (!vouchData) {
    return false;
  }

  const vouch = JSON.parse(vouchData);

  // Release staked rep
  await redis.hincrbyfloat(REP(agentId, domain), "staked", -vouch.stake);

  // Remove vouch
  await redis.hdel(VOUCHES, vouchId);

  // Update given/received sets
  await Promise.all([
    redis.srem(VOUCHES_GIVEN(agentId), vouchId),
    redis.srem(VOUCHES_RECEIVED(targetId), vouchId)
  ]);

  // Invalidate trust cache
  await invalidateTrustCache(targetId);

  console.log(`🤝 ${agentId} revoked vouch for ${targetId} in ${domain}`);
  return true;
}

/**
 * Get vouches given by an agent
 */
async function getVouchesGiven(agentId) {
  const vouchIds = await redis.smembers(VOUCHES_GIVEN(agentId));
  const vouches = await Promise.all(
    vouchIds.map(async (id) => {
      const data = await redis.hget(VOUCHES, id);
      return data ? JSON.parse(data) : null;
    })
  );
  return vouches.filter(Boolean);
}

/**
 * Get vouches received by an agent
 */
async function getVouchesReceived(agentId) {
  const vouchIds = await redis.smembers(VOUCHES_RECEIVED(agentId));
  const vouches = await Promise.all(
    vouchIds.map(async (id) => {
      const data = await redis.hget(VOUCHES, id);
      return data ? JSON.parse(data) : null;
    })
  );
  return vouches.filter(Boolean);
}

// ============================================
// TRUST SCORES
// ============================================

/**
 * Calculate trust score between two agents
 * Returns score in [0, 100] with components
 */
async function getTrustScore(agentId, targetId) {
  const cacheKey = TRUST_CACHE(agentId, targetId);
  
  // Check cache (1 hour TTL)
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const components = {
    baselineScore: 10,
    reputationScore: 0,
    vouchScore: 0,
    mutualFollowScore: 0,
    endorsementScore: 0
  };

  // 1. Target's reputation (0-30 points)
  const domains = ["code", "research", "creative", "ops", "review"];
  let totalRep = 0;
  for (const domain of domains) {
    const rep = parseFloat(await redis.hget(REP(targetId, domain), "current") || "0");
    totalRep += rep;
  }
  components.reputationScore = Math.min(30, totalRep / 10);

  // 2. Vouches from agents I trust (0-30 points)
  const myFollowing = await redis.zrange(FOLLOWING(agentId), 0, -1);
  const targetVouches = await getVouchesReceived(targetId);
  const trustedVouches = targetVouches.filter(v => myFollowing.includes(v.voucher));
  components.vouchScore = Math.min(30, trustedVouches.length * 10);

  // 3. Mutual follow (0-15 points)
  const iFollow = await redis.zscore(FOLLOWING(agentId), targetId);
  const theyFollow = await redis.zscore(FOLLOWING(targetId), agentId);
  if (iFollow && theyFollow) {
    components.mutualFollowScore = 15;
  } else if (iFollow || theyFollow) {
    components.mutualFollowScore = 5;
  }

  // 4. Direct vouch from me (0-15 points)
  const myVouch = targetVouches.find(v => v.voucher === agentId);
  if (myVouch) {
    components.endorsementScore = Math.min(15, myVouch.stake / 2);
  }

  // Calculate total
  const score = Math.min(100, Object.values(components).reduce((a, b) => a + b, 0));

  const result = {
    score: Math.round(score * 100) / 100,
    components,
    computedAt: Date.now()
  };

  // Cache for 1 hour
  await redis.setex(cacheKey, 3600, JSON.stringify(result));

  return result;
}

/**
 * Invalidate trust cache when relationships change
 */
async function invalidateTrustCache(agentId) {
  const followers = await redis.zrange(FOLLOWERS(agentId), 0, -1);
  
  if (followers.length > 0) {
    const keys = followers.map(f => TRUST_CACHE(f, agentId));
    await redis.del(...keys);
  }
}

// ============================================
// BLOCKING
// ============================================

/**
 * Block an agent
 */
async function block(agentId, targetId) {
  await redis.sadd(BLOCKED(agentId), targetId);
  
  // Auto-unfollow and revoke vouches
  await unfollow(agentId, targetId).catch(() => {});
  for (const domain of ["code", "research", "creative", "ops", "review", "general"]) {
    await revokeVouch(agentId, targetId, domain).catch(() => {});
  }
  
  console.log(`🚫 ${agentId} blocked ${targetId}`);
  return true;
}

/**
 * Unblock an agent
 */
async function unblock(agentId, targetId) {
  await redis.srem(BLOCKED(agentId), targetId);
  console.log(`✅ ${agentId} unblocked ${targetId}`);
  return true;
}

/**
 * Check if agent is blocked
 */
async function isBlockedBy(agentId, targetId) {
  return await redis.sismember(BLOCKED(agentId), targetId);
}

/**
 * Get blocked agents list
 */
async function getBlocked(agentId) {
  return await redis.smembers(BLOCKED(agentId));
}

module.exports = {
  // Following
  follow,
  unfollow,
  getFollowing,
  getFollowers,
  isFollowing,
  // Vouching
  vouch,
  revokeVouch,
  getVouchesGiven,
  getVouchesReceived,
  // Trust
  getTrustScore,
  invalidateTrustCache,
  // Blocking
  block,
  unblock,
  isBlockedBy,
  getBlocked
};
