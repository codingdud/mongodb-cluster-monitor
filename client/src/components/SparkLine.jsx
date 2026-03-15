import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis } from 'recharts';

export default function SparkLine({ data = [], height = 36 }) {
  if (!data.length) return <div style={{ height }} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
        <YAxis hide domain={['auto', 'auto']} />
        <Tooltip
          contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', fontSize: 10, padding: '4px 8px' }}
          labelStyle={{ display: 'none' }}
          itemStyle={{ color: 'var(--text)' }}
          formatter={(v, name) => [v, name]}
        />
        <Line type="monotone" dataKey="query"  stroke="#58a6ff" strokeWidth={1.5} dot={false} name="Read"  />
        <Line type="monotone" dataKey="insert" stroke="#3fb950" strokeWidth={1.5} dot={false} name="Write" />
        <Line type="monotone" dataKey="command" stroke="#d29922" strokeWidth={1} dot={false} name="Cmd" />
      </LineChart>
    </ResponsiveContainer>
  );
}
