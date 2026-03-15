import { useCluster } from '../store/useCluster';
import SparkLine from './SparkLine';
import styles from './NodeCard.module.css';

const TYPE_ICON  = { config: '⚙', shard: '💾', router: '🔀' };
const ROLE_CLS   = {
  PRIMARY:   styles.rolePrimary,
  SECONDARY: styles.roleSecondary,
  ARBITER:   styles.roleArbiter,
  ROUTER:    styles.roleRouter,
  ONLINE:    styles.roleOnline,
  DOWN:      styles.roleDown,
};

export default function NodeCard({ node }) {
  const setSelectedNode = useCluster(s => s.setSelectedNode);
  const ss  = node.serverStatus;
  const ops = node.opsRate;
  const role = node.online ? (node.role || 'UNKNOWN') : 'DOWN';

  return (
    <div
      className={[
        styles.card,
        !node.online   ? styles.cardDown    : '',
        node.isPrimary ? styles.cardPrimary : '',
      ].join(' ')}
      onClick={() => setSelectedNode(node)}
      title="Click to expand details"
    >
      <div className={styles.cardTop}>
        <div>
          <div className={styles.name}>{TYPE_ICON[node.rsType]} {node.label || node.id}</div>
          <div className={styles.addr}>{node.directHost || node.host}:{node.directPort || node.port}</div>
        </div>
        <span className={[styles.role, ROLE_CLS[role] || styles.roleDown].join(' ')}>{role}</span>
      </div>

      {node.online ? (
        <>
          <div className={styles.sparkWrap}>
            <SparkLine data={node.history || []} height={34} />
          </div>
          {node.limitedStats && (
            <div style={{fontSize:10, color:'var(--amber)', marginBottom:8, fontStyle:'italic'}}>
              ⚠ Monitoring via proxy (limited metrics)
            </div>
          )}
          {ops && <Stat label="Ops/s" value={ops.total.toLocaleString()} />}
          <Stat label="Connections" value={ss?.connections?.current ?? '—'} />
          <Stat label="Mem RSS"    value={ss?.mem?.resident ? `${ss.mem.resident} MB` : '—'} />
          <Stat label="WT Cache"   value={ss?.wiredTiger?.cacheUsedMB ? `${ss.wiredTiger.cacheUsedMB} MB` : '—'} />
          <Stat label="Uptime"     value={ss?.uptimeHuman || '—'} />
          <Stat label="Version"    value={ss?.version || '—'} />
          <div className={styles.expandHint}>▼ click to expand</div>
        </>
      ) : (
        <>
          <Stat label="Status"    value="OFFLINE" valueCls="err" />
          <Stat label="Last seen" value={node.ts ? new Date(node.ts).toLocaleTimeString() : '—'} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, valueCls = '' }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={[styles.statVal, valueCls ? styles[valueCls] || valueCls : ''].join(' ')}>{value}</span>
    </div>
  );
}
