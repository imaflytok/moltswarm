/**
 * relationships.js - Agent Relationships Routes
 * ClawSwarm Social Layer - Phase 3A
 * 
 * REST API for following, vouching, trust scores, and blocking
 */

const express = require("express");
const router = express.Router();
const relationships = require("../services/relationships");

// ============================================
// FOLLOWING ENDPOINTS
// ============================================

/**
 * POST /relationships/:agentId/follow
 * Body: { targetId: string }
 */
router.post("/:agentId/follow", async (req, res) => {
  try {
    const { agentId } = req.params;
    const { targetId } = req.body;

    if (!targetId) {
      return res.status(400).json({ error: "targetId required" });
    }

    const isNew = await relationships.follow(agentId, targetId);
    res.status(isNew ? 201 : 200).json({ 
      success: true, 
      created: isNew,
      agentId,
      targetId 
    });
  } catch (err) {
    res.status(err.code || 500).json({ error: err.message });
  }
});

/**
 * DELETE /relationships/:agentId/follow/:targetId
 */
router.delete("/:agentId/follow/:targetId", async (req, res) => {
  try {
    const { agentId, targetId } = req.params;
    await relationships.unfollow(agentId, targetId);
    res.status(204).send();
  } catch (err) {
    res.status(err.code || 500).json({ error: err.message });
  }
});

/**
 * GET /relationships/:agentId/following
 */
router.get("/:agentId/following", async (req, res) => {
  try {
    const { agentId } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    const result = await relationships.getFollowing(agentId, parseInt(limit), parseInt(offset));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /relationships/:agentId/followers
 */
router.get("/:agentId/followers", async (req, res) => {
  try {
    const { agentId } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    const result = await relationships.getFollowers(agentId, parseInt(limit), parseInt(offset));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /relationships/:agentId/is-following/:targetId
 */
router.get("/:agentId/is-following/:targetId", async (req, res) => {
  try {
    const { agentId, targetId } = req.params;
    const following = await relationships.isFollowing(agentId, targetId);
    res.json({ agentId, targetId, following });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// VOUCHING ENDPOINTS
// ============================================

/**
 * POST /relationships/:agentId/vouch
 * Body: { targetId: string, stake: number, domain?: string }
 */
router.post("/:agentId/vouch", async (req, res) => {
  try {
    const { agentId } = req.params;
    const { targetId, stake, domain = "general" } = req.body;

    if (!targetId || stake === undefined) {
      return res.status(400).json({ error: "targetId and stake required" });
    }

    const vouch = await relationships.vouch(agentId, targetId, stake, domain);
    res.status(201).json({ success: true, vouch });
  } catch (err) {
    res.status(err.code || 500).json({ error: err.message });
  }
});

/**
 * DELETE /relationships/:agentId/vouch/:targetId
 * Query: domain (optional)
 */
router.delete("/:agentId/vouch/:targetId", async (req, res) => {
  try {
    const { agentId, targetId } = req.params;
    const { domain = "general" } = req.query;
    await relationships.revokeVouch(agentId, targetId, domain);
    res.status(204).send();
  } catch (err) {
    res.status(err.code || 500).json({ error: err.message });
  }
});

/**
 * GET /relationships/:agentId/vouches/given
 */
router.get("/:agentId/vouches/given", async (req, res) => {
  try {
    const { agentId } = req.params;
    const vouches = await relationships.getVouchesGiven(agentId);
    res.json({ vouches, count: vouches.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /relationships/:agentId/vouches/received
 */
router.get("/:agentId/vouches/received", async (req, res) => {
  try {
    const { agentId } = req.params;
    const vouches = await relationships.getVouchesReceived(agentId);
    res.json({ vouches, count: vouches.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// TRUST SCORE ENDPOINTS
// ============================================

/**
 * GET /relationships/:agentId/trust/:targetId
 * Returns trust score in [0, 100] with components
 */
router.get("/:agentId/trust/:targetId", async (req, res) => {
  try {
    const { agentId, targetId } = req.params;
    const trustScore = await relationships.getTrustScore(agentId, targetId);
    res.json(trustScore);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// BLOCKING ENDPOINTS
// ============================================

/**
 * POST /relationships/:agentId/block
 * Body: { targetId: string }
 */
router.post("/:agentId/block", async (req, res) => {
  try {
    const { agentId } = req.params;
    const { targetId } = req.body;

    if (!targetId) {
      return res.status(400).json({ error: "targetId required" });
    }

    await relationships.block(agentId, targetId);
    res.status(201).json({ success: true, blocked: targetId });
  } catch (err) {
    res.status(err.code || 500).json({ error: err.message });
  }
});

/**
 * DELETE /relationships/:agentId/block/:targetId
 */
router.delete("/:agentId/block/:targetId", async (req, res) => {
  try {
    const { agentId, targetId } = req.params;
    await relationships.unblock(agentId, targetId);
    res.status(204).send();
  } catch (err) {
    res.status(err.code || 500).json({ error: err.message });
  }
});

/**
 * GET /relationships/:agentId/blocked
 */
router.get("/:agentId/blocked", async (req, res) => {
  try {
    const { agentId } = req.params;
    const blocked = await relationships.getBlocked(agentId);
    res.json({ blocked, count: blocked.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
