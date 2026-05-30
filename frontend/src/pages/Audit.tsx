/**
 * Audit log page component.
 * Phase 1: Basic implementation with audit log display.
 */

import { useState, useEffect } from 'react';
import api from '../services/api';

interface AuditLog {
  log_id: string;
  contract_id?: string;
  user_id?: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  old_value?: string;
  new_value?: string;
  metadata?: any;
  created_at: string;
}

export default function Audit() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadAuditLogs();
  }, []);

  const loadAuditLogs = async () => {
    try {
      const response = await api.get('/audit/logs?limit=50');
      setLogs(response.data.logs);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold text-primary mb-4">Audit Log</h1>
        <div className="text-center py-12">Loading audit logs...</div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-primary mb-4">Audit Log</h1>
      
      {error && (
        <div className="bg-error-container text-error px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {logs.length === 0 ? (
          <div className="p-12 text-center text-on-surface-variant">
            No audit logs found. Logs will appear here as actions are performed.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-surface-container border-b border-outline-variant">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-on-surface-variant uppercase">
                    Timestamp
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-on-surface-variant uppercase">
                    Action
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-on-surface-variant uppercase">
                    Entity Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-on-surface-variant uppercase">
                    User ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-on-surface-variant uppercase">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {logs.map((log) => (
                  <tr key={log.log_id} className="hover:bg-surface-container-low">
                    <td className="px-6 py-4 text-sm text-on-surface font-mono">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-on-surface">
                      {log.action}
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant">
                      {log.entity_type || '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant font-mono">
                      {log.user_id ? log.user_id.substring(0, 8) : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant">
                      {log.metadata ? JSON.stringify(log.metadata) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
