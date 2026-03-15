import React, { useState, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush
} from 'recharts';
import styles from '../pages/OverviewPage.module.css';

// Build time-series from all nodes' history arrays
// Bucketing by 5s to normalize jitter across different node poll times
function buildSeries(nodes) {
  if (!nodes?.length) return [];
  const byTs = {};
  const BUCKET = 5000; // 5s buckets

  nodes.forEach(n => {
    (n.history || []).forEach(h => {
      const bucketTs = Math.floor(h.ts / BUCKET) * BUCKET;
      if (!byTs[bucketTs]) {
        byTs[bucketTs] = { ts: bucketTs, read: 0, write: 0, command: 0, total: 0 };
      }
      byTs[bucketTs].read    += h.query   || 0;
      byTs[bucketTs].write   += (h.insert || 0) + (h.update || 0) + (h.delete || 0);
      byTs[bucketTs].command += h.command || 0;
      byTs[bucketTs].total   += h.total   || 0;
    });
  });

  return Object.values(byTs)
    .sort((a, b) => a.ts - b.ts)
    .slice(-500); // Guard: limit frontend processing to match backend history
}

export default function OpsAreaChart({ nodes }) {
  const [range, setRange] = useState('all'); // '1m', '5m', '15m', 'all'
  const [isLive, setIsLive] = useState(true);
  const [brushIndices, setBrushIndices] = useState({ start: undefined, end: undefined });
  
  const allData = useMemo(() => buildSeries(nodes), [nodes]);
  
  // Sync brush indices when in Live mode or when range changes
  // We use indices to control the Brush window exactly
  React.useEffect(() => {
    if (isLive && allData.length > 0) {
      const windowSize = range === '1m' ? 12 : range === '5m' ? 60 : range === '15m' ? 180 : allData.length;
      const end = allData.length - 1;
      const start = Math.max(0, end - windowSize);
      setBrushIndices({ start, end });
    }
  }, [allData.length, isLive, range]);

  const handleBrushChange = (obj) => {
    if (!obj) return;
    const { startIndex, endIndex } = obj;
    setBrushIndices({ start: startIndex, end: endIndex });
    
    // If the user moves the brush away from the absolute end, we pause "Live" mode
    // to allow them to scrub history without being yanked back to the front.
    const isAtEnd = endIndex >= allData.length - 1;
    if (!isAtEnd && isLive) {
      setIsLive(false);
    }
  };

  const formatTick = (ts) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  if (!allData.length) return (
    <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 12 }}>
      Collecting ops data…
    </div>
  );

  return (
    <div className={styles.chartWrapper}>
      <div className={styles.rangeToolbar}>
        {['1m', '5m', '15m', 'all'].map(r => (
          <button 
            key={r} 
            className={[styles.rangeBtn, range === r ? styles.rangeBtnActive : ''].join(' ')}
            onClick={() => {
              setRange(r);
              setIsLive(true);
            }}
          >
            {r === 'all' ? 'All' : r}
          </button>
        ))}
        
        <div style={{ flex: 1 }} />
        
        <button 
          className={[styles.liveBtn, isLive ? styles.liveBtnActive : ''].join(' ')}
          onClick={() => setIsLive(true)}
          title={isLive ? "Following live feed" : "Click to return to live feed"}
        >
          <span className={styles.liveDot} />
          {isLive ? 'LIVE FEED' : 'JUMP TO LIVE'}
        </button>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={allData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gRead"    x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#58a6ff" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#58a6ff" stopOpacity={0}  />
            </linearGradient>
            <linearGradient id="gWrite"   x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#3fb950" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3fb950" stopOpacity={0}  />
            </linearGradient>
            <linearGradient id="gCommand" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#d29922" stopOpacity={0.25}/>
              <stop offset="95%" stopColor="#d29922" stopOpacity={0}  />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis 
            dataKey="ts" 
            tick={{ fill: 'var(--text3)', fontSize: 10 }} 
            interval="preserveStartEnd" 
            minTickGap={50}
            tickFormatter={formatTick}
          />
          <YAxis tick={{ fill: 'var(--text3)', fontSize: 10 }} width={45} />
          <Tooltip
            contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', fontSize: 11, borderRadius: 8 }}
            labelFormatter={formatTick}
            labelStyle={{ color: 'var(--text2)', fontWeight: 600, marginBottom: 4 }}
            itemStyle={{ padding: '2px 0' }}
            animationDuration={0}
          />
          <Area 
            type="monotone" 
            dataKey="read"    
            name="Reads"    
            stroke="#58a6ff" 
            fill="url(#gRead)"    
            strokeWidth={2} 
            dot={false}
            isAnimationActive={false} 
          />
          <Area 
            type="monotone" 
            dataKey="write"   
            name="Writes"   
            stroke="#3fb950" 
            fill="url(#gWrite)"   
            strokeWidth={2} 
            dot={false}
            isAnimationActive={false}
          />
          <Area 
            type="monotone" 
            dataKey="command" 
            name="Commands" 
            stroke="#d29922" 
            fill="url(#gCommand)" 
            strokeWidth={1.5}   
            dot={false}
            isAnimationActive={false}
          />
          <Brush 
            dataKey="ts" 
            height={35} 
            stroke="var(--border)" 
            fill="var(--bg2)"
            travellerWidth={10}
            startIndex={brushIndices.start}
            endIndex={brushIndices.end}
            onChange={handleBrushChange}
            tickFormatter={formatTick}
          >
            <AreaChart>
              <Area dataKey="read" stroke="#58a6ff" fill="#58a6ff" fillOpacity={0.1} />
            </AreaChart>
          </Brush>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
