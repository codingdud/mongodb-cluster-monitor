import { useEffect } from 'react';
import { useCluster } from '../store/useCluster';
import SparkLine from './SparkLine';
import styles from './NodeDrawer.module.css';

const TYPE_ICON = { config: '⚙', shard: '💾', router: '🔀' };

function fmtBytes(b) {
  if (!b) return '0 B';
  const units = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i];
}
function fmtUptime(s) {
  const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}
const ROLE_CLS = { PRIMARY:'badge-blue', SECONDARY:'badge-green', ARBITER:'badge-amber' };

export default function NodeDrawer() {
  const { selectedNode, setSelectedNode } = useCluster();
  const n = selectedNode;

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') setSelectedNode(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSelectedNode]);

  if (!n) return null;

  const role = n.online ? (n.role || 'UNKNOWN') : 'DOWN';
  const ss   = n.serverStatus;
  const rs   = n.replicaSet;
  const cfg  = n.rsConfig;
  const hl   = n.health;
  const ops  = n.opsRate;
  const oplog = n.oplog;
  const shards = n.shards;

  return (
    <>
      <div className={styles.overlay} onClick={() => setSelectedNode(null)} />
      <div className={styles.drawer}>
        {/* Header */}
        <div className={styles.header}>
          <span className={styles.typeIcon}>{TYPE_ICON[n.rsType] || '🖥'}</span>
          <div>
            <div className={styles.title}>{n.label || n.id}</div>
            <div className={styles.subtitle}>{n.directHost || n.host}:{n.directPort || n.port} · {n.rsName}</div>
          </div>
          <span className={`badge badge-${role==='PRIMARY'?'blue':role==='SECONDARY'?'green':role==='ROUTER'?'teal':'red'}`}
            style={{marginLeft:8}}>{role}</span>
          <button className={styles.closeBtn} onClick={() => setSelectedNode(null)}>✕</button>
        </div>

        {/* Body */}
        <div className={styles.body}>

          {/* Sparkline */}
          {n.history?.length > 0 && (
            <Section title="Ops/s trend">
              <div style={{ height: 70 }}><SparkLine data={n.history} height={70} /></div>
            </Section>
          )}

          {/* Ops breakdown */}
          {ops && (
            <Section title="Ops / second (insert · query · update · delete · command)">
              <div className={styles.statGrid}>
                <StatBox label="Insert"  value={ops.insert}  />
                <StatBox label="Query"   value={ops.query}   />
                <StatBox label="Update"  value={ops.update}  />
                <StatBox label="Delete"  value={ops.delete}  />
                <StatBox label="Command" value={ops.command} />
                <StatBox label="Total"   value={ops.total}   cls="ok" />
              </div>
            </Section>
          )}

          {/* db.serverStatus() */}
          {ss && (
            <Section title="db.serverStatus()">
              <div className={styles.statGrid}>
                <StatBox label="Process"       value={ss.process || '—'} />
                <StatBox label="Version"       value={ss.version || '—'} />
                <StatBox label="Host"          value={ss.host || '—'}    small />
                <StatBox label="Uptime"        value={ss.uptimeHuman || '—'} />
                <StatBox label="Connections"   value={`${ss.connections?.current ?? 0} / ${ss.connections?.available ?? 0}`} />
                <StatBox label="Mem RSS"       value={`${ss.mem?.resident ?? 0} MB`} />
                <StatBox label="WT Cache"      value={`${ss.wiredTiger?.cacheUsedMB ?? 0} / ${ss.wiredTiger?.cacheSizeMB ?? 0} MB`} />
                <StatBox label="Net In"        value={fmtBytes(ss.network?.bytesIn)} />
                <StatBox label="Net Out"       value={fmtBytes(ss.network?.bytesOut)} />
                <StatBox label="Cursors Open"  value={ss.cursors?.totalOpen ?? 0} />
                <StatBox label="Global Lock Q" value={ss.globalLock?.currentQueueTotal ?? 0}
                  cls={(ss.globalLock?.currentQueueTotal ?? 0) > 10 ? 'warn' : ''} />
                <StatBox label="PID"           value={ss.pid || '—'} />
              </div>
            </Section>
          )}

          {/* rs.status() */}
          {rs?.members?.length > 0 && (
            <Section title={`rs.status() — ${rs.setName}`}>
              <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:10,fontSize:11,color:'var(--text3)'}}>
                <span>Term: <b style={{color:'var(--text)',fontFamily:'var(--mono)'}}>{rs.term ?? '—'}</b></span>
                <span>Protocol: <b style={{color:'var(--text)'}}>{rs.protocolVersion ?? '—'}</b></span>
                {rs.lastElectionDate && (
                  <span>Last election: <b style={{color:'var(--text)'}}>{new Date(rs.lastElectionDate).toLocaleString()}</b></span>
                )}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Member</th><th>State</th><th>Health</th><th>Lag</th><th>Ping</th><th>Sync Source</th><th>Uptime</th></tr>
                  </thead>
                  <tbody>
                    {rs.members.map(m => (
                      <tr key={m.id}>
                        <td className="mono" style={{fontSize:11}}>
                          {m.self ? <strong>{m.name}</strong> : m.name}
                          {m.self && <span style={{color:'var(--blue)',marginLeft:4}}>(self)</span>}
                        </td>
                        <td><span className={`badge ${ROLE_CLS[m.stateStr]||'badge-gray'}`}>{m.stateStr}</span></td>
                        <td><span className={`badge ${m.health===1?'badge-green':'badge-red'}`}>{m.health===1?'OK':'DOWN'}</span></td>
                        <td className={`mono ${m.stateStr==='PRIMARY'?'':''}`.trim()}
                          style={{color: m.stateStr==='PRIMARY'?'var(--text3)':m.lagSec<5?'var(--green)':m.lagSec<30?'var(--amber)':'var(--red)'}}>
                          {m.stateStr==='PRIMARY'?'—':m.lagSec+'s'}
                        </td>
                        <td className="mono">{m.pingMs||0}ms</td>
                        <td className="mono" style={{fontSize:10,color:'var(--text3)'}}>{m.syncSourceHost||'—'}</td>
                        <td>{fmtUptime(m.uptime||0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* rs.conf() */}
          {cfg?.members?.length > 0 && (
            <Section title={`rs.conf() — config v${cfg.version}`}>
              <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:10,fontSize:11,color:'var(--text3)'}}>
                <span>Heartbeat: <b style={{color:'var(--text)'}}>{cfg.settings?.heartbeatIntervalMs??'—'}ms</b></span>
                <span>Election timeout: <b style={{color:'var(--text)'}}>{cfg.settings?.electionTimeoutMs??'—'}ms</b></span>
                <span>Chaining: <b style={{color:'var(--text)'}}>{cfg.settings?.chainingAllowed?'allowed':'disabled'}</b></span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>#</th><th>Host</th><th>Priority</th><th>Votes</th><th>Hidden</th><th>Arbiter</th><th>Delay</th></tr>
                  </thead>
                  <tbody>
                    {cfg.members.map(m => (
                      <tr key={m.id}>
                        <td className="mono">{m.id}</td>
                        <td className="mono" style={{fontSize:11}}>{m.host}</td>
                        <td className="mono">{m.priority}</td>
                        <td className="mono">{m.votes}</td>
                        <td>{m.hidden ? <span className="badge badge-amber">Yes</span> : '—'}</td>
                        <td>{m.arbiterOnly ? <span className="badge badge-amber">Yes</span> : '—'}</td>
                        <td className="mono">{m.slaveDelay > 0 ? m.slaveDelay+'s' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* db.hello() */}
          {hl && (
            <Section title="db.hello() — health & identity">
              <div className={styles.statGrid}>
                <StatBox label="Ping"       value={hl.ok?'OK':'FAIL'} cls={hl.ok?'ok':'err'} />
                <StatBox label="Role"       value={hl.ismaster?'Primary':hl.secondary?'Secondary':'Other'} />
                <StatBox label="RS Name"    value={hl.setName||'—'} />
                <StatBox label="Me"         value={hl.me||'—'} small />
                <StatBox label="Primary"    value={hl.primary||'—'} small />
                <StatBox label="Conn ID"    value={hl.connectionId||'—'} />
                <StatBox label="Max BSON"   value={fmtBytes(hl.maxBsonObjectSize)} />
                <StatBox label="Session TTL" value={`${hl.logicalSessionTimeoutMinutes??'—'} min`} />
              </div>
              {hl.hosts?.length > 0 && (
                <div style={{marginTop:8,fontSize:10,color:'var(--text3)'}}>
                  <b>RS Hosts: </b>
                  {hl.hosts.map(h => (
                    <code key={h} style={{color:'var(--text)',background:'var(--bg4)',padding:'1px 4px',borderRadius:3,margin:'0 2px'}}>{h}</code>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* Oplog */}
          {oplog && (
            <Section title="Oplog status">
              <div className={styles.statGrid}>
                <StatBox label="Used"    value={`${oplog.sizeMB} MB`} />
                <StatBox label="Max"     value={`${oplog.maxSizeMB} MB`} />
                <StatBox label="Used %"  value={`${oplog.usedPct}%`} cls={oplog.usedPct>80?'err':oplog.usedPct>60?'warn':'ok'} />
                <StatBox label="Window"  value={`${oplog.windowHr}h`} />
              </div>
              <div style={{marginTop:8}}>
                <div className="bar-wrap">
                  <div className={`bar-fill ${oplog.usedPct>80?'bar-red':oplog.usedPct>60?'bar-amber':'bar-green'}`}
                    style={{width:`${oplog.usedPct}%`}} />
                </div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--text3)',marginTop:3}}>
                  <span>First: {oplog.first ? new Date(oplog.first).toLocaleString() : '—'}</span>
                  <span>Last: {oplog.last ? new Date(oplog.last).toLocaleString() : '—'}</span>
                </div>
              </div>
            </Section>
          )}

          {/* Shards (router) */}
          {shards?.shards?.length > 0 && (
            <Section title="sh.status() — shard distribution">
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Shard</th><th>Host</th><th>Chunks</th><th>%</th><th>State</th></tr></thead>
                  <tbody>
                    {shards.shards.map(sh => (
                      <tr key={sh.id}>
                        <td className="mono">{sh.id}</td>
                        <td className="mono" style={{fontSize:10,color:'var(--text3)'}}>{sh.host}</td>
                        <td className="mono">{sh.chunks}</td>
                        <td style={{minWidth:120}}>
                          <div className="bar-wrap" style={{width:80,display:'inline-block',marginRight:6}}>
                            <div className="bar-fill bar-blue" style={{width:`${sh.chunkPct}%`}} />
                          </div>
                          <span style={{fontSize:10,color:'var(--text3)'}}>{sh.chunkPct}%</span>
                        </td>
                        <td><span className={`badge ${sh.state===1?'badge-green':'badge-red'}`}>{sh.state===1?'OK':sh.state}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {!ss && !rs && !hl && (
            <div className="empty-state">
              No direct connection data.<br/>
              <span style={{fontSize:11,color:'var(--text3)'}}>{n.note || ''}</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Section({ title, children }) {
  return (
    <div style={{marginBottom:22}}>
      <div style={{
        fontSize:10, fontWeight:700, color:'var(--text3)', textTransform:'uppercase',
        letterSpacing:'.08em', marginBottom:10, display:'flex', alignItems:'center', gap:8,
      }}>
        {title}
        <div style={{flex:1,height:1,background:'var(--border)'}} />
      </div>
      {children}
    </div>
  );
}

function StatBox({ label, value, cls = '', small = false }) {
  return (
    <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'8px 10px' }}>
      <div style={{ fontSize:10, color:'var(--text3)', marginBottom:3 }}>{label}</div>
      <div style={{
        fontSize: small ? 11 : 14,
        fontWeight:600, fontFamily:'var(--mono)', color:'var(--text)',
        ...(cls==='ok'?{color:'var(--green)'}:cls==='warn'?{color:'var(--amber)'}:cls==='err'?{color:'var(--red)'}:{}),
      }}>{value}</div>
    </div>
  );
}
