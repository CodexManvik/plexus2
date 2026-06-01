import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import DocumentViewer from '../components/pdf/DocumentViewer';

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
        <div className="h-12 border-b border-outline-variant bg-surface-container-low flex items-center justify-between px-lg shrink-0 shadow-sm select-none">
          <div className="flex items-center gap-sm">
            <span className="material-symbols-outlined text-primary text-md">description</span>
            <span className="text-xs font-semibold tracking-wide text-primary truncate max-w-[220px]">
              {contractData?.filename || 'contract.pdf'}
            </span>
            <span className="flex items-center gap-1.5 px-2 py-0.5 bg-primary-fixed text-primary text-[9px] font-extrabold rounded-full border border-primary/10">
              {contractData?.filename?.endsWith('.docx') ? 'DOCX' : contractData?.filename?.endsWith('.xlsx') ? 'XLSX' : 'PDF'}
            </span>
          </div>
          <span className="text-[10px] font-bold text-slate-400 font-mono tracking-widest uppercase">Viewer v2.0</span>
        </div>
        
        {contractId && (
          <DocumentViewer
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
        <div className="h-12 bg-surface-container-low border-b border-outline-variant px-lg flex items-center shrink-0 justify-between shadow-sm select-none">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-md">verified_user</span>
            <span className="text-xs font-bold tracking-wider uppercase text-primary">EXTRACTED METADATA VERIFICATION</span>
          </div>
          <div className="flex gap-2">
            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-extrabold rounded-full border border-emerald-200 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              {parameters.filter(p => p.reviewer_status === 'ACCEPTED').length} VALIDATED
            </span>
            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-700 text-[10px] font-extrabold rounded-full border border-amber-200 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
              {parameters.filter(p => !p.reviewer_status).length} PENDING
            </span>
          </div>
        </div>

        {/* Table List Scroll Area */}
        <div
          ref={tablePaneRef}
          onScroll={handleTableScroll}
          className="flex-1 overflow-auto custom-scrollbar bg-slate-50/50"
        >
          {isLoading ? (
            <div className="w-full flex flex-col items-center justify-center py-20 gap-md text-on-surface-variant">
              <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin"></div>
              <p className="font-medium text-sm">Querying parameters...</p>
            </div>
          ) : parameters.length === 0 ? (
            <div className="text-center py-20 text-on-surface-variant font-medium text-sm">No parameter logic defined for this contract.</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-surface-container-low z-10 border-b border-outline-variant shadow-sm select-none">
                <tr>
                  <th className="px-md py-3 font-bold text-[11px] text-primary uppercase w-1/4 tracking-wider">Parameter</th>
                  <th className="px-md py-3 font-bold text-[11px] text-primary uppercase w-1/3 tracking-wider">Extracted Info (Model)</th>
                  <th className="px-md py-3 font-bold text-[11px] text-primary uppercase w-1/3 tracking-wider">Verify / Edit</th>
                  <th className="px-md py-3 w-12 font-bold text-center text-[11px] tracking-wider text-primary">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/20 bg-white">
                {parameters.map((param) => (
                  <tr 
                    key={param.param_id}
                    ref={el => paramRefs.current[param.param_id] = el}
                    onClick={() => setActiveParamId(param.param_id)}
                    className={`hover:bg-primary-fixed/5 transition-all duration-200 group cursor-pointer ${
                      activeParamId === param.param_id 
                        ? 'bg-gradient-to-r from-primary-fixed/30 to-transparent border-l-4 border-l-primary shadow-sm' 
                        : ''
                    } ${param.reviewer_status === 'REJECTED' ? 'bg-red-50/10' : ''}`}
                  >
                    {/* Parameter Head */}
                    <td className="px-md py-4">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-xs text-primary">{param.parameter_name}</span>
                          {!param.grounding && param.extracted_value && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200" title="Extracted from text, but specific paragraph location in PDF could not be determined.">
                              Ungrounded
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] text-on-surface-variant font-mono uppercase tracking-widest mt-0.5 opacity-80">
                          {param.parameter_group}
                        </span>
                      </div>
                    </td>

                    {/* Original Value */}
                    <td className="px-md py-4">
                      <div 
                        className={`font-mono text-xs max-w-[180px] truncate ${
                          param.extracted_value ? 'text-on-surface-variant' : 'text-slate-400 italic'
                        }`} 
                        title={param.extracted_value}
                      >
                        {param.extracted_value || 'Not extracted'}
                      </div>
                    </td>

                    {/* Editable / Verified Value */}
                    <td className="px-md py-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <input 
                          type="text"
                          value={param.edited_value !== null ? param.edited_value : (param.extracted_value || '')}
                          onChange={(e) => handleParamValueChange(param.param_id, param.extracted_value || '', e.target.value)}
                          className={`w-full h-9 px-3 bg-surface-container-lowest border rounded-md text-xs transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20 ${
                            param.reviewer_status === 'EDITED' 
                              ? 'border-amber-400 font-medium bg-amber-50/20 shadow-sm shadow-amber-100' 
                              : 'border-outline-variant hover:border-slate-400'
                          }`}
                          placeholder="Type override value..."
                        />
                        {/* Clear Override */}
                        {param.reviewer_status === 'EDITED' && (
                          <button 
                            onClick={() => handleParamValueChange(param.param_id, param.extracted_value || '', param.extracted_value || '')}
                            className="p-1.5 hover:bg-surface-container-high hover:text-primary rounded-md transition-all duration-150 active:scale-95 text-on-surface-variant"
                            title="Reset to Original"
                          >
                            <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Confidence / Review Actions */}
                    <td className="px-md py-4 text-center select-none" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-2">
                        {param.reviewer_status === 'ACCEPTED' ? (
                          <span className="material-symbols-outlined text-green-600 font-bold hover:scale-110 transition-transform" title="Accepted">check_circle</span>
                        ) : param.reviewer_status === 'REJECTED' ? (
                          <span className="material-symbols-outlined text-error font-bold hover:scale-110 transition-transform" title="Flagged Issues">error</span>
                        ) : (
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold border shadow-sm tracking-wider ${
                            param.confidence >= 0.85 
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                              : param.confidence >= 0.60
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}>
                            {Math.round(param.confidence * 100)}%
                          </span>
                        )}
                        
                        {/* Quick review action buttons */}
                        <div className="hidden group-hover:flex items-center gap-1.5 ml-2 border-l border-outline-variant/30 pl-2">
                          <button 
                            onClick={() => handleReviewStatus(param.param_id, param.edited_value || param.extracted_value || '', 'ACCEPTED')}
                            className="p-1 hover:bg-emerald-100 hover:text-emerald-800 rounded-md transition-colors active:scale-90"
                            title="Accept"
                          >
                            <span className="material-symbols-outlined text-[14px]">done</span>
                          </button>
                          <button 
                            onClick={() => handleReviewStatus(param.param_id, param.edited_value || param.extracted_value || '', 'REJECTED')}
                            className="p-1 hover:bg-red-100 hover:text-error rounded-md transition-colors active:scale-90"
                            title="Flag Issues"
                          >
                            <span className="material-symbols-outlined text-[14px]">close</span>
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
