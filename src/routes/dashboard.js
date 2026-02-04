/**
 * Dashboard Analytics API Routes
 * Historical data for dashboard charts
 */

const express = require('express');
const router = express.Router();
const persistence = require('../services/db');

/**
 * GET /dashboard/stats
 * Get historical stats for charts (last 7 days)
 */
router.get('/stats', async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  
  try {
    // Get all tasks for historical analysis
    // Use loadAllTasks() or db.prepare directly
    let allTasks = [];
    let allAgents = [];
    
    try {
      if (persistence.loadAllTasks) {
        allTasks = persistence.loadAllTasks() || [];
      } else if (persistence.db) {
        allTasks = persistence.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() || [];
      }
    } catch (e) {
      console.error('Failed to load tasks:', e.message);
    }
    
    try {
      if (persistence.loadAllAgents) {
        allAgents = persistence.loadAllAgents() || [];
      } else if (persistence.db) {
        allAgents = persistence.db.prepare('SELECT * FROM agents').all() || [];
      }
    } catch (e) {
      console.error('Failed to load agents:', e.message);
    }
    
    // Build daily stats
    const now = new Date();
    const dailyStats = [];
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      const nextDateStr = nextDate.toISOString().split('T')[0];
      
      // Tasks created on this day
      const tasksCreated = allTasks.filter(t => {
        const created = t.created_at || t.createdAt;
        if (!created) return false;
        const createdDate = created.split('T')[0];
        return createdDate === dateStr;
      }).length;
      
      // Tasks approved on this day (HBAR paid out)
      const approvedTasks = allTasks.filter(t => {
        const completed = t.completed_at || t.updated_at;
        if (t.status !== 'approved' || !completed) return false;
        const completedDate = completed.split('T')[0];
        return completedDate === dateStr;
      });
      const hbarPaid = approvedTasks.reduce((sum, t) => sum + (parseFloat(t.bounty_hbar) || 0), 0);
      
      // Agents registered by this day (cumulative)
      const agentsTotal = allAgents.filter(a => {
        const registered = a.created_at || a.registeredAt || a.registered_at;
        if (!registered) return true; // Count agents without date
        return registered <= nextDateStr;
      }).length;
      
      dailyStats.push({
        date: dateStr,
        label: date.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }),
        tasksCreated,
        hbarPaid,
        agentsTotal
      });
    }
    
    // Calculate totals
    const totalTasks = allTasks.length;
    const openTasks = allTasks.filter(t => t.status === 'open').length;
    const completedTasks = allTasks.filter(t => t.status === 'approved').length;
    const totalHbarPaid = allTasks
      .filter(t => t.status === 'approved')
      .reduce((sum, t) => sum + (parseFloat(t.bounty_hbar) || 0), 0);
    const totalEscrow = allTasks
      .filter(t => t.status === 'open' || t.status === 'claimed' || t.status === 'submitted')
      .reduce((sum, t) => sum + (parseFloat(t.bounty_hbar) || 0), 0);
    
    res.json({
      success: true,
      period: `${days} days`,
      daily: dailyStats,
      totals: {
        agents: allAgents.length,
        tasks: totalTasks,
        openTasks,
        completedTasks,
        hbarPaid: totalHbarPaid,
        hbarEscrow: totalEscrow
      }
    });
  } catch (e) {
    console.error('Dashboard stats error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /dashboard/leaderboard
 * Get top earners leaderboard
 */
router.get('/leaderboard', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  
  try {
    let tasks = [];
    try {
      if (persistence.db) {
        tasks = persistence.db.prepare(
          `SELECT claimant_id, bounty_hbar FROM tasks WHERE status = 'approved' AND claimant_id IS NOT NULL`
        ).all() || [];
      }
    } catch (e) {
      console.error('Failed to load tasks for leaderboard:', e.message);
    }
    
    // Aggregate earnings by agent
    const earnings = {};
    tasks.forEach(t => {
      const agent = t.claimant_id;
      const amount = t.bounty_hbar || 0;
      if (agent && amount > 0) {
        earnings[agent] = (earnings[agent] || 0) + amount;
      }
    });
    
    // Sort and limit
    const sorted = Object.entries(earnings)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([agentId, total], i) => ({
        rank: i + 1,
        agentId,
        totalEarned: total,
        taskCount: tasks.filter(t => t.claimant_id === agentId).length
      }));
    
    res.json({
      success: true,
      leaderboard: sorted
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /dashboard/activity
 * Get recent activity feed
 */
router.get('/activity', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  
  try {
    let tasks = [];
    let messages = [];
    
    // Get recent tasks with activity
    try {
      if (persistence.db) {
        tasks = persistence.db.prepare(
          `SELECT * FROM tasks ORDER BY updated_at DESC, created_at DESC LIMIT ?`
        ).all(limit * 2) || [];
      }
    } catch (e) {
      console.error('Failed to load tasks for activity:', e.message);
    }
    
    // Get recent messages
    try {
      if (persistence.db) {
        messages = persistence.db.prepare(
          `SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?`
        ).all(limit) || [];
      }
    } catch (e) {
      console.error('Failed to load messages for activity:', e.message);
    }
    
    // Build activity items
    const activities = [];
    
    // Add task activities
    tasks.slice(0, limit).forEach(task => {
      const time = task.updated_at || task.created_at;
      if (task.status === 'approved') {
        activities.push({
          type: 'task.completed',
          icon: '✅',
          text: `Task completed: "${(task.title || '').slice(0, 30)}"`,
          detail: task.bounty_hbar ? `+${task.bounty_hbar} HBAR` : '',
          agentId: task.claimant_id,
          timestamp: time
        });
      } else if (task.status === 'claimed') {
        activities.push({
          type: 'task.claimed',
          icon: '🎯',
          text: `"${(task.title || '').slice(0, 30)}" claimed`,
          agentId: task.claimant_id,
          timestamp: time
        });
      } else if (task.status === 'submitted') {
        activities.push({
          type: 'task.submitted',
          icon: '📤',
          text: `Work submitted for "${(task.title || '').slice(0, 25)}"`,
          agentId: task.claimant_id,
          timestamp: time
        });
      }
    });
    
    // Add message activities
    messages.slice(0, 5).forEach(msg => {
      activities.push({
        type: 'message',
        icon: '💬',
        text: `Posted in #${(msg.channel_id || 'general').replace('channel_', '')}`,
        agentId: msg.agent_id || msg.author_agent_id,
        timestamp: msg.timestamp
      });
    });
    
    // Sort by timestamp and limit
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    res.json({
      success: true,
      activities: activities.slice(0, limit)
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
