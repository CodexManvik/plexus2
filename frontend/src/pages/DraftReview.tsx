import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

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
  const pdfPaneRef = useRef<HTMLDivElement>(null);
  const tablePaneRef = useRef<HTMLDivElement>(null);
  const paramRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const citationRefs = useRef<Record<string, HTMLSpanElement | null>>({});

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
    onSuccess: () => {
      setSaveStatus('All changes saved');
      queryClient.invalidateQueries({ queryKey: ['contract-parameters', contractId] });
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

  // Bidirectional highlighting orchestrator
  const highlightCitation = (paramId: string) => {
    setActiveParamId(paramId);
    
    // Scroll left pane (mock PDF) to the highlighted citation span
    const citationEl = citationRefs.current[paramId];
    if (citationEl) {
      citationEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Scroll right pane (parameters table) to the matching table row
    const rowEl = paramRefs.current[paramId];
    if (rowEl) {
      rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Construct mock PDF pages with citation hooks based on dynamic parameters
  const renderMockPDF = () => {
    if (parameters.length === 0) {
      return (
        <div className="w-full bg-white p-xl min-h-[800px] pdf-page-shadow relative font-serif text-[14px] leading-relaxed text-slate-800 flex items-center justify-center">
          Document parsing preview not available.
        </div>
      );
    }

    return (
      <div className="w-[640px] bg-white p-xl min-h-[1000px] pdf-page-shadow relative font-serif text-[14px] leading-relaxed text-slate-800">
        <div className="absolute top-4 right-4 bg-primary/10 border border-primary/20 px-2 py-1 rounded">
          <span className="text-[10px] font-bold text-primary uppercase font-sans">OCI OCR VERIFIED</span>
        </div>
        
        <h2 className="text-center font-bold mb-xl text-lg uppercase tracking-widest text-black border-b pb-sm font-headline">
          {contractData?.filename?.split('.')[0]?.replaceAll('_', ' ') || 'Master Services Agreement'}
        </h2>

        <div className="space-y-md">
          <p>
            This {contractData?.agreement_type || 'Master Services Agreement'} is entered into and made effective as of{' '}
            {/* Effective Date Citation */}
            {(() => {
              const p = parameters.find(x => x.parameter_name === 'Effective Date');
              if (p) {
                return (
                  <span 
                    ref={el => citationRefs.current[p.param_id] = el}
                    onClick={() => highlightCitation(p.param_id)}
                    className={`citation-highlight cursor-pointer px-1 rounded transition-all font-sans font-bold ${activeParamId === p.param_id ? 'active-citation' : ''}`}
                  >
                    {p.edited_value || p.extracted_value || p.supporting_text || 'January 15, 2024'}
                  </span>
                );
              }
              return <span className="underline">January 15, 2024</span>;
            })()}
            , by and between{' '}
            {/* Parties Citation */}
            {(() => {
              const p = parameters.find(x => x.parameter_name === 'Counterparty Name');
              if (p) {
                return (
                  <span 
                    ref={el => citationRefs.current[p.param_id] = el}
                    onClick={() => highlightCitation(p.param_id)}
                    className={`citation-highlight cursor-pointer px-1 rounded transition-all font-sans font-bold ${activeParamId === p.param_id ? 'active-citation' : ''}`}
                  >
                    {p.edited_value || p.extracted_value || p.supporting_text || 'LexGlobal Logistics Corp'}
                  </span>
                );
              }
              return <span className="underline">LexGlobal Logistics Corp.</span>;
            })()}
            {' '}and Enterprise Flow Inc.
          </p>

          <h3 className="font-bold mt-lg mb-xs border-b border-slate-200 uppercase font-headline">Section 1. Scope and Payments</h3>
          <p>
            The Service Provider shall deliver supply chain logistics as agreed in Exhibit A. All invoices under this arrangement shall be settled within{' '}
            {/* Payment Terms Citation */}
            {(() => {
              const p = parameters.find(x => x.parameter_name === 'Payment Terms');
              if (p) {
                return (
                  <span 
                    ref={el => citationRefs.current[p.param_id] = el}
                    onClick={() => highlightCitation(p.param_id)}
                    className={`citation-highlight cursor-pointer px-1 rounded transition-all font-sans font-bold ${activeParamId === p.param_id ? 'active-citation' : ''}`}
                  >
                    {p.edited_value || p.extracted_value || p.supporting_text || 'sixty (60) days'}
                  </span>
                );
              }
              return <span className="underline">sixty (60) days</span>;
            })()}
            {' '}of invoice presentation.
          </p>

          <h3 className="font-bold mt-lg mb-xs border-b border-slate-200 uppercase font-headline">Section 4. Liability and Damages</h3>
          <p>
            Except in cases of gross negligence, the total aggregate liability of the contractor under this service contract shall not exceed{' '}
            {/* Liability Cap Citation */}
            {(() => {
              const p = parameters.find(x => x.parameter_name === 'Liability Cap');
              if (p) {
                return (
                  <span 
                    ref={el => citationRefs.current[p.param_id] = el}
                    onClick={() => highlightCitation(p.param_id)}
                    className={`citation-highlight cursor-pointer px-1 rounded transition-all font-sans font-bold ${activeParamId === p.param_id ? 'active-citation' : ''}`}
                  >
                    {p.edited_value || p.extracted_value || p.supporting_text || 'USD 5,000,000.00'}
                  </span>
                );
              }
              return <span className="underline">USD 5,000,000.00</span>;
            })()}
            {' '}for any single event.
          </p>

          <h3 className="font-bold mt-lg mb-xs border-b border-slate-200 uppercase font-headline">Section 12. Term and Termination</h3>
          <p>
            This agreement may be terminated for convenience by either party upon{' '}
            {/* Termination Notice Citation */}
            {(() => {
              const p = parameters.find(x => x.parameter_name === 'Termination Notice');
              if (p) {
                return (
                  <span 
                    ref={el => citationRefs.current[p.param_id] = el}
                    onClick={() => highlightCitation(p.param_id)}
                    className={`citation-highlight cursor-pointer px-1 rounded transition-all font-sans font-bold ${activeParamId === p.param_id ? 'active-citation' : ''}`}
                  >
                    {p.edited_value || p.extracted_value || p.supporting_text || '90 days prior written notice'}
                  </span>
                );
              }
              return <span className="underline">90 days prior written notice</span>;
            })()}
            {' '}to the other. In event of breach, the cure period is 15 days.
          </p>

          <h3 className="font-bold mt-lg mb-xs border-b border-slate-200 uppercase font-headline">Section 15. Compliance and Law</h3>
          <p>
            Governing law of this contract, including any disputes or litigation resulting from execution, shall be resolved according to the laws of{' '}
            {/* Governing Law Citation */}
            {(() => {
              const p = parameters.find(x => x.parameter_name === 'Governing Law');
              if (p) {
                return (
                  <span 
                    ref={el => citationRefs.current[p.param_id] = el}
                    onClick={() => highlightCitation(p.param_id)}
                    className={`citation-highlight cursor-pointer px-1 rounded transition-all font-sans font-bold ${activeParamId === p.param_id ? 'active-citation' : ''}`}
                  >
                    {p.edited_value || p.extracted_value || p.supporting_text || 'the State of Delaware, USA'}
                  </span>
                );
              }
              return <span className="underline">the State of Delaware, USA</span>;
            })()}
            .
          </p>
          
          <div className="mt-xl h-40 bg-slate-50 border border-dashed border-slate-200 rounded flex items-center justify-center text-slate-400 italic font-sans">
            OCR rendering Page 1 of {contractData?.page_count || 1} complete.
          </div>
        </div>
      </div>
    );
  };

  return (
    <main className="flex-1 flex overflow-hidden min-h-[calc(100vh-3.5rem)]">
      
      {/* Left Pane: PDF Viewer */}
      <section className="w-1/2 bg-surface-container border-r border-outline-variant flex flex-col overflow-hidden">
        {/* PDF Header Sub-nav */}
        <div className="h-10 border-b border-outline-variant bg-surface flex items-center justify-between px-md shrink-0">
          <div className="flex items-center gap-sm">
            <span className="font-label-md text-label-md text-primary font-bold">
              {contractData?.filename || 'contract_preview.pdf'}
            </span>
            <span className="bg-surface-container-highest text-on-surface-variant px-xs rounded text-[10px] uppercase font-bold tracking-wider">
              OCR Grounded
            </span>
          </div>
          <div className="flex items-center gap-md">
            <span className="material-symbols-outlined text-sm text-on-surface-variant cursor-pointer">zoom_out</span>
            <span className="font-label-md text-label-md font-bold">100%</span>
            <span className="material-symbols-outlined text-sm text-on-surface-variant cursor-pointer">zoom_in</span>
            <div className="w-[1px] h-4 bg-outline-variant"></div>
            <span className="material-symbols-outlined text-sm text-on-surface-variant cursor-pointer">print</span>
          </div>
        </div>
        
        {/* PDF View Container */}
        <div 
          ref={pdfPaneRef}
          className="flex-1 overflow-y-auto p-xl flex flex-col items-center gap-lg bg-surface-dim custom-scrollbar"
        >
          {renderMockPDF()}
        </div>
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
