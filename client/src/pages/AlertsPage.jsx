import React, { useState } from 'react';
import { useCluster } from '../store/useCluster';
import styles from './AlertsPage.module.css';

export default function AlertsPage() {
  const { 
    alerts, archiveAlert, archivedAlerts, alertConfig, saveAlertConfig,
    alertSeverityFilter, isAlertConfigEditing, setAlertConfigEditing 
  } = useCluster();
  
  const [tempConfig, setTempConfig] = useState(alertConfig);
  const [activeTab, setActiveTab] = useState('active'); // 'active' or 'archive'

  const getSeverityClass = (severity) => {
    if (severity === 'critical') return styles.critical;
    if (severity === 'warning') return styles.warning;
    return styles.info;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    await saveAlertConfig(tempConfig);
    setAlertConfigEditing(false);
  };

  const currentAlerts = activeTab === 'active' ? alerts : archivedAlerts;
  const filteredAlerts = currentAlerts.filter(a => 
    alertSeverityFilter === 'all' || a.severity === alertSeverityFilter
  );

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleInfo}>
          <h1 className={styles.title}>System Alerts</h1>
          <p className={styles.subtitle}>Real-time health monitoring and issue tracking</p>
        </div>
        
        <div className={styles.headerActions}>
           <button 
             className={styles.configToggle}
             onClick={() => {
               setTempConfig(alertConfig);
               setAlertConfigEditing(!isAlertConfigEditing);
             }}
           >
             {isAlertConfigEditing ? 'Cancel' : '⚙ Alerts Config'}
           </button>
        </div>

        <div className={styles.stats}>
          <div className={styles.statItem} onClick={() => setActiveTab('active')} style={{cursor:'pointer', opacity: activeTab==='active'?1:0.6}}>
            <span className={styles.statVal}>{alerts.length}</span>
            <span className={styles.statLabel}>Active</span>
          </div>
          <div className={styles.statItem} onClick={() => setActiveTab('archive')} style={{cursor:'pointer', opacity: activeTab==='archive'?1:0.6}}>
            <span className={styles.statVal} style={{color:'var(--text3)'}}>{archivedAlerts.length}</span>
            <span className={styles.statLabel}>Archived</span>
          </div>
        </div>
      </header>

      {/* Tab Switcher */}
      <div className={styles.tabSwitcher}>
        <button 
          className={[styles.tabBtn, activeTab === 'active' ? styles.tabBtnActive : ''].join(' ')}
          onClick={() => setActiveTab('active')}
        >
          Active Issues ({alerts.length})
        </button>
        <button 
          className={[styles.tabBtn, activeTab === 'archive' ? styles.tabBtnActive : ''].join(' ')}
          onClick={() => setActiveTab('archive')}
        >
          Archive History ({archivedAlerts.length})
        </button>
        {activeTab === 'archive' && archivedAlerts.length > 0 && (
          <button 
            className={styles.clearArchiveBtn}
            onClick={() => {
              if (window.confirm('Are you sure you want to clear the entire archive history?')) {
                useCluster.getState().clearArchive();
              }
            }}
          >
            🗑 Clear All
          </button>
        )}
      </div>

      {isAlertConfigEditing && (
        <form className={styles.configForm} onSubmit={handleSave}>
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label>Replication Lag Threshold (ms)</label>
              <input 
                type="number" 
                value={tempConfig.lagMs || 0} 
                onChange={e => setTempConfig({...tempConfig, lagMs: parseInt(e.target.value) || 0})}
              />
              <p className={styles.fieldHint}>Warning triggers when lag exceeds this value.</p>
            </div>
            <div className={styles.formGroup}>
              <label>Cluster Ops Limit (ops/s)</label>
              <input 
                type="number" 
                value={tempConfig.opsLimit || 0} 
                onChange={e => setTempConfig({...tempConfig, opsLimit: parseInt(e.target.value) || 0})}
              />
              <p className={styles.fieldHint}>Warning triggers when total cluster ops exceed this.</p>
            </div>
          </div>

          <div className={styles.emailSection}>
            <div className={styles.emailHeader}>
              <label className={styles.toggleLabel}>
                <input 
                  type="checkbox" 
                  checked={!!tempConfig.emailEnabled}
                  onChange={e => setTempConfig({...tempConfig, emailEnabled: e.target.checked})}
                />
                Enable Email Notifications (Critical Alerts only)
              </label>
            </div>

            <div className={styles.recipientConfig}>
              <label>Concerned Persons (Recipients)</label>
              <div className={styles.recipientInputGroup}>
                <input 
                  type="text" 
                  placeholder="email1, email2..."
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const val = e.target.value.trim();
                      if (!val) return;
                      
                      const newEmails = val.split(',')
                        .map(s => s.trim())
                        .filter(s => s && s.includes('@') && !(tempConfig.recipients || []).includes(s));

                      if (newEmails.length > 0) {
                        setTempConfig({
                          ...tempConfig, 
                          recipients: [...(tempConfig.recipients || []), ...newEmails]
                        });
                        e.target.value = '';
                      }
                    }
                  }}
                />
                <p className={styles.fieldHint}>Separate multiple emails with commas. Press Enter to add.</p>
              </div>
              <div className={styles.recipientList}>
                {(tempConfig.recipients || []).map(email => (
                  <div key={email} className={styles.recipientTag}>
                    {email}
                    <button 
                      type="button"
                      onClick={() => setTempConfig({
                        ...tempConfig,
                        recipients: tempConfig.recipients.filter(r => r !== email)
                      })}
                    >✕</button>
                  </div>
                ))}
                {(!tempConfig.recipients || tempConfig.recipients.length === 0) && (
                  <span className={styles.noEmails}>No recipients added yet.</span>
                )}
              </div>
            </div>
          </div>

          <button type="submit" className={styles.saveBtn}>Save Configuration</button>
        </form>
      )}

      {!isAlertConfigEditing && (
        <div className={styles.activeConfigSummary}>
          <div className={styles.summaryInfo}>
            <span className={styles.summaryLabel}>Active Monitoring:</span>
            <span className={styles.summaryVal}>Lag &gt; {alertConfig.lagMs}ms</span>
            <span className={styles.summaryDivider}>|</span>
            <span className={styles.summaryVal}>Ops &gt; {alertConfig.opsLimit}/s</span>
            <span className={styles.summaryDivider}>|</span>
            <span className={styles.summaryVal}>Emails: {alertConfig.emailEnabled ? 'ON' : 'OFF'}</span>
          </div>
          {alertConfig.emailEnabled && alertConfig.recipients.length > 0 && (
            <div className={styles.activeRecipients}>
              <span className={styles.summaryLabel}>Concerned Persons:</span>
              <div className={styles.activeRecipientList}>
                {alertConfig.recipients.map(r => (
                  <span key={r} className={styles.activeRecipientTag}>{r}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className={styles.alertList}>
        {filteredAlerts.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>{activeTab === 'active' ? '✓' : '∅'}</div>
            <h3>{activeTab === 'active' ? 'No active alerts' : 'Archive is empty'}</h3>
            <p>{activeTab === 'active' ? 'Everything looks good right now.' : 'Historically resolved alerts will appear here.'}</p>
          </div>
        ) : (
          filteredAlerts.map((alert) => (
            <div key={alert.id} className={[styles.alertCard, getSeverityClass(alert.severity), activeTab === 'archive' ? styles.archived : ''].join(' ')}>
              <div className={styles.alertIcon}>
                {alert.severity === 'critical' ? '✕' : alert.severity === 'warning' ? '⚠' : 'ℹ'}
              </div>
              <div className={styles.alertContent}>
                <div className={styles.alertTop}>
                  <h3 className={styles.alertTitle}>{alert.title}</h3>
                  <div className={styles.alertMeta}>
                    <span className={styles.alertTime}>
                      {new Date(alert.ts).toLocaleTimeString()}
                    </span>
                    {activeTab === 'active' && (
                      <button 
                        className={styles.archiveBtn}
                        onClick={() => archiveAlert(alert.id)}
                        title="Move to archive"
                      >
                        ✔ Mark as Read
                      </button>
                    )}
                  </div>
                </div>
                <p className={styles.alertMsg}>{alert.message}</p>
                <div className={styles.alertFooter}>
                  {alert.nodeId && <span className={styles.nodeRef}>Node: {alert.nodeId}</span>}
                  {activeTab === 'archive' && alert.archivedAt && (
                    <span className={styles.archivedAt}>Archived: {new Date(alert.archivedAt).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
