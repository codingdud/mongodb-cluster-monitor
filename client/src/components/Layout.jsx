import { NavLink, useLocation } from 'react-router-dom';
import { useCluster } from '../store/useCluster';
import styles from './Layout.module.css';

const NAV = [
  { to: '/', label: 'Overview', icon: '⊞' },
  { to: '/replicasets', label: 'Replica Sets', icon: '◎' },
  { to: '/shards', label: 'Shards', icon: '⬡' },
  { to: '/profiler', label: 'Profiler', icon: '⚡' },
  { to: '/alerts', icon: '⨹', label: 'Alerts' },
];

export default function Layout({ children }) {
  const location = useLocation();
  const {
    state, connected, lastUpdate,
    activeType, setActiveType,
    activeRS, setActiveRS,
    profilerMinMs, setProfilerMinMs,
    profilerNodeId, setProfilerNodeId,
    profilerOp, setProfilerOp,
    panelCollapsed, togglePanel,
    alerts, alertSeverityFilter, setAlertSeverityFilter,
    isAlertConfigEditing, setAlertConfigEditing
  } = useCluster();

  const nodes = state?.nodes || [];
  const rsList = [...new Set(nodes.map(n => n.rsName).filter(Boolean))];

  // Helper to check if node is a primary/router for profiler filter
  const profilerNodes = nodes.filter(n => (n.isPrimary || n.rsType === 'router') && n.online);

  return (
    <div className={styles.root}>
      {/* TOPBAR */}
      <header className={styles.topbar}>
        <span className={styles.logo}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3fb950" strokeWidth="2">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
          <span style={{ marginLeft: 4, letterSpacing: '-0.02em' }}>ClusterMonitor</span>
        </span>

        {state?.summary && (
          <div className={styles.topStats}>
            <span className={state.summary.down > 0 ? styles.statBad : styles.statGood}>
              {state.summary.online}/{state.summary.totalNodes} online
            </span>
            <span className={styles.statNeutral}>{state.summary.totalOpsPerSec.toLocaleString()} ops/s</span>
            <span className={styles.statNeutral}>{state.summary.totalConnections} conns</span>
          </div>
        )}

        <div className={styles.topRight}>
          <NavLink to="/alerts" className={styles.bellBtn} title="View Alerts">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {alerts.length > 0 && (
              <span className={[
                styles.bellBadge,
                alerts.some(a => a.severity === 'critical') ? styles.bellBadgeCritical : styles.bellBadgeWarn
              ].join(' ')}>
                {alerts.length}
              </span>
            )}
          </NavLink>
          <span className={connected ? styles.liveDot : styles.deadDot} />
          <span className={styles.ts}>
            {connected ? (lastUpdate ? lastUpdate.toLocaleTimeString() : 'Connecting…') : 'Disconnected'}
          </span>
        </div>
      </header>

      <div className={styles.body}>
        {/* SIDEBAR SYSTEM */}
        <aside className={styles.sidebar}>
          {/* NAV RAIL */}
          <nav className={styles.rail}>
            <div className={styles.railTop}>
              {NAV.map(({ to, icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  title={label}
                  end={to === '/'}
                  className={({ isActive }) =>
                    [styles.railLink, isActive ? styles.railActive : ''].join(' ')
                  }
                >
                  {icon}
                </NavLink>
              ))}
            </div>
          </nav>

          {/* CONTROL PANEL */}
          <div className={[styles.panel, panelCollapsed ? styles.panelCollapsed : ''].join(' ')}>
            {/* Contextual: Overview Filters */}
            {location.pathname === '/' && (
              <>
                <div className={styles.sideSection}>
                  <div className={styles.sideLabel}>Node Type</div>
                  {[
                    { val: 'all', label: 'All Nodes', color: '#8b949e', count: nodes.length },
                    { val: 'config', label: 'Config RS', color: 'var(--purple)', count: nodes.filter(n => n.rsType === 'config').length },
                    { val: 'shard', label: 'Shard RS', color: 'var(--blue)', count: nodes.filter(n => n.rsType === 'shard').length },
                    { val: 'router', label: 'Router', color: 'var(--teal)', count: nodes.filter(n => n.rsType === 'router').length },
                  ].map(t => (
                    <button
                      key={t.val}
                      className={[styles.sideBtn, activeType === t.val ? styles.sideBtnActive : ''].join(' ')}
                      onClick={() => setActiveType(t.val)}
                    >
                      <span className={styles.dot} style={{ background: t.color, color: t.color }} />
                      {t.label}
                      <span className={styles.badge}>{t.count}</span>
                    </button>
                  ))}
                </div>

                <div className={styles.sideSection}>
                  <div className={styles.sideLabel}>Replica Sets</div>
                  <button
                    className={[styles.sideBtn, activeRS === 'all' ? styles.sideBtnActive : ''].join(' ')}
                    onClick={() => setActiveRS('all')}
                  >
                    <span className={styles.dot} style={{ background: '#8b949e', color: '#8b949e' }} />
                    All Sets
                  </button>
                  {rsList.map(rs => {
                    const type = nodes.find(n => n.rsName === rs)?.rsType;
                    const color = type === 'config' ? 'var(--purple)' : type === 'shard' ? 'var(--blue)' : 'var(--teal)';
                    return (
                      <button
                        key={rs}
                        className={[styles.sideBtn, activeRS === rs ? styles.sideBtnActive : ''].join(' ')}
                        onClick={() => setActiveRS(rs)}
                      >
                        <span className={styles.dot} style={{ background: color, color: color }} />
                        {rs}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Contextual: Replica Sets Optimized Filters */}
            {location.pathname === '/replicasets' && (
              <>
                <div className={styles.sideSection}>
                  <div className={styles.sideLabel}>Set Type</div>
                  {[
                    { val: 'all', label: 'All Sets', color: '#8b949e', count: [...new Set(nodes.filter(n => n.rsType !== 'router').map(n => n.rsName))].length },
                    { val: 'config', label: 'Config RS', color: 'var(--purple)', count: [...new Set(nodes.filter(n => n.rsType === 'config').map(n => n.rsName))].length },
                    { val: 'shard', label: 'Shard RS', color: 'var(--blue)', count: [...new Set(nodes.filter(n => n.rsType === 'shard').map(n => n.rsName))].length },
                  ].map(t => (
                    <button
                      key={t.val}
                      className={[styles.sideBtn, activeType === t.val ? styles.sideBtnActive : ''].join(' ')}
                      onClick={() => setActiveType(t.val)}
                    >
                      <span className={styles.dot} style={{ background: t.color, color: t.color }} />
                      {t.label}
                      <span className={styles.badge}>{t.count}</span>
                    </button>
                  ))}
                </div>

                <div className={styles.sideSection}>
                  <div className={styles.sideLabel}>Active Sets</div>
                  <button
                    className={[styles.sideBtn, activeRS === 'all' ? styles.sideBtnActive : ''].join(' ')}
                    onClick={() => setActiveRS('all')}
                  >
                    <span className={styles.dot} style={{ background: '#8b949e', color: '#8b949e' }} />
                    All ({rsList.length})
                  </button>
                  {rsList.map(rs => {
                    const nodesInSet = nodes.filter(n => n.rsName === rs);
                    const type = nodesInSet[0]?.rsType;
                    const color = type === 'config' ? 'var(--purple)' : 'var(--blue)';
                    if (type === 'router') return null; // Routers don't belong here
                    return (
                      <button
                        key={rs}
                        className={[styles.sideBtn, activeRS === rs ? styles.sideBtnActive : ''].join(' ')}
                        onClick={() => setActiveRS(rs)}
                      >
                        <span className={styles.dot} style={{ background: color, color: color }} />
                        {rs}
                        <span className={styles.badge}>{nodesInSet.length}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Contextual: Shards Navigation */}
            {location.pathname === '/shards' && (
              <div className={styles.sideSection}>
                <div className={styles.sideLabel}>Shard Navigation</div>

                {/* Find sharded nodes from state to get names */}
                {(() => {
                  const shardNodes = state?.nodes?.find(n => n.rsType === 'router' && n.online)?.shards?.shards || [];
                  const balancer = state?.nodes?.find(n => n.rsType === 'router' && n.online)?.shards?.balancer;

                  return (
                    <>
                      {balancer && (
                        <div style={{ padding: '0 12px 16px' }}>
                          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8, fontWeight: 500 }}>Balancer Status</div>
                          <div className={`badge ${balancer.inBalancerRound ? 'badge-amber' : 'badge-green'}`} style={{ width: '100%', textAlign: 'center', display: 'block' }}>
                            {balancer.inBalancerRound ? 'MIGRATING...' : (balancer.mode || 'Active')}
                          </div>
                        </div>
                      )}

                      {shardNodes.length > 0 ? (
                        shardNodes.map(sh => (
                          <button
                            key={sh.id}
                            className={styles.sideBtn}
                            onClick={() => {
                              const el = document.getElementById(`shard-${sh.id}`);
                              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }}
                          >
                            <span className={styles.dot} style={{ background: 'var(--blue)' }} />
                            {sh.id}
                          </button>
                        ))
                      ) : (
                        <div style={{ padding: '0 12px', fontSize: 11, color: 'var(--text3)' }}>
                          No shards detected. Cluster must be sharded and mongos online.
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {/* Contextual: Shards Navigation */}
            {location.pathname === '/shards' && (
              <div className={styles.sideSection}>
                <div className={styles.sideLabel}>Shard Navigation</div>

                {(() => {
                  const shardNodes = state?.nodes?.find(n => n.rsType === 'router' && n.online)?.shards?.shards || [];
                  const balancer = state?.nodes?.find(n => n.rsType === 'router' && n.online)?.shards?.balancer;

                  return (
                    <>
                      {balancer && (
                        <div style={{ padding: '12px', background: 'var(--bg3)', borderRadius: 8, margin: '0 12px 16px' }}>
                          <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>Balancer</div>
                          <span className={balancer.inBalancerRound ? styles.textWarn : styles.textGood} style={{ fontWeight: 600, fontSize: 12 }}>
                            {balancer.inBalancerRound ? 'Migrating Chunks...' : (balancer.mode || 'Active')}
                          </span>
                        </div>
                      )}

                      <div className={styles.sideLabel} style={{ paddingTop: 8 }}>Jump to Shard</div>
                      {shardNodes.length > 0 ? (
                        shardNodes.map(sh => (
                          <button
                            key={sh.id}
                            className={styles.sideBtn}
                            onClick={() => {
                              const el = document.getElementById(`shard-${sh.id}`);
                              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }}
                          >
                            <span className={styles.dot} style={{ background: sh.state === 1 ? 'var(--green)' : 'var(--red)' }} />
                            {sh.id}
                          </button>
                        ))
                      ) : null}
                    </>
                  );
                })()}
              </div>
            )}

            {/* Contextual: Profiler Filters */}
            {location.pathname === '/profiler' && (
              <>
                <div className={styles.sideSection}>
                  <div className={styles.sideLabel}>Query Criteria</div>

                  <div style={{ padding: '0 12px 12px' }}>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>Min Duration</div>
                    <select
                      className={styles.selectRefined}
                      style={{ width: '100%' }}
                      value={profilerMinMs}
                      onChange={(e) => setProfilerMinMs(parseInt(e.target.value))}
                    >
                      <option value={0}>All Queries</option>
                      <option value={100}>100ms+</option>
                      <option value={500}>500ms+</option>
                      <option value={1000}>1s+</option>
                    </select>

                    <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6, marginTop: 12 }}>View Mode</div>
                    <div style={{ display: 'flex', gap: 4, background: 'var(--bg2)', padding: 2, borderRadius: 6 }}>
                      <button
                        onClick={() => useCluster.getState().setProfilerTab('active')}
                        style={{
                          flex: 1, fontSize: 10, padding: '6px 2px', border: 'none', borderRadius: 4, cursor: 'pointer',
                          background: useCluster.getState().profilerTab === 'active' ? 'var(--blue)' : 'transparent',
                          color: useCluster.getState().profilerTab === 'active' ? 'white' : 'var(--text3)'
                        }}
                      >
                        Active
                      </button>
                      <button
                        onClick={() => useCluster.getState().setProfilerTab('historical')}
                        style={{
                          flex: 1, fontSize: 10, padding: '6px 2px', border: 'none', borderRadius: 4, cursor: 'pointer',
                          background: useCluster.getState().profilerTab === 'historical' ? 'var(--blue)' : 'transparent',
                          color: useCluster.getState().profilerTab === 'historical' ? 'white' : 'var(--text3)'
                        }}
                      >
                        Historical
                      </button>
                    </div>
                  </div>

                  <div style={{ padding: '0 12px' }}>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>Op Type</div>
                    <select
                      className={styles.selectRefined}
                      style={{ width: '100%' }}
                      value={profilerOp}
                      onChange={(e) => setProfilerOp(e.target.value)}
                    >
                      <option value="all">Any Operation</option>
                      <option value="query">query</option>
                      <option value="command">command</option>
                      <option value="update">update</option>
                      <option value="insert">insert</option>
                      <option value="delete">delete</option>
                      <option value="getmore">getmore</option>
                    </select>
                  </div>
                </div>

                <div className={styles.sideSection}>
                  <div className={styles.sideLabel}>Node Scope</div>
                  <button
                    className={[styles.sideBtn, profilerNodeId === 'all' ? styles.sideBtnActive : ''].join(' ')}
                    onClick={() => setProfilerNodeId('all')}
                  >
                    <span className={styles.dot} style={{ background: '#8b949e' }} />
                    All Primaries
                  </button>
                  {profilerNodes.map(n => (
                    <button
                      key={n.id}
                      className={[styles.sideBtn, profilerNodeId === n.id ? styles.sideBtnActive : ''].join(' ')}
                      onClick={() => setProfilerNodeId(n.id)}
                    >
                      <span className={styles.dot} style={{ background: n.isPrimary ? 'var(--green)' : 'var(--teal)' }} />
                      {n.id}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Contextual: Alerts Filters */}
            {location.pathname === '/alerts' && (
              <div className={styles.sideSection}>
                <div className={styles.sideLabel}>Alert Filters</div>
                {[
                  { val: 'all', label: 'All Alerts', color: '#8b949e', count: alerts.length },
                  { val: 'critical', label: 'Critical', color: 'var(--red)', count: alerts.filter(a => a.severity === 'critical').length },
                  { val: 'warning', label: 'Warning', color: 'var(--orange)', count: alerts.filter(a => a.severity === 'warning').length },
                  { val: 'info', label: 'Info', color: 'var(--blue)', count: alerts.filter(a => a.severity === 'info').length },
                ].map(f => (
                  <button
                    key={f.val}
                    className={[styles.sideBtn, alertSeverityFilter === f.val ? styles.sideBtnActive : ''].join(' ')}
                    onClick={() => setAlertSeverityFilter(f.val)}
                  >
                    <span className={styles.dot} style={{ background: f.color }} />
                    {f.label}
                    <span className={styles.badge}>{f.count}</span>
                  </button>
                ))}

                <div className={styles.sideDivider} />
                <button
                  className={[styles.sideBtn, isAlertConfigEditing ? styles.sideBtnActive : ''].join(' ')}
                  onClick={() => setAlertConfigEditing(!isAlertConfigEditing)}
                >
                  <span className={styles.dot} style={{ background: 'var(--text3)' }} />
                  ⚙ Configure
                </button>
              </div>
            )}
          </div>

          {/* FLOATING TOGGLE (Outside the panel so it's always visible) */}
          <button
            className={styles.floatingToggle}
            onClick={togglePanel}
            role="button"
            title={panelCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{
              transform: panelCollapsed ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.3s'
            }}>
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </aside>

        {/* MAIN */}
        <main className={styles.main}>
          {!state ? (
            <div className="empty-state">
              <div className="spinner" style={{ marginBottom: 12 }} />
              <br />Connecting to cluster…
            </div>
          ) : children}
        </main>
      </div>
    </div>
  );
}
