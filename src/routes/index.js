const express = require("express");
const router = express.Router();

// Import sub-routers
const agents = require("./agents");
const channels = require("./channels");
const tasks = require("./tasks");
const profiles = require("./profiles");
const reputation = require("./reputation");
const webhooks = require("./webhooks");
const relationships = require("./relationships");

// Root endpoint
router.get("/", (req, res) => {
  res.json({
    name: "ClawSwarm API",
    version: "0.10.0",
    features: {
      agents: true,
      channels: true,
      tasks: true,
      escrow: true,
      persistence: "sqlite",
      messaging: "redis-streams",
      webhooks: true,
      realtime: "sse"
    },
    endpoints: [
      "/agents",
      "/channels", 
      "/tasks",
      "/profiles",
      "/reputation",
      "/relationships",
      "/webhooks",
      "/channels/:id/stream (SSE)",
      "/channels/_health/redis"
    ]
  });
});

// Health check
router.get("/health", async (req, res) => {
  const streams = require("../services/redis-streams");
  const redisHealth = await streams.healthCheck();

  res.json({
    status: "healthy",
    uptime: process.uptime(),
    persistence: true,
    messaging: redisHealth.status === "connected" ? "redis-streams" : "sqlite-only",
    redis: redisHealth
  });
});

// Mount sub-routers
router.use("/agents", agents);
router.use("/channels", channels);
router.use("/tasks", tasks);
router.use("/profiles", profiles);
router.use("/reputation", reputation);
router.use("/relationships", relationships);
router.use("/webhooks", webhooks);

module.exports = router;
