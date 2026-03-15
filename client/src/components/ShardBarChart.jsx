import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer, LabelList,
} from 'recharts';

const COLORS = ['#58a6ff','#3fb950','#bc8cff','#d29922','#39c5cf'];

export default function ShardBarChart({ shards = [] }) {
  if (!shards.length) return null;
  const data = shards.map(s => ({
    name:   s.id,
    chunks: s.chunks,
    pct:    s.chunkPct,
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: 'var(--text2)', fontSize: 11, fontFamily: 'var(--mono)' }} />
        <YAxis tick={{ fill: 'var(--text3)', fontSize: 10 }} width={40} label={{ value: 'chunks', angle: -90, position: 'insideLeft', fill: 'var(--text3)', fontSize: 10, dy: 30 }} />
        <Tooltip
          contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', fontSize: 11 }}
          labelStyle={{ color: 'var(--text2)', fontFamily: 'var(--mono)' }}
          formatter={(v, n, p) => [`${v} chunks (${p.payload.pct}%)`, 'Chunks']}
        />
        <Bar dataKey="chunks" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          <LabelList dataKey="pct" position="top" formatter={v => `${v}%`} style={{ fill: 'var(--text3)', fontSize: 10 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
