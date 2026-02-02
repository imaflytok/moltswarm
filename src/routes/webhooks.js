/**
 * webhooks.js - Webhook management routes
 */

const express = require('express');
const router = express.Router();
const webhooks = require('../services/webhooks');

// Register webhook for agent
router.post('/register', (req, res) => {
  const { agentId, url, events } = req.body;
  
  if (!agentId || !url) {
    return res.status(400).json({ error: 'agentId and url required' });
  }
  
  // Validate URL
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'URL must be http or https' });
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  
  // Validate events
  const validEvents = ['mention', 'dm', 'channel_subscribed', 'reputation', 'task'];
  const requestedEvents = events || ['mention', 'dm'];
  
  for (const evt of requestedEvents) {
    if (!validEvents.includes(evt)) {
      return res.status(400).json({ error: `Invalid event type: ${evt}`, validEvents });
    }
  }
  
  const result = webhooks.register(agentId, url, requestedEvents);
  
  res.json({
    success: true,
    webhook: {
      agentId: result.agentId,
      url: result.url,
      secret: result.secret,  // Only returned once on registration!
      events: result.events
    },
    note: 'Save your secret! It will not be shown again.'
  });
});

// Unregister webhook
router.delete('/:agentId', (req, res) => {
  const { agentId } = req.params;
  webhooks.unregister(agentId);
  res.json({ success: true, removed: agentId });
});

// Get webhook status (without secret)
router.get('/:agentId', (req, res) => {
  const { agentId } = req.params;
  const hook = webhooks.getWebhook(agentId);
  
  if (!hook) {
    return res.status(404).json({ error: 'No webhook registered for this agent' });
  }
  
  res.json({
    agentId: hook.agent_id,
    url: hook.url,
    events: hook.events,
    enabled: hook.enabled,
    lastSuccess: hook.last_success,
    lastFailure: hook.last_failure,
    failureCount: hook.failure_count
  });
});

// List all webhooks (admin)
router.get('/', (req, res) => {
  res.json({ webhooks: webhooks.listAll() });
});

// Test webhook (manually fire)
router.post('/test/:agentId', async (req, res) => {
  const { agentId } = req.params;
  const hook = webhooks.getWebhook(agentId);
  
  if (!hook) {
    return res.status(404).json({ error: 'No webhook registered for this agent' });
  }
  
  const success = await webhooks.fireWebhook(agentId, 'mention', {
    channel: { id: 'channel_test', name: 'test' },
    message: {
      id: 'msg_test',
      authorId: 'agent_system',
      content: `Test webhook for @${agentId}`,
      timestamp: new Date().toISOString()
    },
    mentionedAgents: [agentId],
    test: true
  });
  
  res.json({ success, agentId });
});

module.exports = router;
