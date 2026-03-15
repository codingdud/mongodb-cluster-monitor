import { useState } from 'react';
import { useCluster } from '../store/useCluster';
import NodeCard    from '../components/NodeCard';
import NodeDrawer  from '../components/NodeDrawer';
import styles from './ReplicaSetsPage.module.css';

const ROLE_CLS = { PRIMARY:'badge-blue', SECONDARY:'badge-green', ARBITER:'badge-amber' };

function fmtUptime(s) {
  if (!s) return '—';
  const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

export default function ReplicaSetsPage() {
  const { filteredRS } = useCluster();
  const rsList = filteredRS();

  if (!rsList.length) return <div className="empty-state">No replica sets match the current filter.</div>;

  return (
    <div>
      {rsList.map(rs => <RSSection key={rs.rsName} rs={rs} />)}
      <NodeDrawer />
    </div>
  );
}

function RSSection({ rs }) {
  const [open, setOpen] = useState(true);
  const online = rs.nodes.filter(n => n.online).length;
  const total  = rs.nodes.length;
  const typeLabel = { config:'Config RS', shard:'Shard RS', router:'Router' }[rs.rsType] || rs.rsType;
  const typeCls   = { config:styles.badgeConfig, shard:styles.badgeShard, router:styles.badgeRouter }[rs.rsType] || '';
  const healthCls = online === total ? styles.healthOk : online > 0 ? styles.healthWarn : styles.healthErr;

  // Get members from the primary node's replicaSet data
  const primaryNode = rs.nodes.find(n => n.isPrimary);
  const members = primaryNode?.replicaSet?.members || [];

  return (
    <div className={styles.section}>
      <div className={styles.header} onClick={() => setOpen(o => !o)}>
        <span className={[styles.typeBadge, typeCls].join(' ')}>{typeLabel}</span>
        <span className={styles.rsName}>{rs.rsName}</span>
        <span className={[styles.health, healthCls].join(' ')}>{online}/{total} healthy</span>
        <span style={{ marginLeft:'auto', fontSize:11, color:'var(--text3)' }}>
          {open ? '▲' : '▼'} {rs.nodes.length} nodes
        </span>
      </div>

      {open && (
        <div className={styles.body}>
          {/* Node cards */}
          <div className={styles.nodeGrid}>
            {rs.nodes.map(n => <NodeCard key={n.id} node={n} />)}
          </div>

          {/* Replication table */}
          {members.length > 0 && (
            <div className={styles.members}>
              <div className={styles.membersTitle}>rs.status() — member details</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Member</th><th>State</th><th>Health</th>
                      <th>Repl Lag</th><th>Ping</th><th>Sync Source</th><th>Votes</th><th>Uptime</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map(m => {
                      const lagCls = m.stateStr==='PRIMARY'?'':m.lagSec<5?'ok':m.lagSec<30?'warn':'err';
                      return (
                        <tr key={m.id}>
                          <td className="mono" style={{fontSize:11}}>
                            {m.self ? <strong>{m.name}</strong> : m.name}
                            {m.self && <span style={{color:'var(--blue)',marginLeft:4,fontFamily:'var(--sans)',fontSize:10}}>(self)</span>}
                          </td>
                          <td><span className={`badge ${ROLE_CLS[m.stateStr]||'badge-gray'}`}>{m.stateStr}</span></td>
                          <td><span className={`badge ${m.health===1?'badge-green':'badge-red'}`}>{m.health===1?'OK':'DOWN'}</span></td>
                          <td className={`mono ${lagCls}`}>
                            {m.stateStr==='PRIMARY' ? '—' : `${m.lagSec}s`}
                          </td>
                          <td className="mono">{m.pingMs||0}ms</td>
                          <td className="mono" style={{fontSize:10,color:'var(--text3)'}}>{m.syncSourceHost||'—'}</td>
                          <td className="mono">{m.votes}</td>
                          <td>{fmtUptime(m.uptime)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
