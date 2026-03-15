import { useState, useEffect } from 'react';
import { useCluster } from '../store/useCluster';
import ShardBarChart from '../components/ShardBarChart';
import { fetchShards } from '../api/api';
import styles from './ShardsPage.module.css';

const COLORS = ['#58a6ff', '#3fb950', '#bc8cff', '#d29922', '#39c5cf'];

export default function ShardsPage() {
  const { state } = useCluster();
  // First try: get shards from the mongos node snapshot in SSE state
  const mongocNode = state?.nodes?.find(n => n.rsType === 'router' && n.online);

  const [fetchedSd, setFetchedSd] = useState(null);
  const [loading, setLoading] = useState(false);

  // Derive data: prefer SSE snapshot from mongos, fallback to manually fetched
  const sd = mongocNode?.shards || fetchedSd;

  useEffect(() => {
    // If we have live shards data from SSE, no need to fetch manually
    if (mongocNode?.shards) return;

    let isMounted = true;

    // Using a microtask to avoid synchronous setState warning in effect body
    Promise.resolve().then(() => {
      if (isMounted) setLoading(true);
    });

    fetchShards()
      .then(data => {
        if (isMounted) {
          if (data && !data.error) setFetchedSd(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, [mongocNode?.shards]);

  // Loading if we have no data and the fetch is in progress
  const isActuallyLoading = loading && !sd;

  if (isActuallyLoading) {
    return <div className="empty-state"><div className="spinner" style={{ marginBottom: 12 }} /><br />Loading shard data…</div>;
  }

  if (!sd || !sd.shards?.length) return (
    <div className="empty-state">
      Shard data unavailable.<br />
      <span style={{ fontSize: 11, color: 'var(--text3)' }}>
        Ensure mongos is connected and the config database is accessible.
        {!mongocNode && ' Mongos node not found in cluster.'}
      </span>
    </div>
  );

  const balText = sd.balancer?.inBalancerRound ? 'MIGRATING' : (sd.balancer?.mode || 'unknown');
  const balGood = !sd.balancer?.inBalancerRound;

  const shardSummary = [
    { label: 'Shards', value: sd.shards.length },
    { label: 'Total Chunks', value: sd.totalChunks ?? '—' },
    { label: 'Jumbo Chunks', value: sd.jumboChunks ?? 0, warn: (sd.jumboChunks ?? 0) > 0 },
    { label: 'Active Migrations', value: sd.activeMigrations ?? 0, warn: (sd.activeMigrations ?? 0) > 0 },
    { label: 'Balancer', value: balText, ok: balGood },
  ];

  return (
    <div>
      {/* Mini summary */}
      <div className={styles.summaryGrid}>
        {shardSummary.map(s => (
          <div key={s.label} className={styles.card}>
            <div className={styles.cardLabel}>{s.label}</div>
            <div className={[styles.cardVal, s.warn ? 'warn' : s.ok ? 'ok' : ''].join(' ')}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      {sd.shards.some(s => s.chunks > 0) && (
        <div className={styles.chartPanel}>
          <div className={styles.chartTitle}>Chunk distribution by shard</div>
          <ShardBarChart shards={sd.shards} />
        </div>
      )}

      {/* Shard cards */}
      <div className={styles.shardGrid}>
        {sd.shards.map((sh, i) => (
          <div key={sh.id} id={`shard-${sh.id}`} className={styles.shardCard}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div className={styles.shardName}>{sh.id}</div>
              <span className={`badge ${sh.state === 1 ? 'badge-green' : 'badge-red'}`}>
                {sh.state === 1 ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className={styles.shardHost}>{sh.host}</div>
            <div className="bar-wrap" style={{ margin: '8px 0 4px' }}>
              <div className="bar-fill" style={{ width: `${sh.chunkPct || 0}%`, background: COLORS[i % COLORS.length] }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)' }}>
              <span>{sh.chunks} chunks</span><span>{sh.chunkPct ?? 0}% of total</span>
            </div>
          </div>
        ))}
      </div>

      {/* Namespace distribution */}
      {sd.nsDist?.length > 0 && (
        <>
          <div className={styles.sectionHeading}>Namespace distribution (top 10)</div>
          <div className="table-wrap" style={{ marginBottom: 20 }}>
            <table>
              <thead>
                <tr><th>Namespace</th><th>Total Chunks</th><th>Per Shard</th><th>Balance</th></tr>
              </thead>
              <tbody>
                {sd.nsDist.map(ns => {
                  const chunks = ns.shards || [];
                  const max = chunks.length ? Math.max(...chunks.map(s => s.chunks)) : 1;
                  const min = chunks.length ? Math.min(...chunks.map(s => s.chunks)) : 0;
                  const ratio = max > 0 ? Math.round(min / max * 100) : 100;
                  const bc = ratio > 80 ? 'badge-green' : ratio > 50 ? 'badge-amber' : 'badge-red';
                  return (
                    <tr key={ns.ns}>
                      <td className="mono" style={{ fontSize: 11 }}>{ns.ns}</td>
                      <td className="mono">{ns.total}</td>
                      <td>
                        {chunks.map(s => (
                          <span key={s.shard} style={{ fontFamily: 'var(--mono)', fontSize: 10, marginRight: 10 }}>
                            {s.shard}: <b>{s.chunks}</b>
                          </span>
                        ))}
                      </td>
                      <td><span className={`badge ${bc}`}>{ratio}% balanced</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Sharded collections */}
      {sd.collections?.length > 0 && (
        <>
          <div className={styles.sectionHeading}>Sharded collections ({sd.collections.length})</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Namespace</th><th>Shard Key</th><th>Unique</th><th>Auto Balance</th></tr></thead>
              <tbody>
                {sd.collections.map(c => (
                  <tr key={c.ns}>
                    <td className="mono" style={{ fontSize: 11 }}>{c.ns}</td>
                    <td className="mono" style={{ fontSize: 10 }}>{c.key}</td>
                    <td>{c.unique ? <span className="badge badge-amber">Unique</span> : '—'}</td>
                    <td>{c.noBalance
                      ? <span className="badge badge-red">Disabled</span>
                      : <span className="badge badge-green">Enabled</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!sd.nsDist?.length && !sd.collections?.length && (
        <div className="empty-state" style={{ marginTop: 16 }}>
          No sharded collections yet.<br />
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>
            Run <code style={{ fontFamily: 'var(--mono)', color: 'var(--blue)' }}>sh.enableSharding("mydb")</code> and shard a collection to see distribution data.
          </span>
        </div>
      )}
    </div>
  );
}
