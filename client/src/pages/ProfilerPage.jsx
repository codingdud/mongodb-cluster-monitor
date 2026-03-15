import { useState, useEffect, useMemo, useRef } from 'react';
import { useCluster } from '../store/useCluster';
import { fetchProfiler } from '../api/api';
import styles from './ProfilerPage.module.css';

// Standalone Virtualized Table Component for Performance
const VirtualizedTable = ({ items, itemHeight = 44, children, header, overscan = 3, maxHeight = 'calc(100vh - 300px)' }) => {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const onScroll = (e) => setScrollTop(e.target.scrollTop);

  const totalHeight = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(items.length, Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan);

  const visibleItems = useMemo(() => {
    return items.slice(startIndex, endIndex).map((item, idx) => ({
      item,
      index: startIndex + idx,
      top: (startIndex + idx) * itemHeight
    }));
  }, [items, startIndex, endIndex, itemHeight]);

  return (
    <div 
      className={styles.virtualViewport} 
      ref={containerRef} 
      onScroll={onScroll}
      style={{ maxHeight, height: items.length > 0 ? 'auto' : 0 }}
    >
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg2)', width: '100%' }}>
        <table className={styles.virtualTable} style={{ width: '100%', tableLayout: 'fixed', margin: 0 }}>
          <thead>{header}</thead>
        </table>
      </div>
      <div style={{ height: totalHeight, position: 'relative', width: '100%' }}>
        {visibleItems.map(({ item, index, top }) => (
          <div 
            key={index} 
            className={`${styles.virtualRow} ${item.secs_running > 5 || item.millis > 2000 ? styles.rowCritical : ''}`}
            style={{ 
              position: 'absolute', top, left: 0, width: '100%', height: itemHeight,
              display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)'
            }}
          >
             {children(item, index)}
          </div>
        ))}
      </div>
    </div>
  );
};

export default function ProfilerPage() {
  const { state, profilerMinMs, profilerNodeId, profilerOp, profilerTab } = useCluster();
  const [apiData, setApiData]     = useState(null);
  const [loading, setLoading]     = useState(true);

  const ROW_HEIGHT = 44; // Approx height for profiler rows

  // Fetch from REST API when SSE state updates
  useEffect(() => {
    fetchProfiler()
      .then(data => {
        setApiData(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [state]);

  // Merge SSE entries + API entries
  const allEntries = useMemo(() => {
    const sseEntries = state?.nodes
      ?.filter(n => n.profiler?.entries?.length > 0)
      ?.flatMap(n => (n.profiler.entries || []).map(e => ({ ...e, nodeId: n.id, rsName: n.rsName }))) || [];
    
    const apiEntries = (apiData?.entries || []);
    // Normalize TS for comparison
    const getEntryKey = (e) => {
      const ts = e.ts ? (typeof e.ts === 'string' ? e.ts : new Date(e.ts).toISOString()) : '';
      return `${e.nodeId}|${ts}|${e.ns}|${e.millis}`;
    };

    const seen = new Set(apiEntries.map(getEntryKey));
    const merged = [
      ...apiEntries,
      ...sseEntries.filter(e => !seen.has(getEntryKey(e))),
    ];
    return merged.sort((a, b) => {
      const da = a.ts ? new Date(a.ts).getTime() : 0;
      const db = b.ts ? new Date(b.ts).getTime() : 0;
      return db - da; // Sort by timestamp descend
    });
  }, [apiData, state]);

  const filtered = useMemo(() => allEntries.filter(e => {
    if (profilerNodeId !== 'all' && e.nodeId !== profilerNodeId) return false;
    if (profilerMinMs > 0 && e.millis < profilerMinMs) return false;
    if (profilerOp !== 'all' && e.op !== profilerOp) return false;
    return true;
  }), [allEntries, profilerNodeId, profilerMinMs, profilerOp]);

  const collscanCount = allEntries.filter(e => (e.planSummary || '').includes('COLLSCAN')).length;

  const activeOps = useMemo(() => {
    const all = state?.nodes
      ?.filter(n => n.profiler?.activeOps?.length > 0)
      ?.flatMap(n => (n.profiler.activeOps || []).map(o => ({ ...o, nodeId: n.id }))) || [];
    
    return all.filter(o => {
      if (profilerNodeId !== 'all' && o.nodeId !== profilerNodeId) return false;
      if (profilerOp !== 'all' && o.op !== profilerOp) return false;
      if (profilerMinMs > 0 && o.millis < profilerMinMs) return false;
      return true;
    });
  }, [state, profilerNodeId, profilerOp, profilerMinMs]);


  // Collection status for ALL relevant nodes
  const nodeStatus = useMemo(() => {
    if (!state?.nodes) return [];
    return state.nodes
      .filter(n => (n.isPrimary || n.rsType === 'router') && n.online)
      .map(n => ({
        id: n.id,
        isPrimary: n.isPrimary,
        isRouter: n.rsType === 'router',
        profiler: n.profiler,
      }));
  }, [state]);

  if (loading && !allEntries.length && !activeOps.length) {
    return (
      <div className="empty-state">
        <div className="spinner" style={{marginBottom:12}} />
        <br/>Loading real-time profiler data…
      </div>
    );
  }

  return (
    <div>
      <div className={styles.headerRow}>
        <h2 style={{margin:0, fontSize:20}}>Operation Profiler</h2>
        <div className={styles.stats}>
          <span className={styles.statChip}><b>{allEntries.length}</b> total events</span>
          <span className={styles.statChip}><b style={{color:'var(--red)'}}>{collscanCount}</b> COLLSCAN</span>
          <span className={styles.statChip} title="Minimum duration filter active">Threshold: <b>{profilerMinMs}ms</b></span>
        </div>
      </div>

      {/* Node status badges */}
      <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:20, opacity:0.8}}>
        {nodeStatus.map(n => (
          <div key={n.id} style={{
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: '6px', padding: '4px 10px', fontSize: 11,
            display: 'flex', alignItems: 'center', gap: 6
          }}>
            <span style={{fontFamily:'var(--mono)', color:'var(--text2)'}}>{n.id}</span>
            {n.isPrimary || n.isRouter ? (
              n.profiler ? (
                n.profiler.enabled ? (
                  <span style={{color:'var(--green)', display:'flex', alignItems:'center', gap:4}}>
                    <span style={{fontSize:14}}>●</span> ON
                  </span>
                ) : (
                  <span style={{color: n.profiler.error ? 'var(--red)' : 'var(--amber)', display:'flex', alignItems:'center', gap:4, fontSize:10}}>
                    {n.profiler.error ? (
                      <span title={n.profiler.error}>⚠ ERR: {n.profiler.error.substring(0, 15)}...</span>
                    ) : (
                      <><span className="spinner-mini"></span> enabling…</>
                    )}
                  </span>
                )
              ) : (
                <span style={{color:'var(--text3)'}}>waiting…</span>
              )
            ) : (
              <span style={{color:'var(--text3)', fontSize:10, opacity:0.7, fontStyle:'italic'}}>Secondary</span>
            )}
          </div>
        ))}
      </div>

      {/* Active Operations Section */}
      {profilerTab === 'active' && (
        <section style={{marginBottom:30}}>
          <div className={styles.sectionHeading} style={{color:'var(--blue)', display:'flex', alignItems:'center', gap:10}}>
             <span style={{fontSize:16}}>⚡</span> Active Operations ({activeOps.length})
          </div>
          
          {activeOps.length === 0 ? (
            <div className="empty-state" style={{border:'1px dashed var(--border)', background:'transparent'}}>
              No active operations currently match your filters.
            </div>
          ) : (
            <VirtualizedTable 
              items={activeOps} 
              itemHeight={ROW_HEIGHT}
              header={
                <tr>
                  <th style={{width: '120px'}}>Node</th>
                  <th style={{width: '180px'}}>Namespace</th>
                  <th style={{width: '80px'}}>Op</th>
                  <th style={{width: '100px'}}>Active Time</th>
                  <th>Query Snippet</th>
                  <th style={{width: '100px'}}>Lock</th>
                </tr>
              }
            >
              {(o) => (
                <>
                  <div style={{width: '120px', padding: '0 12px'}}><span className="badge badge-purple">{o.nodeId}</span></div>
                  <div style={{width: '180px', padding: '0 12px'}} className="mono">{o.ns}</div>
                  <div style={{width: '80px', padding: '0 12px'}}><span className="badge badge-indigo">{o.op}</span></div>
                  <div style={{width: '100px', padding: '0 12px'}}>
                    <span className={`badge ${o.secs_running > 5 ? 'badge-red' : 'badge-teal'}`}>
                      {o.secs_running}s
                    </span>
                  </div>
                  <div style={{flex: 1, padding: '0 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} className="mono" title={o.query}>
                    {o.query}
                  </div>
                  <div style={{width: '100px', padding: '0 12px'}}>
                    {o.waitingForLock ? <span className="badge badge-red">WAITING</span> : <span style={{fontSize:10, color:'var(--green)'}}>GRANTED</span>}
                  </div>
                </>
              )}
            </VirtualizedTable>
          )}
        </section>
      )}

      {/* Historical Section */}
      {profilerTab === 'historical' && (
        <>
          <div className={styles.sectionHeading} style={{marginTop:30}}>
            Historical Slow Queries (Captured by Profiler)
          </div>

          {filtered.length === 0 ? (
            <div className="empty-state" style={{border:'1px dashed var(--border)', background:'transparent'}}>
              No slow queries captured yet {profilerMinMs > 0 && `(>${profilerMinMs}ms)`}.
              <p style={{fontSize:11, color:'var(--text3)', marginTop:12}}>
                The monitor automatically enables Level 1 profiling on all primary nodes.<br/>
                Slow queries will appear here as they occur.
              </p>
            </div>
          ) : (
            <VirtualizedTable 
              items={filtered} 
              itemHeight={ROW_HEIGHT}
              header={
                <tr>
                  <th style={{width: '100px'}}>Node</th>
                  <th style={{width: '150px'}}>Namespace</th>
                  <th style={{width: '80px'}}>Op</th>
                  <th style={{width: '120px'}}>Duration</th>
                  <th style={{width: '60px'}}>Keys</th>
                  <th style={{width: '60px'}}>Docs</th>
                  <th style={{width: '60px'}}>Ret</th>
                  <th style={{width: '120px'}}>Plan</th>
                  <th>Hint</th>
                </tr>
              }
            >
              {(e) => {
                const isCollscan = (e.planSummary||'').includes('COLLSCAN');
                const isSlow = e.millis > 1000;
                const isCritical = e.millis > 2000;
                return (
                  <>
                    <div style={{width: '100px', padding: '0 12px'}}><span className="badge badge-purple">{e.nodeId}</span></div>
                    <div style={{width: '150px', padding: '0 12px'}} className="mono">{e.ns}</div>
                    <div style={{width: '80px', padding: '0 12px'}}><span className="badge badge-gray">{e.op}</span></div>
                    <div style={{width: '120px', padding: '0 12px'}}>
                      <span className={`badge ${isCritical ? 'badge-red' : (isSlow ? 'badge-amber' : 'badge-green')}`}>
                        {e.millis}ms {isCritical && ' 🔥'}
                      </span>
                    </div>
                    <div style={{width: '60px', padding: '0 12px'}} className="mono">{e.keysExamined}</div>
                    <div style={{width: '60px', padding: '0 12px'}} className="mono">{e.docsExamined}</div>
                    <div style={{width: '60px', padding: '0 12px'}} className="mono">{e.nreturned}</div>
                    <div style={{width: '120px', padding: '0 12px'}}>
                      <span className={`badge ${isCollscan ? 'badge-red' : 'badge-blue'}`} style={{fontSize:9}}>{e.planSummary}</span>
                    </div>
                    <div style={{flex: 1, padding: '0 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={e.hint || '—'}>
                      {e.hint || '—'}
                    </div>
                  </>
                );
              }}
            </VirtualizedTable>
          )}
        </>
      )}
    </div>
  );
}
