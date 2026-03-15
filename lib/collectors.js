// lib/collectors.js
// Per-node data collection functions — each returns a plain object or null on error

// ─── SERVER STATUS ────────────────────────────────────────────────────────────
async function collectServerStatus(db) {
  const s = await db.admin().command({ serverStatus: 1, repl: 1, metrics: 1 });
  const op = s.opcounters || {};
  const net = s.network || {};
  const mem = s.mem || {};
  const conn = s.connections || {};
  const wt = s.wiredTiger || {};
  const wtCache = wt.cache || {};
  const cursors = s.metrics?.cursor || {};

  return {
    host: s.host,
    version: s.version,
    process: s.process,          // 'mongod' or 'mongos'
    uptime: s.uptime,
    uptimeHuman: formatUptime(s.uptime),
    pid: s.pid,
    opcounters: {
      insert:  op.insert  || 0,
      query:   op.query   || 0,
      update:  op.update  || 0,
      delete:  op.delete  || 0,
      getmore: op.getmore || 0,
      command: op.command || 0,
    },
    network: {
      bytesIn:  net.bytesIn  || 0,
      bytesOut: net.bytesOut || 0,
      numRequests: net.numRequests || 0,
    },
    connections: {
      current:     conn.current     || 0,
      available:   conn.available   || 0,
      totalCreated: conn.totalCreated || 0,
    },
    mem: {
      resident:  mem.resident  || 0,   // MB
      virtual:   mem.virtual   || 0,   // MB
      mapped:    mem.mapped    || 0,
    },
    wiredTiger: {
      cacheUsedMB:   Math.round((wtCache['bytes currently in the cache'] || 0) / 1024 / 1024),
      cacheSizeMB:   Math.round((wtCache['maximum bytes configured'] || 0) / 1024 / 1024),
      cacheReadAheads: wtCache['pages read into cache'] || 0,
    },
    cursors: {
      totalOpen:    cursors.open?.total || 0,
      timedOut:     cursors.timedOut   || 0,
    },
    globalLock: {
      totalTimeUs: s.globalLock?.totalTime || 0,
      currentQueueTotal: s.globalLock?.currentQueue?.total || 0,
    },
  };
}

// ─── REPLICA SET STATUS ───────────────────────────────────────────────────────
async function collectReplStatus(db) {
  try {
    const r = await db.admin().command({ replSetGetStatus: 1 });
    const self    = r.members?.find(m => m.self);
    const primary = r.members?.find(m => m.stateStr === 'PRIMARY');

    const members = (r.members || []).map(m => {
      let lagSec = 0;
      const isValidOptime = m.optimeDate && m.optimeDate.getTime() > 946684800000; // After year 2000
      const isPrimaryValid = primary?.optimeDate?.getTime() > 946684800000;

      if (primary && m.stateStr !== 'PRIMARY' && m.stateStr !== 'ARBITER' && isValidOptime && isPrimaryValid) {
        lagSec = (primary.optimeDate - m.optimeDate) / 1000;
      }
      return {
        id:            m._id,
        name:          m.name,
        health:        m.health,
        state:         m.state,
        stateStr:      m.stateStr,
        uptime:        m.uptime,
        optime:        m.optimeDate,
        lagSec:        Math.max(0, Math.round(lagSec * 100) / 100),
        pingMs:        m.pingMs || 0,
        votes:         m.votes,
        priority:      m.priority,
        self:          !!m.self,
        configVersion: m.configVersion,
        lastHeartbeat: m.lastHeartbeat,
        lastHeartbeatRecv: m.lastHeartbeatRecv,
        syncSourceHost: m.syncSourceHost || m.syncSource || null,
        optimeDurable: m.optimeDurableDate,
      };
    });

    return {
      setName:    r.set,
      myState:    r.myState,
      myStateStr: r.myStateStr || self?.stateStr || 'UNKNOWN',
      term:       r.term,
      electionId: r.electionId,
      lastElectionDate: r.lastElectionDate,
      protocolVersion: r.protocolVersion,
      members,
      ok:         r.ok,
      optimes:    r.optimes,
    };
  } catch (e) {
    // Only log if it's not a standalone node error (shard members MUST be in RS)
    if (!e.message.includes('not running with --replSet')) {
       console.warn(`[collector] replSetGetStatus failed: ${e.message}`);
    }
    return null;
  }
}

// ─── REPLICA SET CONFIG (rs.conf()) ──────────────────────────────────────────
async function collectRSConfig(db) {
  try {
    const r = await db.admin().command({ replSetGetConfig: 1 });
    const cfg = r.config || {};
    return {
      setName:         cfg._id,
      version:         cfg.version,
      term:            cfg.term,
      protocolVersion: cfg.protocolVersion,
      writeConcernMajorityJournalDefault: cfg.writeConcernMajorityJournalDefault,
      members: (cfg.members || []).map(m => ({
        id:         m._id,
        host:       m.host,
        arbiterOnly: m.arbiterOnly || false,
        hidden:     m.hidden      || false,
        priority:   m.priority,
        votes:      m.votes,
        slaveDelay: m.slaveDelay  || m.secondaryDelaySecs || 0,
        tags:       m.tags        || {},
        horizons:   m.horizons    || {},
      })),
      settings: {
        chainingAllowed:     cfg.settings?.chainingAllowed,
        heartbeatIntervalMs: cfg.settings?.heartbeatIntervalMillis,
        electionTimeoutMs:   cfg.settings?.electionTimeoutMillis,
        catchUpTimeoutMs:    cfg.settings?.catchUpTimeoutMillis,
        getLastErrorModes:   cfg.settings?.getLastErrorModes,
        getLastErrorDefaults: cfg.settings?.getLastErrorDefaults,
      },
    };
  } catch (e) {
    return null;
  }
}

// ─── HEALTH CHECK (ping + isMaster/hello) ────────────────────────────────────
async function collectHealth(db) {
  try {
    const [ping, hello] = await Promise.all([
      db.admin().command({ ping: 1 }),
      db.admin().command({ hello: 1 }).catch(() =>
        db.admin().command({ isMaster: 1 })
      ),
    ]);
    return {
      ok:           ping.ok === 1,
      ismaster:     hello.ismaster || hello.isWritablePrimary || false,
      secondary:    hello.secondary || false,
      setName:      hello.setName,
      setVersion:   hello.setVersion,
      primary:      hello.primary,
      hosts:        hello.hosts || [],
      passives:     hello.passives || [],
      arbiters:     hello.arbiters || [],
      me:           hello.me,
      maxBsonObjectSize: hello.maxBsonObjectSize,
      maxMessageSizeBytes: hello.maxMessageSizeBytes,
      maxWriteBatchSize: hello.maxWriteBatchSize,
      localTime:    hello.localTime,
      logicalSessionTimeoutMinutes: hello.logicalSessionTimeoutMinutes,
      connectionId: hello.connectionId,
      readOnly:     hello.readOnly || false,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── CURRENT OP — ACTIVE QUERIES ──────────────────────────────────────────────
async function collectCurrentOp(client) {
  try {
    const adminDb = client.db('admin');
    const res = await adminDb.command({ currentOp: 1, $all: true });
    const ops = (res.inprog || []).filter(o => {
      // Filter out internal system operations
      if (o.ns === 'admin.$cmd' || o.ns === 'config.$cmd' || o.ns === 'local.$cmd') return false;
      if (o.op === 'idle' || o.op === 'none') return false;
      return true;
    });

    return ops.map(o => ({
      opid:   o.opid,
      active: o.active,
      secs_running: o.secs_running || 0,
      microsecs_running: o.microsecs_running || 0,
      millis: Math.round((o.microsecs_running || 0) / 1000),
      op:     o.op,
      ns:     o.ns || 'unknown',
      query:  JSON.stringify(o.command || o.query || {}).substring(0, 300),
      planSummary: o.planSummary || 'Active',
      client: o.client,
      appId:  o.appName || o.clientMetadata?.application?.name || null,
      waitingForLock: o.waitingForLock || false,
      lockStats: o.lockStats,
    }));
  } catch (e) {
    return [];
  }
}


// ─── PROFILER — SLOW QUERIES (all dbs on the node / router slowms) ───────────
async function collectProfiler(client, slowMs = 100, limit = 50, isRouter = false) {
  const timeoutMs = 5000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (!client) return { enabled: false, entries: [], error: 'No client reference' };
    const adminDb = client.db('admin');

    if (isRouter) {
      // Router supports 'profile' command in some versions, or returns slowms via -1 check.
      try {
        const status = await adminDb.command({ profile: -1 }, { signal: controller.signal });
        const currentSlowMs = status.slowms ?? status.slowMS ?? 100;

        if (currentSlowMs !== slowMs) {
          // Setting slowms on router affects what gets logged to mongos log file.
          // Note: mongos might only support Level 0 for setting thresholds.
          await adminDb.command({ profile: 0, slowms: slowMs }, { signal: controller.signal });
        }
        return { enabled: true, slowMs, entries: [] };
      } catch (err) {
        return { enabled: false, entries: [], error: err.message };
      }
    }

    // List all non-system databases with a timeout
    const dbListRes = await adminDb.command({ listDatabases: 1, nameOnly: true }, { signal: controller.signal });
    const dbNames = (dbListRes.databases || [])
      .map(d => d.name)
      .filter(n => !['local'].includes(n));

    let allEntries = [];
    let anyEnabled = false;

    for (const dbName of dbNames) {
      const db = client.db(dbName);
      let level;
      try {
        level = await db.command({ profile: -1 }, { signal: controller.signal });
      } catch (err) { continue; }

      // If profiling is off (level 0), auto-enable at level 1
      if (level.was === 0) {
        try {
          await db.command({ profile: 1, slowms: slowMs }, { signal: controller.signal });
          level = { was: 1, slowms: slowMs };
        } catch (err) { continue; }
      }

      anyEnabled = true;

      // Read slow query entries from system.profile if it exists
      try {
        const collections = await db.listCollections({ name: 'system.profile' }, { signal: controller.signal }).toArray();
        if (collections.length === 0) continue;

        const entries = await db.collection('system.profile')
          .find({ millis: { $gte: slowMs }, op: { $ne: 'getmore' } })
          .sort({ ts: -1 })
          .limit(dbName === 'admin' || dbName === 'config' ? 20 : limit)
          .toArray();

        allEntries.push(...entries.map(e => ({
          ts:           e.ts,
          op:           e.op,
          ns:           e.ns || `${dbName}.*`,
          dbName,
          millis:       e.millis,
          keysExamined: e.keysExamined || 0,
          docsExamined: e.docsExamined || 0,
          nreturned:    e.nreturned    || 0,
          planSummary:  e.planSummary  || 'N/A',
          execStages:   e.execStats?.stage || null,
          query:        JSON.stringify(e.command || {}).substring(0, 300),
          user:         e.user,
          hint:         optimizationHint(e),
        })));
      } catch (err) {}
    }

    allEntries.sort((a, b) => (b.ts && a.ts) ? (new Date(b.ts) - new Date(a.ts)) : 0);
    allEntries = allEntries.slice(0, limit);

    // We consider profiling "enabled" if at least one database has it on.
    return { enabled: anyEnabled, slowMs, entries: allEntries };
  } catch (e) {
    return { enabled: false, entries: [], error: e.message };
  } finally {
    clearTimeout(timeoutId);
  }
}



// ─── SHARD STATUS (mongos only) ───────────────────────────────────────────────
async function collectShardStatus(db) {
  try {
    const [shardsRes, balancerRes] = await Promise.all([
      db.admin().command({ listShards: 1 }),
      db.admin().command({ balancerStatus: 1 }).catch(() => ({ mode: 'unknown', inBalancerRound: false })),
    ]);

    // Chunk distribution per shard from config db
    const chunkPipeline = [
      { $group: { _id: '$shard', chunks: { $sum: 1 } } },
      { $sort: { chunks: -1 } },
    ];
    const chunkDist = await db.client.db('config').collection('chunks')
      .aggregate(chunkPipeline).toArray();

    // For Mongo 5.0+, chunks reference collections by UUID, not ns string.
    // Resolve namespaces from config.collections
    const collList = await db.client.db('config').collection('collections')
      .find({}, { projection: { _id: 1, uuid: 1 } }).toArray();
    const uuidToNs = {};
    collList.forEach(c => {
      // Different versions store the namespace in _id or other fields
      const ns = c._id;
      const uuid = c.uuid;
      if (uuid) uuidToNs[uuid.toString()] = ns;
    });

    // Namespace chunk distribution
    // Fallback: if 'ns' field is missing (modern Mongo), try 'uuid'
    const nsDistRaw = await db.client.db('config').collection('chunks')
      .aggregate([
        { $group: { _id: { uuid: '$uuid', ns: '$ns', shard: '$shard' }, chunks: { $sum: 1 } } },
        { $group: { 
            _id: '$_id.uuid', 
            fallbackNs: { $first: '$_id.ns' },
            shards: { $push: { shard: '$_id.shard', chunks: '$chunks' } }, 
            total: { $sum: '$chunks' } 
        } },
        { $sort: { total: -1 } },
        { $limit: 10 },
      ]).toArray();

    const nsDist = nsDistRaw.map(n => {
      const resolvedNs = n._id ? uuidToNs[n._id.toString()] : n.fallbackNs;
      return {
        ns: resolvedNs || 'Unknown',
        total: n.total,
        shards: n.shards,
      };
    });

    // Sharded collections
    const collectionsRaw = await db.client.db('config').collection('collections')
      .find({ dropped: { $ne: true } }).toArray();

    // Jumbo chunks count
    const jumboCount = await db.client.db('config').collection('chunks')
      .countDocuments({ jumbo: true });

    // Active migrations
    const migrations = await db.client.db('config').collection('migrations')
      .countDocuments({}).catch(() => 0);

    const totalChunks = chunkDist.reduce((s, x) => s + x.chunks, 0);

    return {
      shards: (shardsRes.shards || []).map(sh => {
        const cd = chunkDist.find(c => c._id === sh._id);
        return {
          id:     sh._id,
          host:   sh.host,
          state:  sh.state,
          chunks: cd?.chunks || 0,
          chunkPct: totalChunks ? Math.round((cd?.chunks || 0) / totalChunks * 100) : 0,
        };
      }),
      balancer: {
        mode:           balancerRes.mode,
        inBalancerRound: balancerRes.inBalancerRound,
        numBalancerRounds: balancerRes.numBalancerRounds || 0,
      },
      totalChunks,
      jumboChunks: jumboCount,
      activeMigrations: migrations,
      collections: collectionsRaw.map(c => ({
        ns:       c._id,
        key:      JSON.stringify(c.key),
        unique:   c.unique,
        noBalance: c.noBalance,
      })),
      nsDist,
    };

  } catch (e) {
    return null;
  }
}

// ─── OPLOG INFO (for RS members) ─────────────────────────────────────────────
async function collectOplog(db) {
  try {
    const r = await db.admin().command({ replSetGetStatus: 1 });
    if (!r.ok) return null;

    const stats = await db.db('local').collection('oplog.rs').stats();
    const first = await db.db('local').collection('oplog.rs')
      .findOne({}, { sort: { $natural: 1 }, projection: { ts: 1 } });
    const last = await db.db('local').collection('oplog.rs')
      .findOne({}, { sort: { $natural: -1 }, projection: { ts: 1 } });

    const windowSec = first && last
      ? last.ts.getHighBits() - first.ts.getHighBits()
      : 0;

    return {
      sizeMB:    Math.round((stats.size || 0) / 1024 / 1024),
      maxSizeMB: Math.round((stats.maxSize || 0) / 1024 / 1024),
      usedPct:   stats.maxSize ? Math.round(stats.size / stats.maxSize * 100) : 0,
      windowHr:  Math.round(windowSec / 3600 * 10) / 10,
      first:     first?.ts?.getHighBits() ? new Date(first.ts.getHighBits() * 1000) : null,
      last:      last?.ts?.getHighBits()  ? new Date(last.ts.getHighBits()  * 1000) : null,
    };
  } catch (_) {
    return null;
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function optimizationHint(entry) {
  const plan = entry.planSummary || '';
  const ke = entry.keysExamined || 0;
  const de = entry.docsExamined || 0;
  const nr = entry.nreturned    || 0;
  const ms = entry.millis       || 0;

  if (plan.includes('COLLSCAN'))
    return `⚠ Add index on ${entry.ns} — full collection scan detected`;
  if (plan.includes('SORT') && !plan.includes('IXSCAN'))
    return '⚠ Add sort field to compound index (ESR rule: Equality→Sort→Range)';
  if (plan.includes('$lookup'))
    return '⚡ Consider Computed Pattern — pre-store join result on write';
  if (de > 0 && nr > 0 && de / nr > 100)
    return `⚡ Index selectivity low — ${de} docs scanned for ${nr} returned`;
  if (ke > 0 && nr > 0 && ke / nr > 10)
    return '⚡ Add covered query — project only indexed fields and exclude _id';
  if (ms > 5000)
    return '🔴 Critical — query >5s, investigate immediately';
  if (ms > 1000)
    return '🟠 Slow — add compound index or reduce result set';
  return '✅ No immediate action needed';
}

// ─── RS STATUS VIA MONGOS (for nodes without direct connection) ───────────────
// shardId  = config.shards._id  (e.g. 'shard1')
// rsName   = replica-set name   (e.g. 'rs-shard1', 'rs-config')
// Returns a synthetic RS status built from what mongos knows.
async function collectRSStatusDirect(db, shardId, rsName) {
  try {
    // ── CONFIG RS: try replSetGetStatus directly on mongos (works only on configsvr) ──
    if (rsName && rsName.toLowerCase().includes('config')) {
      try {
        const r = await db.command({ replSetGetStatus: 1 });
        if (r.set === rsName || r.set === shardId) return _parseRsStatus(r);
      } catch (_) {}
    }

    // ── SHARD RS: query config.shards by _id (shardId like 'shard1') ──
    // Also try a secondary lookup by rsName embedded in the host string.
    const configDb  = db.db('config');
    let shardDoc = await configDb.collection('shards')
      .findOne({ _id: shardId })
      .catch(() => null);

    // Fallback: match by host string containing rsName (handles mismatched IDs)
    if (!shardDoc && rsName) {
      shardDoc = await configDb.collection('shards')
        .findOne({ host: { $regex: `^${rsName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/` } })
        .catch(() => null);
    }

    if (!shardDoc) return null;

    // host field: "rs-shard1/host1:port1,host2:port2"
    const hostStr   = shardDoc.host || '';
    const hostsStr  = hostStr.includes('/') ? hostStr.split('/')[1] : hostStr;
    const resolvedRS = hostStr.includes('/') ? hostStr.split('/')[0] : rsName;
    const hosts     = hostsStr.split(',').filter(Boolean);

    // Build synthetic RS status — health=1 if shard.state===1 in mongos
    const memberHealthy = shardDoc.state === 1 ? 1 : 0;
    return {
      setName:    resolvedRS || rsName,
      myState:    null,
      myStateStr: 'N/A (via mongos)',
      members:    hosts.map((hp, i) => ({
        id:       i,
        name:     hp.trim(),
        health:   memberHealthy,
        state:    null,
        stateStr: 'UNKNOWN',
        lagSec:   0,
        pingMs:   0,
        self:     false,
      })),
      shardState: shardDoc.state,
      fromMongos: true,
    };
  } catch (e) {
    return null;
  }
}


function _parseRsStatus(r) {
  const self    = r.members?.find(m => m.self);
  const primary = r.members?.find(m => m.stateStr === 'PRIMARY');
  return {
    setName:    r.set,
    myState:    r.myState,
    myStateStr: r.myStateStr || self?.stateStr || 'UNKNOWN',
    term:       r.term,
    ok:         r.ok,
    members: (r.members || []).map(m => {
      let lagSec = 0;
      const isValidOptime = m.optimeDate && m.optimeDate.getTime() > 946684800000;
      const isPrimaryValid = primary?.optimeDate?.getTime() > 946684800000;

      if (primary && m.stateStr !== 'PRIMARY' && m.stateStr !== 'ARBITER' && isValidOptime && isPrimaryValid) {
        lagSec = (primary.optimeDate - m.optimeDate) / 1000;
      }
      return {
        id:        m._id,
        name:      m.name,
        health:    m.health,
        state:     m.state,
        stateStr:  m.stateStr,
        uptime:    m.uptime,
        optime:    m.optimeDate,
        lagSec:    Math.max(0, Math.round(lagSec * 100) / 100),
        pingMs:    m.pingMs || 0,
        votes:     m.votes,
        priority:  m.priority,
        self:      !!m.self,
      };
    }),
  };
}

module.exports = {
  collectServerStatus,
  collectReplStatus,
  collectRSConfig,
  collectHealth,
  collectProfiler,
  collectCurrentOp,
  collectShardStatus,
  collectOplog,
  collectRSStatusDirect,
  parseRsStatus: _parseRsStatus,
};
