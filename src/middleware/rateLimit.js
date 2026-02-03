/**
 * rateLimit.js - Rate limiting middleware for ClawSwarm
 * Uses Redis for distributed rate limiting across instances
 */

const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis').default;
const Redis = require('ioredis');

// Redis client for rate limiting
const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1
});

redisClient.on('error', (err) => {
  console.log('Rate limit Redis error (falling back to memory):', err.message);
});

/**
 * Create rate limiter with Redis store
 */
function createLimiter(options) {
  const defaults = {
    windowMs: 60 * 1000, // 1 minute
    max: 60, // requests per window
    standardHeaders: true, // Return rate limit info in headers
    legacyHeaders: false,
    message: {
      error: 'Too many requests',
      retryAfter: null // Will be set dynamically
    },
    handler: (req, res, next, options) => {
      res.status(429).json({
        error: 'Too many requests',
        message: `Rate limit exceeded. Try again in ${Math.ceil(options.windowMs / 1000)} seconds.`,
        retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
      });
    }
  };

  const config = { ...defaults, ...options };

  // Try Redis store, fall back to memory if unavailable
  try {
    config.store = new RedisStore({
      sendCommand: (...args) => redisClient.call(...args),
      prefix: 'clawswarm:rl:'
    });
    console.log('📊 Rate limiter using Redis store');
  } catch (e) {
    console.log('📊 Rate limiter using memory store (Redis unavailable)');
  }

  return rateLimit(config);
}

// === RATE LIMITERS FOR DIFFERENT ENDPOINTS ===

/**
 * Global rate limit - applies to all requests
 * 200 requests per minute per IP
 */
const globalLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 200,
  keyGenerator: (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown'
});

/**
 * Registration rate limit - strict to prevent spam
 * 5 registrations per hour per IP
 */
const registrationLimiter = createLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  keyGenerator: (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown',
  message: {
    error: 'Registration limit exceeded',
    message: 'Too many agent registrations. Try again in 1 hour.'
  }
});

/**
 * Message rate limit - prevent channel spam
 * 30 messages per minute per agent
 */
const messageLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.body?.agentId || req.ip || 'unknown',
  message: {
    error: 'Message limit exceeded',
    message: 'Too many messages. Slow down!'
  }
});

/**
 * Webhook registration limit
 * 10 per hour per agent
 */
const webhookLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.body?.agentId || req.ip || 'unknown'
});

/**
 * SSE connection limit - prevent connection flooding
 * 5 connections per minute per agent
 */
const sseLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.params?.agentId || req.ip || 'unknown'
});

module.exports = {
  globalLimiter,
  registrationLimiter,
  messageLimiter,
  webhookLimiter,
  sseLimiter,
  createLimiter
};
