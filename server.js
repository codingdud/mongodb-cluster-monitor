// server.js
const express = require('express');
const path    = require('path');
const logger  = require('./lib/logger');
const MonitorEngine = require('./lib/engine');
const rateLimit = require('express-rate-limit');

const PORT = parseInt(process.env.PORT || '4000', 10);
const app    = express();
const engine = new MonitorEngine();

const frontendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── REST endpoints ─────────────────────────────────────────────────────────

// Full cluster snapshot
app.get('/api/cluster', (req, res) => {
  res.json(engine.getClusterState());
});

// Nodes with optional filter: ?rsType=shard|config|router  &rsName=rs-shard1
app.get('/api/nodes', (req, res) => {
  const state = engine.getClusterState();
  let nodes = state.nodes;
  if (req.query.rsType) nodes = nodes.filter(n => n.rsType === req.query.rsType);
  if (req.query.rsName) nodes = nodes.filter(n => n.rsName === req.query.rsName);
  res.json({ nodes, summary: state.summary });
});

// Single node detail
app.get('/api/nodes/:id', (req, res) => {
  const state = engine.getClusterState();
  const node = state.nodes.find(n => n.id === req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  res.json(node);
});

// Replica sets grouped
app.get('/api/replicasets', (req, res) => {
  const state = engine.getClusterState();
  let rs = Object.values(state.replicaSets);
  if (req.query.rsType) rs = rs.filter(r => r.rsType === req.query.rsType);
  res.json(rs);
});

// Shard distribution (from mongos)
app.get('/api/shards', (req, res) => {
  const state = engine.getClusterState();
  const mongos = state.nodes.find(n => n.rsType === 'router');
  if (!mongos?.shards) return res.status(503).json({ error: 'Mongos unavailable' });
  res.json(mongos.shards);
});

// Profiler across all primaries (optional filter: ?nodeId=shard1_1)
app.get('/api/profiler', (req, res) => {
  const state = engine.getClusterState();
  const { nodeId, minMs } = req.query;
  let nodes = state.nodes.filter(n => (n.isPrimary || n.rsType === 'router') && n.profiler);
  if (nodeId) nodes = nodes.filter(n => n.id === nodeId);
  const entries = nodes.flatMap(n =>
    (n.profiler?.entries || []).map(e => ({ ...e, nodeId: n.id, rsName: n.rsName }))
  );
  const filtered = minMs
    ? entries.filter(e => e.millis >= parseInt(minMs))
    : entries;
  filtered.sort((a, b) => b.millis - a.millis);
  res.json({ entries: filtered.slice(0, 100), total: filtered.length });
});

// Enable/disable profiling on a node
app.post('/api/profiler/:nodeId/enable', async (req, res) => {
  const { level = 1, slowMs = 100 } = req.body;
  // This requires the engine to expose client access
  res.json({ message: `Profiling enable requested for ${req.params.nodeId}`, level, slowMs });
});

// Update alert configuration
app.post('/api/alerts/config', (req, res) => {
  engine.updateAlertConfig(req.body);
  res.json({ message: 'Alert configuration updated', config: engine.alertConfig });
});

// Archive an alert
app.post('/api/alerts/:id/archive', (req, res) => {
  const success = engine.archiveAlert(req.params.id);
  if (!success) return res.status(404).json({ error: 'Alert not found' });
  res.json({ message: 'Alert archived' });
});

// Clear all archived alerts
app.delete('/api/alerts/archive', (req, res) => {
  engine.clearArchive();
  res.json({ message: 'Archive cleared' });
});

// ── SSE endpoint — streams cluster updates to browser ──────────────────────
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Send current state immediately
  const initial = engine.getClusterState();
  res.write(`data: ${JSON.stringify(initial)}\n\n`);

  // Subscribe to engine updates
  const onUpdate = (data) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };
  engine.on('update', onUpdate);

  // Heartbeat every 30s to keep connection alive
  const hb = setInterval(() => {
    if (!res.writableEnded) res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    engine.removeListener('update', onUpdate);
    clearInterval(hb);
  });
});

// ── Serve frontend ─────────────────────────────────────────────────────────
app.get('*', frontendLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────
async function main() {
  await engine.start();
  app.listen(PORT, '0.0.0.0', () => {
  logger.info(`🟢 MongoDB Cluster Monitor started on port ${PORT}`);
  logger.info(`👉 http://localhost:${PORT}`);
});

  process.on('SIGINT', () => engine.stop().then(() => process.exit(0)));
  process.on('SIGTERM', () => engine.stop().then(() => process.exit(0)));
}

main().catch(e => {
  logger.error('Startup failed:', e.message);
  process.exit(1);
});


