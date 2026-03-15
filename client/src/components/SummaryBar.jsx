import styles from './SummaryBar.module.css';

export default function SummaryBar({ summary }) {
  if (!summary) return null;
  const { online, totalNodes, down, totalOpsPerSec, totalConnections, maxReplicationLagSec, slowQueryCount, collscanCount } = summary;
  const lagCls = maxReplicationLagSec < 5 ? 'ok' : maxReplicationLagSec < 30 ? 'warn' : 'err';

  return (
    <div className={styles.grid}>
      <Card label="Cluster Status" sub={`${online}/${totalNodes} nodes online`}
        value={down > 0 ? 'DEGRADED' : 'HEALTHY'} valueCls={down > 0 ? 'warn' : 'ok'} />
      <Card label="Total Ops / s"  sub="across all nodes"
        value={totalOpsPerSec.toLocaleString()} />
      <Card label="Connections"    sub="active"
        value={totalConnections.toLocaleString()} />
      <Card label="Max Repl Lag"  sub="secondary lag"
        value={`${maxReplicationLagSec}s`} valueCls={lagCls} />
      <Card label="Slow Queries"  sub={`${collscanCount} COLLSCAN`}
        value={slowQueryCount} valueCls={slowQueryCount > 0 ? 'warn' : 'ok'} />
      <Card label="Nodes Down"    sub={`of ${totalNodes} total`}
        value={down} valueCls={down > 0 ? 'err' : 'ok'} />
    </div>
  );
}

function Card({ label, value, sub, valueCls = '' }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>{label}</div>
      <div className={[styles.cardVal, valueCls ? styles[valueCls] || '' : ''].join(' ')}>{value}</div>
      {sub && <div className={styles.cardSub}>{sub}</div>}
    </div>
  );
}
