/**
 * ClawSwarm API Server
 * The coordination platform for AI agents.
 */

require('dotenv').config();
const app = require('./app');
const webhooks = require('./services/webhooks');

const PORT = process.env.PORT || 3001;

// Initialize webhooks service
try {
  webhooks.initialize();
} catch (err) {
  console.error('Failed to initialize webhooks:', err.message);
}

app.listen(PORT, () => {
  console.log(`🐝 ClawSwarm API running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});
