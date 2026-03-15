# MongoDB Cluster Monitor

Real-time dashboard for your sharded MongoDB cluster — monitors all replica sets
(config, shard, router), workload rates, shard distribution, and query profiling.

## Getting Started with Docker

The easiest way to run the monitor is using our pre-built Docker image. It auto-discovers your cluster topology simply by connecting to the `mongos` router.

### Option 1: Docker CLI (Using `.env` file)

First, create a `.env` file in your directory:
```env
MONGOS_URI=mongodb://your-mongos-host:27017
POLL_MS=5000
```

Then run the container and pass the file:

```bash
docker run -d \
  --name mongodb-cluster-monitor \
  -p 4000:4000 \
  --env-file .env \
  akanoob/mongodb-cluster-monitor:latest
```

*Note: If connecting to a local MongoDB running on the host machine, you may need to use `host.docker.internal` in your URI instead of localhost.*

### Option 2: Docker Compose (Using `.env` file)

Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  monitor:
    image: akanoob/mongodb-cluster-monitor:latest
    container_name: mongodb-cluster-monitor
    ports:
      - "4000:4000"
    env_file:
      - .env
    # If the monitor needs to be on the same docker network as your cluster:
    # networks:
    #   - mongo-shard
    restart: unless-stopped

# networks:
#   mongo-shard:
#     external: true
```

Run it using:
```bash
docker-compose up -d
```

---

## Environment Variables

Configure the monitor's behavior by passing these environment variables to your Docker container or `.env` file:

| Variable    | Default | Description                          |
|-------------|---------|--------------------------------------|
| `MONGOS_URI` | `mongodb://localhost:27017` | **(Required)** Connection string to the `mongos` router entry point. The monitor will use this to auto-discover all other shards and config nodes. |
| `PORT`        | `4000`    | HTTP server port for the dashboard |
| `POLL_MS`     | `5000`    | Main poll interval for health and metrics (ms) |
| `PROFILER_MS` | `15000`   | Profiler poll interval (ms)          |
| `SLOW_MS`     | `100`     | Queries taking longer than this are considered "slow" (ms) |
| `LOG_LEVEL` | `INFO` | Logger verbosity (`DEBUG`, `INFO`, `WARN`, `ERROR`) |
| `NODE_OVERRIDES` | *none* | Optional mapping for docker-bridge networking (e.g. `shard1_1=host.docker.internal:27018`). Usually not required if running in the same network context. |

---

## What it monitors

| Component       | Nodes                                       | Port (host) |
|-----------------|---------------------------------------------|-------------|
| Config RS       | config1, config2, config3                   | 27019–27021 |
| Shard 1 RS      | shard1_1, shard1_2, shard1_3                | 27030–27032 |
| Shard 2 RS      | shard2_1, shard2_2, shard2_3                | 27033–27035 |
| Shard 3 RS      | shard3_1, shard3_2, shard3_3                | 27036–27038 |
| Mongos Router   | mongos                                      | 27017       |

**13 nodes total, polled every 5 seconds via direct connections.**

## Local Development

If you prefer to run the application directly from source without Docker:

```bash
# 1. Install dependencies
npm install

# 2. Copy env config
cp .env.example .env

# 3. Start the monitor
npm start

# Open in browser
open http://localhost:4000
```

## How to Activate Query Profiling (Recommended)

To see slow queries and performance hints in the **Query Profiler** tab, profiling must be enabled directly on your database shards. It is recommended to enable profiling at level 1 (slow queries only) to minimize overhead.

Run this on each **PRIMARY** shard node:

```js
// Connect to each primary via mongosh and run:
db.setProfilingLevel(1, { slowms: 100 })

// Check current profiling level:
db.getProfilingStatus()
```

**If you are using the local Docker test cluster provided by this repo, simply run:**
```bash
make enable-profiler
```

**Manual Docker example (assuming containers are named shardX_1):**
```bash
docker exec -it shard1_1 mongosh --port 27018 --eval \
  "db.setProfilingLevel(1, { slowms: 100 })"

docker exec -it shard2_1 mongosh --port 27021 --eval \
  "db.setProfilingLevel(1, { slowms: 100 })"

docker exec -it shard3_1 mongosh --port 27023 --eval \
  "db.setProfilingLevel(1, { slowms: 100 })"
```

## Dashboard Tabs

| Tab          | Shows                                                              |
|--------------|--------------------------------------------------------------------|
| Overview     | All node cards with role, ops/s sparkline, connections, lag, mem   |
| Replica Sets | Grouped RS view with per-member lag table and oplog info           |
| Shards       | Chunk distribution, balancer status, namespace distribution        |
| Query Profiler | Slow queries with plan type, scan ratio, and optimization hints  |

## Sidebar Filters

- **Type filter**: All · Config RS · Shard RS · Router
- **RS filter**: All · rs-config · rs-shard1 · rs-shard2 · rs-shard3 · mongos

Filters apply across all tabs — combine Type + RS filters for drill-down.

## API Endpoints

```
GET  /api/cluster              Full cluster snapshot
GET  /api/nodes                All nodes (filter: ?rsType=shard&rsName=rs-shard1)
GET  /api/nodes/:id            Single node detail
GET  /api/replicasets          RS groups (filter: ?rsType=config)
GET  /api/shards               Shard distribution from mongos
GET  /api/profiler             Slow queries (filter: ?nodeId=shard1_1&minMs=500)
GET  /api/events               SSE stream for real-time browser updates
```

## Project Structure

```text
mongo-monitor/
├── server.js            Express + SSE server
├── lib/                 Backend collector logic
├── client/              Vite + React frontend source
└── public/              Compiled static assets (served by Express)
```

`make --dry-run cluster-down`
