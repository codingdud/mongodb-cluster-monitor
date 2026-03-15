import { create } from 'zustand';

export const useCluster = create((set, get) => ({
  state: null,
  connected: false,
  lastUpdate: null,
  selectedNode: null,
  activeTab: 'overview',
  activeType: 'all',
  activeRS: 'all',
  profilerMinMs: 100,
  profilerNodeId: 'all',
  profilerOp: 'all',
  profilerTab: 'historical', // 'active' or 'historical'
  panelCollapsed: false,
  alerts: [],
  alertConfig: { 
    lagMs: 10000, 
    opsLimit: 2000,
    emailEnabled: false,
    recipients: []
  },
  alertSeverityFilter: 'all',
  isAlertConfigEditing: false,
  archivedAlerts: [],

  setSelectedNode: (node) => set({ selectedNode: node }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setActiveType: (type) => set({ activeType: type }),
  setActiveRS: (rs) => set({ activeRS: rs }),
  setProfilerMinMs: (ms) => set({ profilerMinMs: ms }),
  setProfilerNodeId: (id) => set({ profilerNodeId: id }),
  setProfilerOp: (op) => set({ profilerOp: op }),
  setProfilerTab: (tab) => set({ profilerTab: tab }),
  togglePanel: () => set((s) => ({ panelCollapsed: !s.panelCollapsed })),
  setAlertSeverityFilter: (filter) => set({ alertSeverityFilter: filter }),
  setAlertConfigEditing: (editing) => set({ isAlertConfigEditing: editing }),

  archiveAlert: async (id) => {
    try {
      const res = await fetch(`/api/alerts/${encodeURIComponent(id)}/archive`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to archive alert');
    } catch (err) {
      console.error('Alert archive error:', err);
    }
  },
  clearArchive: async () => {
    try {
      const res = await fetch('/api/alerts/archive', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear archive');
    } catch (err) {
      console.error('Archive clear error:', err);
    }
  },

  saveAlertConfig: async (config) => {
    try {
      const res = await fetch('/api/alerts/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (!res.ok) throw new Error('Failed to save alert config');
      const data = await res.json();
      set({ alertConfig: data.config });
    } catch (err) {
      console.error('Alert config save error:', err);
    }
  },

  _es: null,
  _retryTimer: null,

  connect() {
    const existing = get()._es;
    if (existing) { try { existing.close(); } catch { /* ignore */ } }

    const es = new EventSource('/api/events');

    es.onmessage = (e) => {
      try {
        const { nodes, summary, replicaSets, alerts, archivedAlerts, alertConfig } = JSON.parse(e.data);
        set({ 
          state: { nodes, summary, replicaSets }, 
          alerts: alerts || [],
          archivedAlerts: archivedAlerts || [],
          alertConfig: alertConfig || get().alertConfig,
          connected: true, 
          lastUpdate: new Date(),
          error: null 
        });
      } catch { /* ignore parse error */ }
    };

    es.onerror = () => {
      set({ connected: false });
      es.close();
      // Reconnect after 5s
      const t = setTimeout(() => get().connect(), 5000);
      set({ _retryTimer: t });
    };

    set({ _es: es });
  },

  disconnect() {
    const { _es, _retryTimer } = get();
    if (_retryTimer) clearTimeout(_retryTimer);
    if (_es) { try { _es.close(); } catch { /* ignore */ } }
    set({ _es: null, connected: false });
  },

  // Derived helpers
  filteredNodes() {
    const { state, activeType, activeRS } = get();
    if (!state) return [];
    return state.nodes.filter(n => {
      const typeOk = activeType === 'all' || n.rsType === activeType;
      const rsOk   = activeRS   === 'all' || n.rsName === activeRS;
      return typeOk && rsOk;
    });
  },

  filteredRS() {
    const { state, activeType, activeRS } = get();
    if (!state) return [];
    return Object.values(state.replicaSets || {}).filter(rs => {
      const typeOk = activeType === 'all' || rs.rsType === activeType;
      const rsOk   = activeRS   === 'all' || rs.rsName === activeRS;
      return typeOk && rsOk;
    });
  },
}));
