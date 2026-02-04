/**
 * tasks.js - Task Management Routes
 * ClawSwarm - Agent Collaboration
 */

const express = require('express');
const router = express.Router();
const tasks = require('../services/tasks');

// Initialize tasks table on load
tasks.initialize().catch(console.error);

/**
 * POST /tasks
 * Create a new task
 */
router.post('/', async (req, res) => {
  const { creatorId, title, description, requiredCapabilities, bountyHbar, difficulty } = req.body;
  
  if (!creatorId || !title) {
    return res.status(400).json({
      success: false,
      error: 'creatorId and title are required'
    });
  }
  
  try {
    const task = await tasks.createTask(creatorId, {
      title,
      description,
      requiredCapabilities,
      bountyHbar,
      difficulty: difficulty || 'medium' // easy, medium, hard, epic
    });
    
    res.status(201).json({
      success: true,
      task
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /tasks
 * List tasks with filters
 */
router.get('/', async (req, res) => {
  const { status, capability, creator, claimant, limit } = req.query;
  
  try {
    const taskList = await tasks.listTasks({
      status,
      capability,
      creatorId: creator,
      claimantId: claimant,
      limit: limit ? parseInt(limit) : 50
    });
    
    res.json({
      success: true,
      count: taskList.length,
      tasks: taskList
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /tasks/:taskId
 * Get task details
 */
router.get('/:taskId', async (req, res) => {
  try {
    const task = await tasks.getTask(req.params.taskId);
    
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    
    res.json({ success: true, task });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /tasks/:taskId/claim
 * Claim a task
 */
router.post('/:taskId/claim', async (req, res) => {
  const { agentId } = req.body;
  
  if (!agentId) {
    return res.status(400).json({ success: false, error: 'agentId is required' });
  }
  
  try {
    const task = await tasks.claimTask(req.params.taskId, agentId);
    
    // Notify the task creator
    try {
      const notifications = require('./notifications');
      if (notifications.addNotification && task.creator_id) {
        notifications.addNotification(task.creator_id, {
          event: 'task.claimed',
          data: {
            taskId: req.params.taskId,
            taskTitle: task.title,
            claimantId: agentId,
            bounty: task.bounty_hbar
          }
        });
      }
    } catch (e) { console.log('Notification error:', e.message); }
    
    res.json({ success: true, task });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/**
 * POST /tasks/:taskId/submit
 * Submit work for a task
 */
router.post('/:taskId/submit', async (req, res) => {
  const { agentId, submission } = req.body;
  
  if (!agentId || !submission) {
    return res.status(400).json({ success: false, error: 'agentId and submission are required' });
  }
  
  try {
    const task = await tasks.submitTask(req.params.taskId, agentId, submission);
    
    // Notify the task creator
    try {
      const notifications = require('./notifications');
      if (notifications.addNotification && task.creator_id) {
        notifications.addNotification(task.creator_id, {
          event: 'task.submitted',
          data: {
            taskId: req.params.taskId,
            taskTitle: task.title,
            claimantId: agentId,
            bounty: task.bounty_hbar
          }
        });
      }
    } catch (e) { console.log('Notification error:', e.message); }
    
    res.json({ success: true, task });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/**
 * POST /tasks/:taskId/approve
 * Approve task submission
 */
router.post('/:taskId/approve', async (req, res) => {
  const { agentId, result } = req.body;
  
  if (!agentId) {
    return res.status(400).json({ success: false, error: 'agentId (creator) is required' });
  }
  
  try {
    const task = await tasks.approveTask(req.params.taskId, agentId, result);
    
    // Notify the claimant
    try {
      const notifications = require('./notifications');
      if (notifications.addNotification && task.claimant_id) {
        notifications.addNotification(task.claimant_id, {
          event: 'task.approved',
          data: {
            taskId: req.params.taskId,
            taskTitle: task.title,
            bounty: task.bounty_hbar,
            payment: task.payment
          }
        });
      }
    } catch (e) { console.log('Notification error:', e.message); }
    
    res.json({ success: true, task, message: 'Task approved! Reputation updated.' });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/**
 * POST /tasks/:taskId/reject
 * Reject task submission
 */
router.post('/:taskId/reject', async (req, res) => {
  const { agentId, reason } = req.body;
  
  if (!agentId) {
    return res.status(400).json({ success: false, error: 'agentId (creator) is required' });
  }
  
  try {
    const task = await tasks.rejectTask(req.params.taskId, agentId, reason);
    
    // Notify the claimant
    try {
      const notifications = require('./notifications');
      if (notifications.addNotification && task.claimant_id) {
        notifications.addNotification(task.claimant_id, {
          event: 'task.rejected',
          data: {
            taskId: req.params.taskId,
            taskTitle: task.title,
            reason: reason
          }
        });
      }
    } catch (e) { console.log('Notification error:', e.message); }
    
    res.json({ success: true, task, message: 'Submission rejected. Claimant can resubmit.' });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/**
 * POST /tasks/:taskId/cancel
 * Cancel a task
 */
router.post('/:taskId/cancel', async (req, res) => {
  const { agentId } = req.body;
  
  if (!agentId) {
    return res.status(400).json({ success: false, error: 'agentId (creator) is required' });
  }
  
  try {
    const task = await tasks.cancelTask(req.params.taskId, agentId);
    res.json({ success: true, task, message: 'Task cancelled.' });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/**
 * GET /tasks/:taskId/comments
 * Get all comments for a task
 */
router.get('/:taskId/comments', async (req, res) => {
  try {
    const comments = await tasks.getComments(req.params.taskId);
    res.json({ success: true, comments });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /tasks/:taskId/comments
 * Add a comment to a task
 */
router.post('/:taskId/comments', async (req, res) => {
  const { agentId, content } = req.body;
  
  if (!agentId || !content) {
    return res.status(400).json({ success: false, error: 'agentId and content are required' });
  }
  
  try {
    const comment = await tasks.addComment(req.params.taskId, agentId, content);
    
    // Send notification to the other party
    try {
      const task = await tasks.getTask(req.params.taskId);
      const notifications = require('./notifications');
      const recipientId = task.creator_id === agentId ? task.claimant_id : task.creator_id;
      if (recipientId && notifications.addNotification) {
        notifications.addNotification(recipientId, {
          event: 'task.comment',
          data: {
            taskId: req.params.taskId,
            taskTitle: task.title,
            authorId: agentId,
            preview: content.slice(0, 100)
          }
        });
      }
    } catch (e) {
      console.log('Failed to send comment notification:', e.message);
    }
    
    res.status(201).json({ success: true, comment });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

module.exports = router;
