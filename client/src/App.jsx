import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useCluster } from './store/useCluster';
import Layout from './components/Layout';
import OverviewPage from './pages/OverviewPage';
import ReplicaSetsPage from './pages/ReplicaSetsPage';
import ShardsPage from './pages/ShardsPage';
import ProfilerPage from './pages/ProfilerPage';
import AlertsPage from './pages/AlertsPage';

export default function App() {
  const connect = useCluster(s => s.connect);
  const disconnect = useCluster(s => s.disconnect);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/"            element={<OverviewPage />}    />
          <Route path="/replicasets" element={<ReplicaSetsPage />} />
          <Route path="/shards"      element={<ShardsPage />}      />
          <Route path="/profiler"    element={<ProfilerPage />}    />
          <Route path="/alerts"      element={<AlertsPage />}      />
          <Route path="*"            element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
