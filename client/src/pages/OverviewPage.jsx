import { useCluster } from '../store/useCluster';
import SummaryBar   from '../components/SummaryBar';
import NodeCard     from '../components/NodeCard';
import NodeDrawer   from '../components/NodeDrawer';
import OpsAreaChart from '../components/OpsAreaChart';
import styles from './OverviewPage.module.css';

export default function OverviewPage() {
  const { state, filteredNodes, activeType, activeRS } = useCluster();
  if (!state) return null;

  const nodes = filteredNodes();

  return (
    <div>
      <SummaryBar summary={state.summary} />

      {/* Real-time ops chart */}
      <div className={styles.chartPanel}>
        <div className={styles.chartTitle}>
          Cluster Ops / s — real-time (all nodes)
          <span className={styles.chartLegend}>
            <LegDot color="#58a6ff" label="Reads" />
            <LegDot color="#3fb950" label="Writes" />
            <LegDot color="#d29922" label="Commands" />
          </span>
        </div>
        <OpsAreaChart nodes={state.nodes} />
      </div>

      {/* Node grid */}
      <div className={styles.sectionHeading}>
        Nodes —{' '}
        {activeType === 'all' ? 'All Types' : activeType.toUpperCase()}
        {activeRS !== 'all' && ` · ${activeRS}`}
      </div>

      {nodes.length === 0 ? (
        <div className="empty-state">No nodes match the current filter.</div>
      ) : (
        <div className={styles.nodeGrid}>
          {nodes.map(n => <NodeCard key={n.id} node={n} />)}
        </div>
      )}

      <NodeDrawer />
    </div>
  );
}

function LegDot({ color, label }) {
  return (
    <span style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, color:'var(--text3)' }}>
      <span style={{ width:8, height:8, borderRadius:2, background:color, display:'inline-block' }} />
      {label}
    </span>
  );
}
