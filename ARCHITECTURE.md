# MongoDB Cluster Monitor — Architecture Deep Dive

## Table of Contents

1. [What This Application Is](#1-what-this-application-is)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Backend — The Monitoring Engine](#3-backend--the-monitoring-engine)
   - 3.1 [Entry Point & HTTP Layer](#31-entry-point--http-layer)
   - 3.2 [The MonitorEngine (Core Brain)](#32-the-monitorengine-core-brain)
   - 3.3 [Topology Auto-Discovery](#33-topology-auto-discovery)
   - 3.4 [Collectors — Talking to MongoDB](#34-collectors--talking-to-mongodb)
   - 3.5 [Polling Cycle](#35-polling-cycle)
   - 3.6 [Alert System](#36-alert-system)
   - 3.7 [Email Notifications](#37-email-notifications)
   - 3.8 [Structured Logging](#38-structured-logging)
4. [The Real-Time Data Pipeline](#4-the-real-time-data-pipeline)
5. [Frontend — The Dashboard](#5-frontend--the-dashboard)
   - 5.1 [State Management (Zustand Store)](#51-state-management-zustand-store)
   - 5.2 [Application Shell & Navigation](#52-application-shell--navigation)
   - 5.3 [Overview Page](#53-overview-page)
   - 5.4 [Replica Sets Page](#54-replica-sets-page)
   - 5.5 [Shards Page](#55-shards-page)
   - 5.6 [Profiler Page](#56-profiler-page)
   - 5.7 [Alerts Page](#57-alerts-page)
   - 5.8 [Component Hierarchy](#58-component-hierarchy)
6. [Infrastructure & Deployment](#6-infrastructure--deployment)
7. [End-to-End Data Flow Walkthrough](#7-end-to-end-data-flow-walkthrough)
8. [Key Design Decisions](#8-key-design-decisions)
9. [Environment Configuration](#9-environment-configuration)

---

## 1. What This Application Is

This is a **real-time MongoDB sharded cluster monitoring dashboard**. It connects to one or more **mongos routers**, automatically discovers every node in the cluster (config servers, shard members, routers), and continuously polls each node for health, performance, and replication data. The results are streamed to a React-based web dashboard over **Server-Sent Events (SSE)** so the browser always reflects the live state of the cluster without manual refreshing.

**What it monitors:**

| Layer | What | Examples |
|-------|------|----------|
| **Config Servers** | Config replica set members | configRS/cfg1, cfg2, cfg3 |
| **Shard Members** | Every member of every shard RS | shard1/rs1-a, rs1-b, rs1-c; shard2/... shard3/... |
| **Routers** | Mongos processes | mongos on port 27017 |

**Key capabilities:**
- Live ops/sec rates (reads, writes, commands) with historical charts
- Replication lag detection with configurable thresholds
- Node health status (online/offline detection)
- WiredTiger cache and memory utilization
- Slow query profiling across all shards
- Shard chunk distribution and balancer health
- Configurable alerting with email notifications

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     BROWSER (React SPA)                      │
│                                                              │
│  Zustand Store ← SSE EventSource ← /api/events              │
│       ↓                                                      │
│  Pages: Overview │ Replica Sets │ Shards │ Profiler │ Alerts │
└──────────────────────────────┬───────────────────────────────┘
                               │ HTTP (SSE stream + REST calls)
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                   EXPRESS.JS SERVER (Node.js)                 │
│                                                              │
│  REST API (/api/cluster, /api/nodes, /api/shards, ...)      │
│  SSE Endpoint (/api/events) — pushes updates to browsers     │
│                        ↑                                     │
│                   MonitorEngine                               │
│                   (EventEmitter)                              │
│                        │                                     │
│    ┌───────────────────┼───────────────────┐                 │
│    │                   │                   │                 │
│  Topology          Poll Cycle          Alert Engine          │
│  Discovery          (every 5s)         (checks thresholds)   │
│  (every 30s)           │                                     │
│                   Collectors                                  │
│                   (per-node queries)                          │
└─────────┬──────────────┼────────────────────┬────────────────┘
          │              │                    │
          ▼              ▼                    ▼
    ┌──────────┐  ┌──────────────┐    ┌──────────────┐
    │  mongos   │  │ Config RS    │    │ Shard RS     │
    │  Router   │  │ Members      │    │ Members      │
    └──────────┘  └──────────────┘    └──────────────┘
```

**Mental model:** Think of the backend as a "heartbeat machine" that wakes up every 5 seconds, asks every MongoDB node "how are you?", assembles the answers into a single cluster snapshot, checks for problems, and broadcasts the snapshot to all connected browsers.

---

## 3. Backend — The Monitoring Engine

### 3.1 Entry Point & HTTP Layer

**File:** `server.js`

The backend is a single **Express.js** application that serves two purposes:

1. **API Server** — Exposes REST endpoints for the frontend to fetch data and trigger actions
2. **Static File Server** — Serves the pre-built React frontend from the `/public` directory

**REST Endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/cluster` | Full cluster state snapshot |
| GET | `/api/nodes` | All nodes (filterable by rsType, rsName) |
| GET | `/api/nodes/:id` | Single node detail |
| GET | `/api/replicasets` | Nodes grouped by replica set |
| GET | `/api/shards` | Shard distribution from mongos |
| GET | `/api/profiler` | Slow queries (filterable by nodeId, minMs) |
| POST | `/api/profiler/:nodeId/enable` | Turn on profiling for a node |
| POST | `/api/alerts/config` | Update alert thresholds |
| POST | `/api/alerts/:id/archive` | Archive a specific alert |
| DELETE | `/api/alerts/archive` | Clear all archived alerts |

**SSE Endpoint:**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/events` | Server-Sent Events stream for real-time updates |

The SSE endpoint is the most important connection between backend and frontend. When a browser opens this endpoint, the server:
1. Immediately sends the current cluster state as the first message
2. Subscribes a listener to the engine's `update` event
3. Every time the engine finishes a poll cycle, the new state is pushed to the browser
4. A 30-second heartbeat (`:ping`) keeps the connection alive through proxies/load balancers

The server also acts as a **SPA (Single Page Application) host**: any route that doesn't match `/api/*` returns `index.html`, allowing React Router to handle client-side navigation.

---

### 3.2 The MonitorEngine (Core Brain)

**File:** `lib/engine.js`

The MonitorEngine is the **central nervous system** of the application. It extends Node.js's `EventEmitter`, which means other parts of the system (like the SSE endpoint) can subscribe to its events.

**Mental model:** The engine is a state machine that runs three concurrent loops:

```
Loop 1: Topology Discovery (every 30s)
   "Who exists in this cluster?"
   → Queries mongos to find all nodes

Loop 2: Health Polling (every 5s, configurable via POLL_MS)
   "How is each node doing right now?"
   → Queries every discovered node in parallel
   → Builds snapshots, computes rates, checks alerts
   → Emits 'update' event

Loop 3: Profiler Collection (every 15s, configurable via PROFILER_MS)
   "Any slow queries recently?"
   → Queries system.profile on each shard
```

**Key data structures the engine maintains:**

| Property | What It Holds |
|----------|---------------|
| `mongosClients` | Array of MongoClient connections to mongos routers |
| `nodeClients` | Map of nodeId → MongoClient for direct connections |
| `topology` | Discovered cluster nodes (config, shard, router types) |
| `snapshots` | Map of nodeId → latest health/performance snapshot |
| `history` | Map of nodeId → rolling array of 500 opcounter samples |
| `alerts` | Array of active alert objects |
| `archivedAlerts` | Array of resolved/archived alerts |
| `alertConfig` | Thresholds and notification preferences |

---

### 3.3 Topology Auto-Discovery

One of the most important capabilities is **automatic cluster discovery**. You only give the application a mongos URI — it figures out the rest.

**How discovery works:**

```
Step 1: Connect to mongos
   ↓
Step 2: Run "getCmdLineOpts" command
   → Extracts the configDB connection string
   → Parses it to find config RS members (e.g., configRS/cfg1:27019,cfg2:27019,cfg3:27019)
   → Creates node entries with rsType="config"
   ↓
Step 3: Run "listShards" command
   → Returns each shard's host string (e.g., "shard1RS/shard1a:27018,shard1b:27018,shard1c:27018")
   → Parses each to extract RS name and member addresses
   → Creates node entries with rsType="shard"
   ↓
Step 4: Add the mongos router itself as rsType="router"
   ↓
Step 5: For each discovered node, attempt a direct MongoClient connection
   → Uses NODE_OVERRIDES env var for Docker port mapping
   → Falls back to polling via mongos if direct connection fails
```

**Why direct connections matter:** Querying a node directly gives much richer data (serverStatus, replSetGetStatus, oplog stats) than querying it indirectly through mongos. The engine always prefers direct connections but gracefully falls back to mongos-routed queries.

**Re-discovery runs every 30 seconds** so the monitor detects topology changes — new shards added, members removed, failovers.

---

### 3.4 Collectors — Talking to MongoDB

**File:** `lib/collectors.js`

Collectors are **pure data-extraction functions**. Each one takes a database or client handle and runs specific MongoDB admin commands to extract structured data. They are the "sensors" of the monitoring system.

| Collector | MongoDB Command | What It Returns |
|-----------|----------------|-----------------|
| `collectServerStatus` | `db.admin().serverStatus()` | CPU, memory, connections, opcounters (insert/query/update/delete/command), WiredTiger cache stats, network bytes, cursor counts |
| `collectReplStatus` | `replSetGetStatus` | Replica set member list with state (PRIMARY/SECONDARY/ARBITER), health, replication lag, ping times, sync sources, optimes |
| `collectRSConfig` | `replSetGetConfig` | Replica set configuration: member priorities, votes, hidden flag, arbiter status, replication delay settings |
| `collectHealth` | `hello` command | Node identity (isWritablePrimary, hosts list, RS name), BSON limits, session timeout, connection ID |
| `collectCurrentOp` | `currentOp` | Active operations currently running on the node |
| `collectProfiler` | `system.profile` query | Slow queries above threshold with execution stats, namespace, duration, plan summary |
| `collectShardStatus` | `listShards` + config queries | Shard list, chunk distribution per namespace, balancer state, active migrations, jumbo chunks |
| `collectOplog` | `oplog.rs` stats | Oplog size, max size, first/last entry timestamps, retention window |
| `collectRSStatusDirect` | Config DB queries | Synthetic RS status built from config server data (fallback path) |

**Optimization hints:** The profiler collector also runs an `optimizationHint()` function that analyzes slow queries and produces recommendations — for example, flagging COLLSCAN (full collection scans) and suggesting index creation.

---

### 3.5 Polling Cycle

The polling cycle is the heartbeat of the system. Here's what happens every 5 seconds:

```
1. _pollAll() is invoked by the polling interval

2. For each node in topology (in parallel):
   │
   ├─ Build a "base" snapshot (nodeId, address, rsType, rsName)
   │
   ├─ IF direct connection exists:
   │     → _pollNodeDirect()
   │     → Run collectors: serverStatus, replStatus, rsConfig, health, oplog
   │     → Compute ops/sec rate by comparing current opcounters with previous snapshot
   │     → Push to rolling history buffer (max 500 samples)
   │
   └─ ELSE (no direct connection):
         → _pollNodeViaMongos()
         → Limited data: basic health via mongos, synthetic RS status
         → Mark as "viaRouter" so the UI knows data is limited

3. After all nodes polled:
   → _crossVerifyHealth() — cross-reference health from multiple sources
   → _checkAlerts() — evaluate all alert thresholds
   → _emitUpdate() — broadcast new state to all SSE listeners
```

**Ops rate calculation:** The engine doesn't just report raw opcounter values (which are cumulative since server start). Instead, it computes the **delta** between the current and previous poll, divides by the time elapsed, and produces a per-second rate. This gives you "100 queries/sec right now" instead of "5 million queries since startup."

**History buffer:** Each node maintains a rolling buffer of 500 ops-rate samples. At 5-second intervals, that's ~42 minutes of trend data. This history powers the SparkLine charts and the cluster-wide OpsAreaChart.

---

### 3.6 Alert System

The alert engine evaluates conditions after every poll cycle. It's a **threshold-based** system with three severity levels:

| Severity | Color | Conditions |
|----------|-------|------------|
| **Critical** | Red | Node down (unreachable), replication lag exceeds threshold, cluster degraded |
| **Warning** | Amber | Ops rate exceeds limit, jumbo chunks detected, balancer issues |
| **Info** | Blue | Informational events |

**Alert lifecycle:**
```
Condition detected → Alert created (active)
                         ↓
              User clicks "Archive" → Alert moves to archived list
                                         ↓
                              User clicks "Clear All" → Permanently deleted
```

**Deduplication:** The engine tracks a `sentAlerts` set to avoid generating the same alert repeatedly. For example, if node `shard1a` is down, it generates one "Node Down" alert and won't create another for the same node until it recovers and goes down again.

**Configurable thresholds:**
- Replication lag threshold (milliseconds) — default: 10,000ms
- Cluster ops limit (operations/second) — default: 2,000 ops/s
- Email notifications on/off
- Recipient email addresses

---

### 3.7 Email Notifications

**File:** `lib/notifier.js`

When a **critical** alert fires and email is enabled in the alert config, the notifier sends a formatted HTML email via SMTP.

**Mental model:** The notifier is a simple "fire and forget" module. It doesn't queue or retry — it makes a best-effort SMTP send. If SMTP is not configured (no `SMTP_HOST` env var), it logs the alert to console instead.

The email includes:
- Alert severity and title
- Detailed message (which node, what went wrong)
- Timestamp
- A styled HTML template for readability in email clients

---

### 3.8 Structured Logging

**File:** `lib/logger.js`

A lightweight custom logger with four levels: DEBUG, INFO, WARN, ERROR. Each log line is:
- Timestamped (ISO format)
- Color-coded for terminal readability (gray/green/yellow/red)
- Filterable via the `LOG_LEVEL` environment variable

Used throughout the backend for connection lifecycle events, polling errors, alert triggers, and topology discovery progress.

---

## 4. The Real-Time Data Pipeline

This is the most important architectural concept to understand. The entire system is built around a **push-based real-time pipeline**:

```
MongoDB Nodes (data source)
        │
        │  MongoDB protocol (admin commands)
        ▼
   Collectors (extract & normalize data)
        │
        ▼
   MonitorEngine (assemble snapshots, compute rates, check alerts)
        │
        │  Node.js EventEmitter: engine.emit('update', clusterState)
        ▼
   Express SSE Handler (serialize to JSON, write to HTTP stream)
        │
        │  HTTP/1.1 chunked transfer, text/event-stream
        ▼
   Browser EventSource API (parse SSE messages)
        │
        ▼
   Zustand Store (update React state)
        │
        │  React re-render cycle
        ▼
   Dashboard UI (charts, cards, tables update)
```

**Why SSE instead of WebSockets?**
- SSE is simpler — it's just an HTTP GET that stays open
- The data flow is **unidirectional** (server → browser only), which is exactly what monitoring needs
- Built-in browser reconnection (EventSource auto-reconnects on disconnect)
- Works through HTTP proxies and load balancers without special configuration
- The few browser→server actions (archive alert, change config) use regular REST POST calls

**Why not polling from the frontend?**
- Polling would mean each browser makes requests every few seconds, wasting bandwidth
- With SSE, the server pushes data only when new data exists
- Multiple browser tabs share the same data flow pattern efficiently

---

## 5. Frontend — The Dashboard

### 5.1 State Management (Zustand Store)

**File:** `client/src/store/useCluster.js`

The frontend uses **Zustand** — a minimalist React state management library. Everything lives in a single store:

**Core state:**
```
{
  state: {                    ← The cluster snapshot (nodes, summary, replicaSets)
    nodes: [...],             ← Array of every node's current data
    summary: {...},           ← Computed KPIs (total ops, max lag, etc.)
    replicaSets: {...}        ← Nodes grouped by replica set name
  },
  connected: true/false,      ← Is the SSE connection alive?
  lastUpdate: timestamp,       ← When the last update arrived
  alerts: [...],               ← Active alerts
  archivedAlerts: [...],       ← Archived alerts
  alertConfig: {...},          ← Alert thresholds
  selectedNode: null | node,   ← Currently expanded node (for drawer)
  
  // UI filter state:
  activeTab: 'overview',
  activeType: 'all',           ← Node type filter (all/config/shard/router)
  activeRS: 'all',             ← Replica set name filter
  profilerMinMs: 100,          ← Profiler minimum duration filter
  panelCollapsed: false         ← Sidebar panel collapse state
}
```

**SSE connection lifecycle:**
```
App mounts → connect() called
  → new EventSource('/api/events')
  → onmessage: parse JSON, update state + alerts
  → onerror: set connected=false, retry in 3 seconds
  
App unmounts → disconnect() called
  → close EventSource, clear retry timer
```

**Derived data:** The store provides `filteredNodes()` and `filteredRS()` methods that apply the current UI filters (activeType, activeRS) to the raw state, so components always get pre-filtered data.

---

### 5.2 Application Shell & Navigation

**Files:** `client/src/App.jsx`, `client/src/components/Layout.jsx`

The application uses **React Router** for client-side navigation with five routes:

| Path | Page | Purpose |
|------|------|---------|
| `/` | OverviewPage | Main dashboard — all nodes, KPIs, ops chart |
| `/replicasets` | ReplicaSetsPage | Per-replica-set member status and config |
| `/shards` | ShardsPage | Chunk distribution, balancer health |
| `/profiler` | ProfilerPage | Slow query analysis |
| `/alerts` | AlertsPage | Alert management and configuration |

**Layout structure:**
```
┌─────────────────────────────────────────────────────────┐
│ TOPBAR                                                  │
│ [Logo] ClusterMonitor    Stats    [Alert Bell] [Status] │
├──────┬──────────────────────────────────────────────────┤
│      │                                                  │
│  S   │                                                  │
│  I   │              PAGE CONTENT                        │
│  D   │                                                  │
│  E   │        (Overview / ReplicaSets / Shards          │
│  B   │         / Profiler / Alerts)                     │
│  A   │                                                  │
│  R   │                                                  │
│      │                                                  │
├──────┤                                                  │
│Filter│                                                  │
│Panel │                                                  │
└──────┴──────────────────────────────────────────────────┘
```

**Topbar** shows:
- MongoDB branding
- Live cluster stats: online nodes / total nodes, aggregate ops/sec, total connections
- Alert bell with badge count (links to alerts page)
- Connection status indicator (green "Live" dot or red "Disconnected")

**Sidebar** has two sections:
- **Rail navigation** — Icon links to each page
- **Contextual filter panel** — Changes based on which page you're viewing:
  - Overview: Node type filter + replica set filter
  - ReplicaSets: Set type filter + active RS filter
  - Profiler: Min duration, node filter, operation type filter
  - Alerts: Severity filter (all/critical/warning/info)

---

### 5.3 Overview Page

The landing page gives a full cluster health overview at a glance.

**Layout (top to bottom):**

1. **SummaryBar** — Six KPI cards:
   - Cluster Status (HEALTHY / DEGRADED based on whether all nodes are up)
   - Total Ops/s (sum across all nodes)
   - Active Connections
   - Max Replication Lag (color coded: green < 5s, amber < 30s, red ≥ 30s)
   - Slow Queries (from profiler)
   - Nodes Down

2. **OpsAreaChart** — Cluster-wide operations/second over time:
   - Stacked area chart with three series: Reads (blue), Writes (green), Commands (orange)
   - Time range presets: 1m, 5m, 15m, All
   - A "Live" button that locks the view to the latest data
   - A brush/scrubber control for scrolling through history
   - Built by aggregating all nodes' history into 5-second-wide time buckets

3. **Node Cards Grid** — One card per node (filtered by sidebar):
   - Each card shows: node type icon, ID, address, role (PRIMARY/SECONDARY/ARBITER/MONGOS), ops sparkline, connection count, memory usage, WiredTiger cache, uptime, and version
   - Offline nodes show "OFFLINE" with last-seen timestamp
   - Clicking a card opens the **NodeDrawer**

4. **NodeDrawer** — A slide-out right panel with full node detail:
   - Ops trend sparkline
   - Ops breakdown (insert, query, update, delete, command counts)
   - Full serverStatus metrics (12+ fields)
   - Replica set member table (state, health, lag, ping)
   - RS config table (priority, votes, hidden, arbiter flags)
   - Hello/health check results
   - Oplog statistics (size, retention window)

---

### 5.4 Replica Sets Page

Groups nodes by replica set and shows per-set health.

**For each replica set:**
- **Collapsible header:** RS type badge (Config/Shard), RS name, health ratio (e.g., "3/3 healthy"), member count
- **Node cards grid** — Same cards as Overview but scoped to this RS
- **rs.status() member table** — Columns: Member, State, Health, Replication Lag, Ping, Sync Source, Votes, Uptime
  - Lag is color-coded: green (< 5s), amber (< 30s), red (≥ 30s)
  - Only shown when primary node data is available

Sidebar filters let you narrow by RS type (config vs shard) and specific set name.

---

### 5.5 Shards Page

Visualizes shard data distribution and balancer health. Data comes from mongos node.

**Sections:**

1. **Summary grid** (5 cards): Shard count, total chunks, jumbo chunks (yellow warning if > 0), active migrations, balancer status (green/red)

2. **Chunk distribution bar chart** — One bar per shard showing chunk count, with percentage labels on top

3. **Shard cards** — Per shard: ID, host string, chunk count, percentage bar, active/inactive indicator

4. **Namespace distribution table** — Top 10 most-chunked namespaces, with per-shard breakdown and balance percentage (color-coded to show skew)

5. **Sharded collections table** — Namespace, shard key, uniqueness flag, auto-balance status

---

### 5.6 Profiler Page

Surfaces slow queries captured by MongoDB's built-in profiler across all shards.

**Features:**
- Filterable by: minimum duration (ms), specific node, operation type (query/insert/update/delete/command)
- Each slow query entry shows: namespace, operation, duration, plan summary, timestamp
- Includes **optimization hints** — automated recommendations like "COLLSCAN detected — consider adding an index"
- Profiling can be enabled/disabled per node via the UI (POST to `/api/profiler/:nodeId/enable`)

**Data flow:** The engine runs a dedicated profiler poll (every 15s by default) that queries `system.profile` on each shard, collects entries above the `SLOW_MS` threshold, and includes them in the SSE broadcast.

---

### 5.7 Alerts Page

Real-time alert management dashboard.

**Tabs:**
- **Active Issues** — Currently firing alerts with red badge count
- **Archive History** — Previously acknowledged alerts

**Per alert card:**
- Severity icon (✕ critical / ⚠ warning / ℹ info)
- Title and detailed message
- Timestamp
- Affected node (if applicable)
- "Archive" button (active tab) or "Archived at" date (archive tab)

**Alert config form** (toggle open via gear button):
- Replication lag threshold (ms)
- Cluster ops limit (ops/s)
- Email notifications toggle
- Recipient list with add/remove tags
- Save/Cancel

Changes to the config are sent to the backend via `POST /api/alerts/config`, which immediately updates the engine's threshold evaluation.

---

### 5.8 Component Hierarchy

```
App
 └─ Layout
     ├─ Topbar (stats, alert bell, connection status)
     ├─ Sidebar (navigation rail + filter panel)
     └─ Page Content (via React Router)
         │
         ├─ OverviewPage
         │    ├─ SummaryBar (6 KPI cards)
         │    ├─ OpsAreaChart (cluster-wide time series)
         │    ├─ NodeCard[] (filterable grid)
         │    └─ NodeDrawer (slide-out detail panel)
         │
         ├─ ReplicaSetsPage
         │    └─ RSSection[] (per replica set)
         │         ├─ NodeCard[]
         │         └─ Member status table
         │
         ├─ ShardsPage
         │    ├─ Summary cards
         │    ├─ ShardBarChart
         │    ├─ Shard cards
         │    ├─ Namespace table
         │    └─ Collections table
         │
         ├─ ProfilerPage
         │    └─ Slow query list with filters
         │
         └─ AlertsPage
              ├─ Alert cards (active + archive tabs)
              └─ Config form
```

**Charting library:** All visualizations use **Recharts** (a React wrapper around D3):
- **SparkLine** — Tiny inline line chart in NodeCards (ops trend)
- **OpsAreaChart** — Full-width stacked area chart with brush control
- **ShardBarChart** — Chunk distribution bar chart

---

## 6. Infrastructure & Deployment

### Docker Multi-Stage Build

The `Dockerfile` uses a two-stage build for an optimized production image:

```
Stage 1: "Builder" (node:20-slim)
  ├─ Install client npm dependencies
  ├─ Build React app with Vite
  └─ Output: static assets in /app/public

Stage 2: "Production" (node:20-alpine)
  ├─ Alpine Linux (minimal ~5MB base)
  ├─ Install ONLY backend production dependencies (no devDependencies)
  ├─ Copy server.js + lib/
  ├─ Copy built frontend from Stage 1
  └─ Run: node server.js
```

**Why multi-stage?** The builder stage has all the heavy tooling (Vite, ESLint, TypeScript types) needed to compile the React app. The production stage only has Express, the MongoDB driver, and Nodemailer — no build tools, no frontend source. This makes the final image much smaller and more secure.

### Docker Compose

The docker-compose.yml connects the monitor container to an **existing** MongoDB cluster network:

```
Monitor container (port 4001 → 4000)
    │
    │  Attached to "mongo-shard" external Docker network
    │
    ├─── mongos (port 27017)
    ├─── config servers (port 27019)
    ├─── shard1 members (port 27018)
    ├─── shard2 members (port 27018)
    └─── shard3 members (port 27018)
```

**Key point:** The monitor doesn't create MongoDB — it connects to an **already running** sharded cluster. The `mongo-shard` network must already exist with MongoDB services attached.

### Makefile

Developer convenience targets:
- `make dev` — Run backend with hot-reload
- `make build` — Build Docker image with version tag
- `make publish` — Build + push to Docker Hub (`akanoob/mongodb-cluster-monitor`)
- `make scan` — Run CVE vulnerability scans against the image
- `make bump-patch` / `bump-minor` — Semantic version bumping

---

## 7. End-to-End Data Flow Walkthrough

Here's the complete journey of a single data point — say, a shard node's current ops/sec — from MongoDB to the user's screen:

```
1. MongoDB shard1a is processing 150 queries/sec
        │
2. MonitorEngine._pollAll() fires (every 5 seconds)
        │
3. _pollNodeDirect("shard1a") runs:
   → collectors.collectServerStatus(db) 
   → MongoDB returns opcounters: { query: 5000042 }
        │
4. Engine computes delta:
   → Previous snapshot had query: 5000032
   → Delta = 10 queries in ~5 seconds → ~2 queries/sec  
   → (plus other ops: insert, update, delete, command)
        │
5. Engine stores updated snapshot in snapshots["shard1a"]
   → Pushes { ts, query: 2, insert: 0, command: 1 } to history["shard1a"]
        │
6. _checkAlerts() evaluates:
   → Is total cluster ops > threshold? → No alert
   → Is any rs member lagging > threshold? → No alert
        │
7. _emitUpdate() fires:
   → engine.emit('update', { nodes: [...], summary: {...}, replicaSets: {...}, alerts: [...] })
        │
8. Express SSE handler receives event:
   → res.write(`data: ${JSON.stringify(clusterState)}\n\n`)
   → Bytes flow through HTTP chunked transfer to browser
        │
9. Browser EventSource receives message:
   → onmessage callback fires
   → JSON.parse(event.data)
        │
10. Zustand store updates:
    → setState({ state: parsed.state, alerts: parsed.alerts, ... })
        │
11. React re-renders components subscribed to store:
    → SummaryBar shows updated total ops
    → NodeCard for shard1a updates its sparkline
    → OpsAreaChart adds new data point to time series
    → User sees the live update — no refresh needed
```

**Latency:** From MongoDB to screen, this typically takes < 100ms after the poll completes. The user sees updates every POLL_MS (default 5 seconds).

---

## 8. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **SSE over WebSockets** | Data flows one direction (server → client). SSE is simpler, auto-reconnects, and works through HTTP proxies. The few client → server actions use REST. |
| **Zustand over Redux** | Minimal boilerplate, no action types or reducers. Perfect for a single-store monitoring app where state shape is straightforward. |
| **Direct connections + mongos fallback** | Direct connections yield richer data (serverStatus, replSetGetStatus). Mongos-only polling is the graceful fallback when direct connections aren't possible (e.g., firewall rules in production). |
| **Multi-stage Docker build** | Keeps production image small and secure. No build tooling in the final image. |
| **Rolling history buffer (500 samples)** | Bounded memory — won't grow indefinitely. At 5s intervals, gives ~42 minutes of trend data without any database. |
| **NODE_OVERRIDES env var** | In Docker, internal MongoDB hostnames (like `shard1a:27018`) may not be reachable from the monitor container. NODE_OVERRIDES lets you map internal hostnames to accessible addresses. |
| **EventEmitter pattern** | Decouples the engine from transport. The engine doesn't know about HTTP or SSE — it just emits events. Any number of consumers (SSE handlers, loggers, future WebSocket support) can subscribe. |
| **Threshold-based alerting** | Simple, predictable, and configurable at runtime. No complex ML or anomaly detection — just clear thresholds that operators understand. |

---

## 9. Environment Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `MONGOS_URI` | *(required)* | MongoDB connection string for the mongos router(s) |
| `PORT` | 4000 | HTTP server port |
| `POLL_MS` | 5000 | Health polling interval (milliseconds) |
| `PROFILER_MS` | 15000 | Profiler collection interval (milliseconds) |
| `SLOW_MS` | 100 | Minimum query duration to capture in profiler (ms) |
| `ALERT_LAG_MS` | 10000 | Replication lag threshold for alerts (ms) |
| `ALERT_OPS_LIMIT` | 2000 | Ops/sec threshold for high-ops alerts |
| `LOG_LEVEL` | INFO | Logging verbosity (DEBUG, INFO, WARN, ERROR) |
| `NODE_OVERRIDES` | *(empty)* | JSON map of hostname remapping for Docker environments |
| `SMTP_HOST` | *(empty)* | SMTP server for email notifications |
| `SMTP_PORT` | *(empty)* | SMTP port |
| `SMTP_USER` | *(empty)* | SMTP username |
| `SMTP_PASS` | *(empty)* | SMTP password |
| `SMTP_FROM` | *(empty)* | Sender email address |

---

## Tech Stack Summary

| Layer | Technology | Version |
|-------|-----------|---------|
| **Runtime** | Node.js | 20.x |
| **Backend Framework** | Express.js | 4.18 |
| **Database Driver** | MongoDB Node.js Driver | 6.3 |
| **Email** | Nodemailer | 8.0 |
| **Frontend Framework** | React | 19.x |
| **State Management** | Zustand | 5.x |
| **Routing** | React Router | 7.x |
| **Charts** | Recharts | 3.x |
| **Build Tool** | Vite | Latest |
| **Styling** | CSS Modules | - |
| **Container** | Docker (Alpine) | - |
| **Orchestration** | Docker Compose | - |

---

*Document generated for the mongo-cluster-monitor project.*
