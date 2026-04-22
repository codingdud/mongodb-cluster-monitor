// lib/engine.js
// MonitorEngine — connects ONLY to mongos, auto-discovers all config nodes,
// replica-sets and shards, then optionally opens direct connections per-node.

const { EventEmitter } = require('events');
const { MongoClient } = require('mongodb');
const {
  collectServerStatus,
  collectReplStatus,
  collectRSConfig,
  collectHealth,
  collectProfiler,
  collectCurrentOp,
  collectShardStatus,
  collectOplog,
  collectRSStatusDirect,
  parseRsStatus,
} = require('./collectors');
const logger   = require('./logger');
const notifier = require('./notifier');

const POLL_MS = parseInt(process.env.POLL_MS || '5000', 10);
const PROFILER_MS = parseInt(process.env.PROFILER_MS || '15000', 10);
const SLOW_MS = parseInt(process.env.SLOW_MS || '100', 10);
const ALERT_LAG_MS = parseInt(process.env.ALERT_LAG_MS || '10000', 10);
const ALERT_OPS_LIMIT = parseInt(process.env.ALERT_OPS_LIMIT || '2000', 10);
const CONNECT_TIMEOUT = 3000;

// Mongos entry point (one or more, comma-separated)
const MONGOS_URIS = (process.env.MONGOS_URI || 'mongodb://localhost:27017')
  .split(',')
  .map(u => u.trim());

const HISTORY_LEN = 500;

// ── Optional per-node direct-connection overrides ──────────────────────────
// Set in .env as a comma-separated list: nodeId=host:port,nodeId=host:port
// Example: NODE_OVERRIDES=config1=localhost:27019,config2=localhost:27020,shard1_1=localhost:27030
// This lets the engine reach nodes via Docker-exposed ports when internal
// hostnames (like shard1_1, config1) are not resolvable from the host.
// In a unified production network (e.g. K8s or VPC), this is usually NOT needed
// as the engine automatically discovers and connects to nodes via their internal names.
const NODE_OVERRIDES = (() => {
  const raw = process.env.NODE_OVERRIDES || '';
  const map = {};
  raw.split(',').filter(Boolean).forEach(entry => {
    const [id, addr] = entry.trim().split('=');
    if (!id || !addr) return;
    const lastColon = addr.lastIndexOf(':');
    if (lastColon === -1) return;
    map[id.trim()] = {
      host: addr.slice(0, lastColon).trim(),
      port: parseInt(addr.slice(lastColon + 1).trim(), 10),
    };
  });
  return map;
})();

if (Object.keys(NODE_OVERRIDES).length > 0) {
  logger.info(`NODE_OVERRIDES active for: ${Object.keys(NODE_OVERRIDES).join(', ')}`);
}

class MonitorEngine extends EventEmitter {
  constructor() {
    super();
    // mongos-level client(s)
    this.mongosClients = [];          // [{ uri, client, online }]
    // per-node direct clients (discovered dynamically)
    this.nodeClients = new Map();   // nodeId → MongoClient | null
    // topology discovered from mongos
    this.topology = [];          // array of node descriptors
    this.snapshots = new Map();   // nodeId → snapshot
    this.history = new Map();   // nodeId → [opcounters...]
    this.prevOps = new Map();   // nodeId → previous opcounters
    this.profilerStore = new Map();   // nodeId → profiler data (independent of stats poll)
    this.alerts = [];          // active alerts
    this.running = false;
    this._intervals = [];
    this.alertConfig = {
      lagMs: ALERT_LAG_MS,
      opsLimit: ALERT_OPS_LIMIT,
      emailEnabled: false,
      recipients: []
    };
    this.sentAlerts = new Set();   // keys of alerts already emailed
    this.archivedAlerts = [];          // alerts manually archived by user
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  async start() {
    this.running = true;
    logger.info('Starting — connecting to mongos router(s):', MONGOS_URIS);

    // Connect to all mongos URIs
    await Promise.all(MONGOS_URIS.map(uri => this._connectMongos(uri)));

    // Discover topology from the first available mongos
    await this._discoverTopology();

    // Boot polling intervals
    const mainTimer = setInterval(() => this._pollAll(), POLL_MS);
    const profTimer = setInterval(() => this._pollProfilers(), PROFILER_MS);
    const redisTimer = setInterval(() => this._discoverTopology(), 30_000); // re-discover every 30s
    this._intervals.push(mainTimer, profTimer, redisTimer);

    // First poll immediately
    await this._pollAll();
    this._pollProfilers();
  }

  async stop() {
    this.running = false;
    this._intervals.forEach(clearInterval);
    for (const { client } of this.mongosClients) {
      try { await client.close(); } catch (_) { }
    }
    for (const [, c] of this.nodeClients) {
      if (c) { try { await c.close(); } catch (_) {} }
    }
    logger.info('Stopped');
  }

  // ── Mongos connection ─────────────────────────────────────────────────────
  async _connectMongos(uri) {
    try {
      const client = new MongoClient(uri, {
        connectTimeoutMS: CONNECT_TIMEOUT,
        serverSelectionTimeoutMS: CONNECT_TIMEOUT,
        socketTimeoutMS: CONNECT_TIMEOUT,
      });
      await client.connect();
      this.mongosClients.push({ uri, client, online: true });
      logger.info(`✓ Mongos connected: ${uri}`);
    } catch (e) {
      logger.warn(`✗ Mongos failed: ${uri} — ${e.message.substring(0, 80)}`);
      this.mongosClients.push({ uri, client: null, online: false });
    }
  }

  _getActiveMongos() {
    return this.mongosClients.find(m => m.client && m.online) || null;
  }

  // ── Auto-discover topology via mongos ─────────────────────────────────────
  async _discoverTopology() {
    const m = this._getActiveMongos();
    if (!m) {
      logger.warn('No active mongos — topology not discovered');
      return;
    }

    try {
      const db = m.client.db('admin');

      // 1. Router itself
      const routerNode = {
        id: 'mongos',
        host: this._parseHost(m.uri),
        port: this._parsePort(m.uri),
        rsName: 'mongos',
        rsType: 'router',
        label: 'Mongos Router',
        group: 'Router',
        containerName: 'mongos',
        uri: m.uri,
      };

      const discovered = [routerNode];

      // 2. List all shards from mongos
      let shardList = [];
      try {
        const shardsRes = await db.command({ listShards: 1 });
        shardList = shardsRes.shards || [];
      } catch (e) {
        logger.warn('listShards failed:', e.message);
      }

      // 3. Get config server info from mongos
      let configRSHosts = [];
      try {
        const cmdLineOpts = await db.command({ getCmdLineOpts: 1 });
        const cs = cmdLineOpts?.parsed?.sharding?.configDB || '';
        // Format: rs-config/host1:port1,host2:port2,host3:port3
        const [csRSName, csHosts] = cs.includes('/') ? cs.split('/') : ['rs-config', cs];
        configRSHosts = (csHosts || '').split(',').filter(Boolean).map((hp, i) => {
          const [h, p] = hp.trim().split(':');
          return {
            id: `config${i + 1}`,
            host: h,
            port: parseInt(p) || 27019,
            rsName: csRSName || 'rs-config',
            rsType: 'config',
            configNode: true,   // flag: health derived from mongos connectivity
            memberIndex: i,      // position in the RS members array
            label: `Config ${i + 1}`,
            group: 'Config Replica Set',
            containerName: `config${i + 1}`,
          };
        });
      } catch (e) {
        logger.warn('getCmdLineOpts failed:', e.message);
      }

      // If getCmdLineOpts didn't work, try reading from config.shards
      if (configRSHosts.length === 0) {
        try {
          const configDoc = await m.client.db('config').collection('version').findOne({});
          if (configDoc?.configsvrConnectionString) {
            const cs = configDoc.configsvrConnectionString;
            const [csRSName, csHosts] = cs.includes('/') ? cs.split('/') : ['rs-config', cs];
            configRSHosts = (csHosts || '').split(',').filter(Boolean).map((hp, i) => {
              const [h, p] = hp.trim().split(':');
              return {
                id: `config${i + 1}`,
                host: h,
                port: parseInt(p) || 27019,
                rsName: csRSName || 'rs-config',
                rsType: 'config',
                configNode: true,
                memberIndex: i,
                label: `Config ${i + 1}`,
                group: 'Config Replica Set',
                containerName: `config${i + 1}`,
              };
            });
          }
        } catch (_) { }
      }

      discovered.push(...configRSHosts);

      // 4. Parse shard replica set members from shard host strings
      for (const shard of shardList) {
        // shard.host = "rs-shard1/host1:port1,host2:port2,host3:port3"
        const [rsName, hostsStr] = shard.host.includes('/')
          ? shard.host.split('/')
          : [shard._id, shard.host];

        const hosts = (hostsStr || '').split(',').filter(Boolean);
        hosts.forEach((hp, i) => {
          const [h, p] = hp.trim().split(':');
          const idxLabel = i + 1;
          // Build a human-readable group label from the shard _id
          const shardGroupName = shard._id
            .replace(/^rs-/, '')           // strip leading 'rs-'
            .replace(/shard(\d+)/, 'Shard $1'); // 'shard1' → 'Shard 1'
          discovered.push({
            id: `${shard._id}_${idxLabel}`,
            host: h,
            port: parseInt(p) || 27030,
            rsName,                         // e.g. 'rs-shard1' (from host string)
            shardId: shard._id,        // e.g. 'shard1'  (config.shards._id)
            shardState: shard.state,      // 1 = healthy per mongos
            rsType: 'shard',
            label: `${rsName}-${idxLabel}`,
            group: shardGroupName || shard._id,
            containerName: `${shard._id}_${idxLabel}`,
          });
        });
      }

      logger.debug('Discovered topology:', discovered.map(n => `${n.id} (${n.host}:${n.port})`).join(', '));
      logger.info(`Topology: ${discovered.length} nodes discovered (${configRSHosts.length} config, ${shardList.length} shards×members, 1 router)`);

      // Merge with existing topology (keep ids stable, add new, keep removed as offline)
      const newIds = new Set(discovered.map(n => n.id));
      const merged = [...discovered];

      // Keep old nodes not in new discovery (they'll show as offline)
      for (const old of this.topology) {
        if (!newIds.has(old.id)) {
          merged.push({ ...old, _stale: true });
        }
      }

      this.topology = merged;

      // Ensure history maps exist for all discovered nodes
      for (const n of this.topology) {
        if (!this.history.has(n.id)) this.history.set(n.id, []);
      }

    } catch (e) {
      logger.error('_discoverTopology error:', e.message);
    }
  }

  // ── Per-node direct connections (best-effort) ────────────────────────────
  async _connectNodeDirect(node) {
    if (node.rsType === 'router') return; // mongos already connected above
    if (this.nodeClients.has(node.id) && this.nodeClients.get(node.id)) return;

    // Use override address if configured (for Docker-exposed ports)
    const override = NODE_OVERRIDES[node.id];
    const host = override?.host || node.host;
    const port = override?.port || node.port;

    const uri = `mongodb://${host}:${port}/?directConnection=true&connectTimeoutMS=${CONNECT_TIMEOUT}&serverSelectionTimeoutMS=${CONNECT_TIMEOUT}&socketTimeoutMS=${CONNECT_TIMEOUT}`;
    logger.debug(`Connecting to node ${node.id} (Discovered: ${node.host}:${node.port}) via: mongodb://${host}:${port}`);
    try {
      const client = new MongoClient(uri, {
        directConnection: true,
        connectTimeoutMS: CONNECT_TIMEOUT,
        serverSelectionTimeoutMS: CONNECT_TIMEOUT,
        socketTimeoutMS: CONNECT_TIMEOUT,
      });
      await client.connect();
      this.nodeClients.set(node.id, client);
      // Patch the node descriptor so the UI shows the real accessible address
      if (override) {
        node.directHost = host;
        node.directPort = port;
      }
      console.log(`[engine] ✓ Direct: ${node.id} → ${host}:${port}`);
    } catch (err) {
      if (!this.nodeClients.has(node.id)) {
        // Only log the first failure, not every retry
        console.warn(`[engine] ✗ Direct: ${node.id} (${host}:${port}) — ${err.message.substring(0, 100)}`);
      }
      this.nodeClients.set(node.id, null);
    }
  }

  // ── Poll all nodes ──────────────────────────────────────────────────────
  async _pollAll() {
    // Re-try mongos if all are down
    const active = this._getActiveMongos();
    if (!active) {
      for (const m of this.mongosClients) {
        if (!m.online) {
          try {
            const c = new MongoClient(m.uri, {
              connectTimeoutMS: CONNECT_TIMEOUT,
              serverSelectionTimeoutMS: CONNECT_TIMEOUT,
            });
            await c.connect();
            m.client = c;
            m.online = true;
            await this._discoverTopology();
          } catch (_) { }
        }
      }
    }

    await Promise.all(this.topology.map(n => this._pollNode(n)));
    this._crossVerifyHealth();
    this._emitUpdate();
  }

  async _pollNode(node) {
    const base = {
      id: node.id,
      ...node,
      online: false,
      ts: new Date(),
    };

    try {
      if (node.rsType === 'router') {
        // ── MONGOS: use existing mongos client ──────────────────────────
        const m = this._getActiveMongos();
        if (!m) {
          this.snapshots.set(node.id, { ...base, error: 'Mongos unreachable' });
          return;
        }
        const db = m.client.db('admin');
        const ss = await collectServerStatus(db);
        const shards = await collectShardStatus(db);

        this.snapshots.set(node.id, {
          ...base,
          online: true,
          role: 'ROUTER',
          isPrimary: false,
          serverStatus: ss,
          shards,
        });

      } else {
        // ── CONFIG / SHARD: try direct connection first ────────────────
        await this._connectNodeDirect(node);
        const directClient = this.nodeClients.get(node.id);

        if (directClient) {
          // Update base with any patches made by _connectNodeDirect (e.g. directHost)
          const updatedBase = { ...base, ...node };
          await this._pollNodeDirect(node, updatedBase, directClient);
        } else {
          await this._pollNodeViaMongos(node, base);
        }
      }
    } catch (e) {
      // Mark direct client as dead
      const c = this.nodeClients.get(node.id);
      if (c) { try { await c.close(); } catch (_) { } this.nodeClients.set(node.id, null); }
      this.snapshots.set(node.id, { ...base, error: e.message });
    }
  }

  async _pollNodeDirect(node, base, client) {
    const db = client.db('admin');
    const ss = await collectServerStatus(db);
    let rs = null;
    let rsConf = null;
    let health = null;
    let oplog = null;

    if (node.rsType !== 'router') {
      // Collect rs.status() and rs.conf() and ping/hello in parallel
      [rs, rsConf, health] = await Promise.all([
        collectReplStatus(db),
        collectRSConfig(db),
        collectHealth(db),
      ]);
    }
    // Collect oplog for any PRIMARY (config or shard)
    if ((node.rsType === 'shard' || node.rsType === 'config') && rs?.myStateStr === 'PRIMARY') {
      oplog = await collectOplog(db);
    }

    const role = rs?.myStateStr || 'UNKNOWN';
    const isPrimary = role === 'PRIMARY';

    const ops = ss.opcounters;
    const prev = this.prevOps.get(node.id);
    let opsRate = null;
    if (prev) {
      const dtSec = POLL_MS / 1000;
      opsRate = {
        insert: Math.max(0, Math.round((ops.insert - prev.insert) / dtSec)),
        query: Math.max(0, Math.round((ops.query - prev.query) / dtSec)),
        update: Math.max(0, Math.round((ops.update - prev.update) / dtSec)),
        delete: Math.max(0, Math.round((ops.delete - prev.delete) / dtSec)),
        command: Math.max(0, Math.round((ops.command - prev.command) / dtSec)),
        total: 0,
      };
      opsRate.total = opsRate.insert + opsRate.query + opsRate.update + opsRate.delete + opsRate.command;
    }
    this.prevOps.set(node.id, { ...ops });

    const hist = this.history.get(node.id) || [];
    if (opsRate) {
      hist.push({ ts: Date.now(), ...opsRate });
      if (hist.length > HISTORY_LEN) hist.shift();
      this.history.set(node.id, hist);
    }

    this.snapshots.set(node.id, {
      ...base,
      online: true,
      role,
      isPrimary,
      directConnection: true,
      serverStatus: ss,
      opsRate,
      history: hist,
      replicaSet: rs,
      rsConfig: rsConf,
      health: health,
      oplog: oplog,
    });


  }


  async _pollNodeViaMongos(node, base) {
    // No direct connection — derive node health from what mongos knows
    const m = this._getActiveMongos();
    if (!m) {
      this.snapshots.set(node.id, { ...base, error: 'No mongos available' });
      return;
    }

    // ── CONFIG RS nodes ───────────────────────────────────────────────────────
    // Mongos CANNOT function without a healthy config RS, so if mongos is up,
    // the config RS is up. We also try to get real member info via the config DB.
    if (node.configNode) {
      try {
        const adminDb = m.client.db('admin');

        // Try to get real RS member status from mongos's internal config view
        let rsStatus = null;
        let memberInfo = null;

        // MongoDB stores config RS member info in config.replsets (4.4+)
        // and config.mongos tracks registered mongos nodes.
        // Best effort: try replSetGetStatus (works if this mongos is co-located
        // with configsvr, otherwise we read from config collections directly).
        try {
          const r = await adminDb.command({ replSetGetStatus: 1 });
          rsStatus = parseRsStatus(r);
          memberInfo = rsStatus?.members?.find(mem => {
            const [mh] = (mem.name || '').split(':');
            return mh === node.host;
          }) || rsStatus?.members?.[node.memberIndex] || null;
        } catch (_) {
          // replSetGetStatus not available on mongos — build synthetic status
          // from the config RS host list we already have in the topology.
          const configMembers = this.topology
            .filter(n => n.configNode)
            .map((n, i) => ({
              id: i,
              name: `${n.host}:${n.port}`,
              health: 1,
              state: null,
              stateStr: 'ONLINE',
              lagSec: 0,
              pingMs: 0,
              self: n.id === node.id,
            }));
          rsStatus = {
            setName: node.rsName,
            myStateStr: 'N/A (via mongos)',
            members: configMembers,
            fromMongos: true,
          };
          memberInfo = configMembers[node.memberIndex] || null;
        }

        // Config RS is healthy iff mongos is connected (guaranteed above)
        // BUT we should still check the member health from the status we parsed
        const isOnline = memberInfo ? memberInfo.health === 1 : false;
        const role = memberInfo?.stateStr || (isOnline ? 'ONLINE' : 'DOWN');
        const isPrimary = role === 'PRIMARY';

        this.snapshots.set(node.id, {
          ...base,
          online: isOnline,
          role,
          isPrimary,
          directConnection: false,
          limitedStats: isOnline,
          replicaSet: rsStatus,
          memberInfo,
          note: 'Config RS — status via mongos/config collections.',
        });
      } catch (e) {
        this.snapshots.set(node.id, {
          ...base,
          online: false,
          role: 'UNKNOWN',
          directConnection: false,
          note: 'Config RS status failed via mongos',
          error: e.message,
        });
      }
      return;
    }

    // ── SHARD nodes ───────────────────────────────────────────────────────────
    try {
      const adminDb = m.client.db('admin');

      // Use shardId (e.g. 'shard1') for config.shards lookup
      const lookupKey = node.shardId || node.rsName;
      const rsStatus = await collectRSStatusDirect(adminDb, lookupKey, node.rsName);

      // Try to find this specific member by host:port
      let memberInfo = null;
      if (rsStatus?.members?.length) {
        memberInfo = rsStatus.members.find(mem => {
          const [mh, mp] = (mem.name || '').split(':');
          return mh === node.host && parseInt(mp) === node.port;
        });
        // Position fallback: Docker hostnames won't match, use index suffix
        if (!memberInfo) {
          const memberIdx = parseInt(node.id.split('_').pop(), 10) - 1;
          if (memberIdx >= 0 && memberIdx < rsStatus.members.length) {
            memberInfo = rsStatus.members[memberIdx];
          }
        }
      }

      // ONLINE if member health===1
      const isOnline = memberInfo?.health === 1;

      const role = memberInfo?.stateStr || (isOnline ? 'ONLINE' : 'DOWN');
      const isPrimary = role === 'PRIMARY';

      this.snapshots.set(node.id, {
        ...base,
        online: isOnline,
        role,
        isPrimary,
        directConnection: false,
        limitedStats: isOnline,
        replicaSet: rsStatus,
        memberInfo,
        note: 'Limited stats — no direct connection (internal host). Health via mongos.',
      });
    } catch (e) {
      const fallbackOnline = false; // Never assume online if error occurs and no direct connection
      this.snapshots.set(node.id, {
        ...base,
        online: fallbackOnline,
        role: 'DOWN',
        directConnection: false,
        note: 'Stats unavailable (no direct connection & error)',
        error: e.message,
      });
    }
  }

  // ── authoritatively sync health with RS peers ──────────────────────────────
  _crossVerifyHealth() {
    // 1. Group nodes by RS
    const rsGroups = {};
    for (const snap of this.snapshots.values()) {
      if (!snap.rsName || snap.rsType === 'router') continue;
      if (!rsGroups[snap.rsName]) rsGroups[snap.rsName] = [];
      rsGroups[snap.rsName].push(snap);
    }

    // 2. For each RS, find the authoritative member status
    for (const rsName in rsGroups) {
      const snaps = rsGroups[rsName];
      // Find a node that has AUTHORITATIVE member info (ideally the PRIMARY)
      const authNode = snaps.find(s => s.isPrimary && s.replicaSet?.members)
        || snaps.find(s => s.replicaSet?.members);

      if (!authNode) continue;

      const members = authNode.replicaSet.members;

      // 3. Update nodes that don't have direct connections
      for (const snap of snaps) {
        if (snap.directConnection) continue;

        // Find this node in the peer's member list
        const m = members.find(mem => {
          const [mh, mp] = (mem.name || '').split(':');
          return mh === snap.host && parseInt(mp || 27017) === snap.port;
        }) || (snap.memberIndex !== undefined ? members[snap.memberIndex] : null);

        if (m) {
          const wasOnline = snap.online;
          const isNowOnline = m.health === 1;

          if (wasOnline !== isNowOnline) {
            console.log(`[engine] Correcting ${snap.id} health via peers: ${wasOnline} -> ${isNowOnline}`);
          }

          snap.online = isNowOnline;
          snap.role = m.stateStr || (isNowOnline ? 'ONLINE' : 'DOWN');
          snap.health = snap.health || {};
          snap.health.ok = isNowOnline;

          // Re-sync with snapshot store
          this.snapshots.set(snap.id, { ...snap });
        }
      }
    }
  }

  // ── Poll profilers ────────────────────────────────────────────────────────
  async _pollProfilers() {
    // 1. Find all nodes that SHOULD be profiled
    const candidateNodes = this.topology.filter(n => {
      const snap = this.snapshots.get(n.id);
      return (snap?.isPrimary && snap?.online) || (n.rsType === 'router' && snap?.online);
    });

    if (candidateNodes.length === 0) return;

    // 2. Poll those that HAVE a connection, mark those that DON'T
    await Promise.allSettled(candidateNodes.map(async node => {
      const snap = this.snapshots.get(node.id);

      let client;
      if (node.rsType === 'router') {
        client = this._getActiveMongos()?.client;
      } else {
        client = this.nodeClients.get(node.id);
      }

      if (!client) {
        this.profilerStore.set(node.id, {
          enabled: false,
          entries: [],
          activeOps: [],
          error: snap?.directConnection === false ? 'No direct connection' : 'Client unreachable'
        });
        return;
      }

      try {
        const [profiler, activeOps] = await Promise.all([
          collectProfiler(client, SLOW_MS, 50, node.rsType === 'router'),
          collectCurrentOp(client)
        ]);

        this.profilerStore.set(node.id, {
          ...profiler,
          activeOps: activeOps || []
        });
      } catch (err) {
        console.error(`[engine] Profiler/CurrentOp poll failed for ${node.id}:`, err.message);
        this.profilerStore.set(node.id, {
          enabled: false,
          entries: [],
          activeOps: [],
          error: err.message
        });
      }
    }));

    this._emitUpdate();
  }


  // ── Emit SSE update ───────────────────────────────────────────────────────
  _emitUpdate() {
    this.emit('update', this.getClusterState());
  }

  // ── Public API ────────────────────────────────────────────────────────────
  getClusterState() {
    const nodes = this.topology.map(n => {
      const snap = this.snapshots.get(n.id) || { ...n, online: false, ts: new Date() };
      snap.profiler = this.profilerStore.get(n.id) || null;
      return snap;
    });

    return {
      ts: new Date().toISOString(),
      pollMs: POLL_MS,
      mongosUris: MONGOS_URIS,
      nodes,
      summary: this._buildSummary(nodes),
      replicaSets: this._groupByRS(nodes),
      alerts: this.alerts,
      archivedAlerts: this.archivedAlerts,
      alertConfig: this.alertConfig,
    };
  }

  archiveAlert(alertId) {
    const idx = this.alerts.findIndex(a => a.id === alertId);
    if (idx !== -1) {
      const [alert] = this.alerts.splice(idx, 1);

      // Check if ALREADY in archive (prevent duplicate archive entries)
      const archIdx = this.archivedAlerts.findIndex(a => a.id === alert.id);
      if (archIdx !== -1) {
        this.archivedAlerts[archIdx] = { ...this.archivedAlerts[archIdx], ...alert, archivedAt: new Date() };
      } else {
        this.archivedAlerts.unshift({ ...alert, archivedAt: new Date() });
      }

      this.archivedAlerts = this.archivedAlerts.slice(0, 100);
      this._emitUpdate();
      return true;
    }
    return false;
  }

  clearArchive() {
    this.archivedAlerts = [];
    this._emitUpdate();
  }

  updateAlertConfig(newConfig) {
    if (newConfig.lagMs !== undefined) this.alertConfig.lagMs = parseInt(newConfig.lagMs, 10);
    if (newConfig.opsLimit !== undefined) this.alertConfig.opsLimit = parseInt(newConfig.opsLimit, 10);
    if (newConfig.emailEnabled !== undefined) this.alertConfig.emailEnabled = !!newConfig.emailEnabled;
    if (newConfig.recipients !== undefined) this.alertConfig.recipients = Array.isArray(newConfig.recipients) ? newConfig.recipients : [];
    this._emitUpdate();
  }

  _analyzeAlerts(nodes) {
    const currentActive = [];
    const now = new Date();

    // 1. Check for Offline Nodes
    nodes.forEach(n => {
      if (!n.online) {
        currentActive.push({
          key: `NODE_DOWN:${n.id}`, // Unique key for deduplication
          severity: 'critical',
          type: 'NODE_DOWN',
          title: 'Node Offline',
          message: `${n.label || n.id} is unreachable.`,
          ts: now,
          nodeId: n.id
        });
      }
    });

    // 2. Check for High Replication Lag
    // IMPORTANT: Only check nodes with real replication status (directConnection: true)
    // Nodes accessed via mongos get synthetic status with lagSec: 0 (mongos doesn't know actual lag)
    nodes.forEach(n => {
      if (!n.directConnection) return; // Skip nodes without real RS status
      
      const members = n.replicaSet?.members || [];
      members.forEach(m => {
        // lagSec is in seconds, alertConfig.lagMs is in milliseconds
        if (m.lagSec * 1000 > this.alertConfig.lagMs) {
          currentActive.push({
            key: `HIGH_LAG:${n.id}:${m.name}`,
            severity: 'warning',
            type: 'HIGH_LAG',
            title: 'High Replication Lag',
            message: `${m.name} is ${m.lagSec}s behind.`,
            ts: now,
            nodeId: n.id
          });
        }
      });
    });

    // 3. Check for Operation Spikes
    // Only count nodes that have real operation statistics (directConnection: true)
    // Nodes accessed via mongos don't have opsRate data
    const nodesWithOpsData = nodes.filter(n => n.directConnection && n.opsRate);
    const totalOps = nodesWithOpsData.reduce((s, n) => s + (n.opsRate?.total || 0), 0);
    if (nodesWithOpsData.length > 0 && totalOps > this.alertConfig.opsLimit) {
      currentActive.push({
        key: `HIGH_LOAD:CLUSTER`,
        severity: 'warning',
        type: 'HIGH_LOAD',
        title: 'High Cluster Load',
        message: `Total operations reached ${totalOps} ops/s (from ${nodesWithOpsData.length} nodes with metrics).`,
        ts: now
      });
    }

    // Merge logic: keep historical but don't duplicate active ones in the same list
    // We'll define "alerts" as the last 50 UNIQUE events that occurred.

    // Track which archived alerts are STILL ACTIVE so we don't remove them yet
    const activeArchivedKeys = new Set();
    const currentActiveKeys = new Set(currentActive.map(a => a.key));

    if (currentActive.length > 0) {
      logger.debug(`_analyzeAlerts: ${currentActive.length} active condition(s) detected: ${currentActive.map(a => a.key).join(', ')}`);
    }

    currentActive.forEach(active => {
      // 1. Check if already in active alerts
      const activeIdx = this.alerts.findIndex(a => a.id === active.key);
      if (activeIdx !== -1) {
        // Update existing alert to show it's still active
        this.alerts[activeIdx] = { ...this.alerts[activeIdx], ts: active.ts, message: active.message };
        logger.debug(`Alert updated (existing): ${active.key}`);
        return;
      }

      // 2. Check if already in ARCHIVED alerts
      const archivedIdx = this.archivedAlerts.findIndex(a => a.id === active.key);
      if (archivedIdx !== -1) {
        // Condition still persists, but user archived it. 
        // Update it in archive and mark as still active for suppression.
        this.archivedAlerts[archivedIdx] = { ...this.archivedAlerts[archivedIdx], ts: active.ts, message: active.message };
        activeArchivedKeys.add(active.key);
        logger.debug(`Alert updated (archived/still active): ${active.key}`);
        return;
      }

      // 3. New alert - add to front
      const newAlert = { ...active, id: active.key };
      this.alerts.unshift(newAlert);
      this.alerts = this.alerts.slice(0, 50);
      logger.info(`NEW ALERT [${active.severity.toUpperCase()}]: ${active.title} — ${active.message}`);

      // TRIGGER EMAIL FOR CRITICAL ALERTS
      if (newAlert.severity === 'critical' && this.alertConfig.emailEnabled && !this.sentAlerts.has(active.key)) {
        logger.info(`Sending email notification for critical alert: ${active.key}`);
        notifier.notifyCriticalAlert(newAlert, this.alertConfig.recipients);
        this.sentAlerts.add(active.key);
      }
    });

    // 4. Cleanup resolved alerts: 
    // - Remove archived suppression if the condition is gone (so it can fire again later)
    // - Remove from sentAlerts trackers
    const beforeArchiveCount = this.archivedAlerts.length;
    this.archivedAlerts = this.archivedAlerts.filter(a => {
      // Only keep in archive if it was a "one-off" event (no key) OR if it's still active
      const keep = !a.id || currentActiveKeys.has(a.id);
      if (!keep && a.id && !currentActiveKeys.has(a.id)) {
        logger.debug(`Alert resolved (removed from archive): ${a.id}`);
      }
      return keep;
    });

    for (const key of this.sentAlerts) {
      if (!currentActiveKeys.has(key)) {
        logger.debug(`Alert resolved (cleared from sentAlerts): ${key}`);
        this.sentAlerts.delete(key);
      }
    }
  }

  _buildSummary(nodes) {
    // Re-run alert analysis during summary build
    this._analyzeAlerts(nodes);
    const online = nodes.filter(n => n.online).length;
    const down = nodes.filter(n => !n.online).length;
    const conns = nodes.reduce((s, n) => s + (n.serverStatus?.connections?.current || 0), 0);
    const maxLag = nodes.reduce((max, n) => {
      const members = n.replicaSet?.members || [];
      const lag = Math.max(...members.map(m => m.lagSec || 0), 0);
      return Math.max(max, lag);
    }, 0);
    const totalOps = nodes.reduce((s, n) => s + (n.opsRate?.total || 0), 0);
    const allSlowQ = nodes.flatMap(n => n.profiler?.entries || []);
    const collscans = allSlowQ.filter(q => (q.planSummary || '').includes('COLLSCAN')).length;

    return {
      totalNodes: nodes.length,
      online, down,
      totalConnections: conns,
      maxReplicationLagSec: Math.round(maxLag * 100) / 100,
      totalOpsPerSec: totalOps,
      slowQueryCount: allSlowQ.length,
      collscanCount: collscans,
    };
  }

  _groupByRS(nodes) {
    const groups = {};
    for (const n of nodes) {
      const k = n.rsName || n.id;
      if (!groups[k]) groups[k] = { rsName: k, rsType: n.rsType, nodes: [] };
      groups[k].nodes.push(n);
    }
    return groups;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  _parseHost(uri) {
    try {
      const u = new URL(uri.replace('mongodb://', 'http://'));
      return u.hostname || 'localhost';
    } catch (_) { return 'localhost'; }
  }

  _parsePort(uri) {
    try {
      const u = new URL(uri.replace('mongodb://', 'http://'));
      return parseInt(u.port) || 27017;
    } catch (_) { return 27017; }
  }
}

module.exports = MonitorEngine;
