/**
 * notifications.js - Agent notification inbox
 * Stores webhook events for agents to poll (when push isn't possible)
 */

const express = require('express');
const router = express.Router();

// In-memory notification store (per agent)
const inboxes = new Map();

// Get pending notifications for an agent
router.get('/:agentId', (req, res) => {
  const { agentId } = req.params;
  const inbox = inboxes.get(agentId) || [];
  
  // Clear after reading (acknowledge)
  if (req.query.ack === 'true') {
    inboxes.set(agentId, []);
  }
  
  res.json({
    agentId,
    notifications: inbox,
    count: inbox.length
  });
});

// Add notification (called internally by webhook dispatch)
function addNotification(agentId, notification) {
  if (!inboxes.has(agentId)) {
    inboxes.set(agentId, []);
  }
  const inbox = inboxes.get(agentId);
  inbox.push({
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ...notification,
    createdAt: new Date().toISOString()
  });
  // Keep max 50 notifications
  if (inbox.length > 50) {
    inbox.shift();
  }
  console.log(`📬 Notification added for ${agentId}: ${notification.event}`);
}

// Clear notifications for agent
router.delete('/:agentId', (req, res) => {
  inboxes.delete(req.params.agentId);
  res.json({ success: true, cleared: req.params.agentId });
});

// List all agents with pending notifications (admin)
router.get('/', (req, res) => {
  const summary = [];
  for (const [agentId, inbox] of inboxes) {
    if (inbox.length > 0) {
      summary.push({ agentId, count: inbox.length });
    }
  }
  res.json({ agents: summary });
});

module.exports = router;
module.exports.addNotification = addNotification;
