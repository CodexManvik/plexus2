import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import PDFViewer from '../components/pdf/PDFViewer';

interface Grounding {
  page_number: number;
  bbox_x1?: number;
  bbox_y1?: number;
  bbox_x2?: number;
  bbox_y2?: number;
  source_text: string;
  match_method?: string;
}

interface Parameter {
  param_id: string;
  parameter_name: string;
  parameter_group: string;
  extracted_value: string;
  supporting_text: string;
  confidence: number;
  validation_status: string;
  edited_value: string | null;
  reviewer_status: string | null; // ACCEPTED, EDITED, REJECTED
  grounding?: Grounding | null;
}

export default function DraftReview() {
  const { contractId } = useParams<{ contractId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeParamId, setActiveParamId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string>('All changes saved');

  // Ref container for scrolling left and right panes
  const tablePaneRef = useRef<HTMLDivElement>(null);
  const paramRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  // Track current scroll offset of the right pane for session persistence
  const scrollPositionRef = useRef<number>(0);

  // ── Session helpers ────────────────────────────────────────────────────────

  const saveSession = useCallback(async (lastParamId: string | null) => {
    if (!contractId) return;
    try {
      await api.post(`/review/${contractId}/session/save`, {
        last_param_id:   lastParamId,
        scroll_position: scrollPositionRef.current,
      });
    } catch {
      // Session save is best-effort — never surface this as an error
    }
  }, [contractId]);

  // Restore session on mount
  useEffect(() => {
    if (!contractId) return;
    (async () => {
      try {
        const { data } = await api.get(`/review/${contractId}/session/restore`);
        if (!data.first_visit && data.session?.last_param_id) {
          const lastId = data.session.last_param_id;
          setActiveParamId(lastId);
          // Wait for DOM to be populated, then scroll to the last param row
          setTimeout(() => {
            const rowEl = paramRefs.current[lastId];
            if (rowEl) {
              rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            // Restore right-pane scroll position
            if (tablePaneRef.current && data.session.scroll_position > 0) {
              tablePaneRef.current.scrollTop = data.session.scroll_position;
            }
          }, 400);
        }
      } catch {
        // No session — first visit, nothing to restore
      }
    })();
  }, [contractId]);

  // Auto-save session every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      saveSession(activeParamId);
    }, 60_000);
    return () => clearInterval(interval);
  }, [activeParamId, saveSession]);

  // Track scroll position in the right pane
  const handleTableScroll = useCallback(() => {
    scrollPositionRef.current = tablePaneRef.current?.scrollTop ?? 0;
  }, []);

  // Fetch contract details
  const { data: contractData } = useQuery({
    queryKey: ['contract-details', contractId],
    queryFn: async () => {
      const response = await api.get(`/contracts/${contractId}`);
      return response.data;
    },
    enabled: !!contractId,
  });

  // Fetch contract draft parameters
  const { data: paramsData, isLoading } = useQuery({
    queryKey: ['contract-parameters', contractId],
    queryFn: async () => {
      const response = await api.get(`/review/${contractId}/parameters`);
      return response.data;
    },
    enabled: !!contractId,
  });

  const parameters: Parameter[] = paramsData?.parameters || [];

  // Mutation for updating parameter inline
  const updateParamMutation = useMutation({
    mutationFn: async ({ paramId, editedValue, status }: { paramId: string, editedValue: string, status: string }) => {
      setSaveStatus('Saving changes...');
      const response = await api.put(`/review/${contractId}/parameters/${paramId}`, {
        edited_value: editedValue,
        reviewer_status: status
      });
      return response.data;
    },
    onSuccess: (_, variables) => {
      setSaveStatus('All changes saved');
      queryClient.invalidateQueries({ queryKey: ['contract-parameters', contractId] });
      // Save session after every action
      saveSession(variables.paramId);
    },
    onError: () => {
      setSaveStatus('Error saving changes');
    }
  });

  // Mutation for submitting for head approval
  const submitForApprovalMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/review/${contractId}/submit`);
      return response.data;
    },
    onSuccess: () => {
      navigate('/dashboard');
    }
  });

  const handleParamValueChange = (paramId: string, originalValue: string, newValue: string) => {
    // Mark as EDITED if different from original, else ACCEPTED
    const status = newValue === originalValue ? 'ACCEPTED' : 'EDITED';
    updateParamMutation.mutate({
      paramId,
      editedValue: newValue,
      status
    });
  };

  const handleReviewStatus = (paramId: string, currentValue: string, status: 'ACCEPTED' | 'REJECTED') => {
    updateParamMutation.mutate({
      paramId,
      editedValue: currentValue,
      status
    });
  };


  return (
    <main className="flex-1 flex overflow-hidden min-h-[calc(100vh-3.5rem)]">
      
      {/* Left Pane: PDF Viewer */}
      <section className="w-1/2 bg-surface-container border-r border-outline-variant flex flex-col overflow-hidden">
        {/* PDF Header Sub-nav */}
        <div className="h-10 border-b border-outline-variant bg-surface flex items-center justify-between px-md shrink-0">
          <div className="flex items-center gap-sm">
            <span className="font-label-md text-label-md text-primary font-bold truncate max-w-[220px]">
              {contractData?.filename || 'contract_preview.pdf'}
            </span>
            <span className="bg-surface-container-highest text-on-surface-variant px-xs rounded text-[10px] uppercase font-bold tracking-wider">
              OCR Grounded
            </span>
          </div>
          <span className="text-[11px] font-bold text-slate-400 font-mono">PDF.JS INTEGRATION</span>
        </div>
        
        {contractId && (
          <PDFViewer
            contractId={contractId}
            activeParamId={activeParamId}
            parameters={parameters}
            onParamClick={setActiveParamId}
          />
        )}
      </section>

      {/* Right Pane: Extracted Metadata Verification Table */}
      <section className="w-1/2 flex flex-col bg-white overflow-hidden">
        {/* Table Header Bar */}
        <div className="h-10 bg-white border-b border-outline-variant px-md flex items-center shrink-0 justify-between">
          <span className="font-label-md text-label-md text-primary font-bold">EXTRACTED METADATA VERIFICATION</span>
          <div className="flex gap-xs">
            <span className="flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-700 text-[10px] font-bold rounded-full border border-green-200">
              {parameters.filter(p => p.reviewer_status === 'ACCEPTED').length} VALIDATED
            </span>
            <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 text-[10px] font-bold rounded-full border border-amber-200">
              {parameters.filter(p => !p.reviewer_status).length} PENDING
            </span>
          </div>
        </div>

        {/* Table List Scroll Area */}
        <div
          ref={tablePaneRef}
          onScroll={handleTableScroll}
          className="flex-1 overflow-auto custom-scrollbar"
        >
          {isLoading ? (
            <div className="text-center py-20 text-on-surface-variant font-body-md">Querying parameters...</div>
          ) : parameters.length === 0 ? (
            <div className="text-center py-20 text-on-surface-variant font-body-md">No parameter logic defined for this contract.</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-surface-container-low z-10 border-b border-outline-variant">
                <tr>
                  <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase w-1/4 font-bold">Parameter</th>
                  <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase w-1/3 font-bold">Extracted Info (Model)</th>
                  <th className="px-md py-3 font-label-md text-label-md text-on-surface-variant uppercase w-1/3 font-bold">Verify / Edit</th>
                  <th className="px-md py-3 w-12 font-bold text-center">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                {parameters.map((param) => (
                  <tr 
                    key={param.param_id}
                    ref={el => paramRefs.current[param.param_id] = el}
                    onClick={() => setActiveParamId(param.param_id)}
                    className={`hover:bg-surface-container-low transition-colors group cursor-pointer ${
                      activeParamId === param.param_id ? 'bg-primary-fixed/20 border-l-4 border-l-primary' : ''
                    } ${param.reviewer_status === 'REJECTED' ? 'bg-red-50/20' : ''}`}
                  >
                    {/* Parameter Head */}
                    <td className="px-md py-3">
                      <div className="flex flex-col">
                        <span className="font-label-md text-label-md text-primary font-bold">{param.parameter_name}</span>
                        <span className="text-[10px] text-on-surface-variant font-mono uppercase tracking-tight">
                          {param.parameter_group}
                        </span>
                      </div>
                    </td>

                    {/* Original Value */}
                    <td className="px-md py-3">
                      <div className="font-mono-md text-mono-md text-on-surface-variant max-w-[150px] truncate" title={param.extracted_value}>
                        {param.extracted_value || 'Not extracted'}
                      </div>
                    </td>

                    {/* Editable / Verified Value */}
                    <td className="px-md py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-xs">
                        <input 
                          type="text"
                          value={param.edited_value !== null ? param.edited_value : (param.extracted_value || '')}
                          onChange={(e) => handleParamValueChange(param.param_id, param.extracted_value || '', e.target.value)}
                          className={`w-full h-8 px-2 bg-surface-container-lowest border rounded text-body-sm focus:border-primary focus:ring-0 ${
                            param.reviewer_status === 'EDITED' 
                              ? 'border-amber-400 font-bold bg-amber-50/10' 
                              : 'border-outline-variant'
                          }`}
                        />
                        {/* Clear Override */}
                        {param.reviewer_status === 'EDITED' && (
                          <button 
                            onClick={() => handleParamValueChange(param.param_id, param.extracted_value || '', param.extracted_value || '')}
                            className="p-1 hover:bg-surface-container-high rounded text-on-surface-variant"
                            title="Reset to Original"
                          >
                            <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Confidence / Review Actions */}
                    <td className="px-md py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-xs">
                        {param.reviewer_status === 'ACCEPTED' ? (
                          <span className="material-symbols-outlined text-green-600 font-bold" title="Accepted">check_circle</span>
                        ) : param.reviewer_status === 'REJECTED' ? (
                          <span className="material-symbols-outlined text-error font-bold" title="Flagged Issues">error</span>
                        ) : (
                          <span className={`px-xs py-0.5 rounded text-[10px] font-bold ${
                            param.confidence >= 0.9 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {Math.round(param.confidence * 100)}%
                          </span>
                        )}
                        
                        {/* Quick review action buttons */}
                        <div className="hidden group-hover:flex items-center gap-xs ml-xs border-l border-outline-variant pl-xs">
                          <button 
                            onClick={() => handleReviewStatus(param.param_id, param.edited_value || param.extracted_value || '', 'ACCEPTED')}
                            className="p-0.5 hover:bg-emerald-100 hover:text-emerald-800 rounded transition-colors"
                            title="Accept"
                          >
                            <span className="material-symbols-outlined text-[16px]">done</span>
                          </button>
                          <button 
                            onClick={() => handleReviewStatus(param.param_id, param.edited_value || param.extracted_value || '', 'REJECTED')}
                            className="p-0.5 hover:bg-red-100 hover:text-error rounded transition-colors"
                            title="Flag Issues"
                          >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Sticky Footer Action Bar */}
        <div className="border-t border-outline-variant p-lg flex items-center justify-between bg-surface-container-lowest shrink-0">
          <div className="flex items-center gap-sm text-on-surface-variant">
            <span className="material-symbols-outlined text-md">
              {saveStatus.includes('Saving') ? 'autorenew' : 'done'}
            </span>
            <span className="text-body-sm font-bold font-mono">{saveStatus}</span>
          </div>

          <div className="flex gap-md">
            <button 
              onClick={() => navigate('/dashboard')}
              className="px-lg py-2 border border-outline text-primary font-label-md text-label-md rounded-lg hover:bg-surface-container-high transition-all font-bold"
            >
              Exit Review
            </button>
            <button 
              onClick={() => submitForApprovalMutation.mutate()}
              disabled={submitForApprovalMutation.isPending}
              className="px-xl py-2 bg-primary text-on-primary font-label-md text-label-md rounded-lg shadow-sm hover:opacity-90 active:scale-95 transition-all font-bold disabled:opacity-50"
            >
              {submitForApprovalMutation.isPending ? 'Submitting...' : 'Submit for Approval'}
            </button>
          </div>
        </div>
      </section>

    </main>
  );
}
