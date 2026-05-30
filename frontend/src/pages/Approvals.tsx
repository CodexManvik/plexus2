import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';

interface PendingContract {
  contract_id: string;
  original_filename: string;
  customer_name: string;
  contract_type: string;
  uploaded_by: string;
  uploaded_at: string;
}

export default function Approvals() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);

  // Rejection Modal state
  const [rejectingContract, setRejectingContract] = useState<PendingContract | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  
  // Approval Modal state
  const [approvingContract, setApprovingContract] = useState<PendingContract | null>(null);
  const [approvalComments, setApprovalComments] = useState('');

  // Active filter tab: 'all' | 'pending' | 'urgent'
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'urgent'>('pending');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch pending contracts
  const { data, isLoading, error } = useQuery({
    queryKey: ['pending-approvals'],
    queryFn: async () => {
      const response = await api.get('/approval/pending');
      return response.data;
    },
    enabled: user?.role === 'operation_head' || user?.role === 'admin',
  });

  // Action mutations
  const approveMutation = useMutation({
    mutationFn: async ({ contractId, comments }: { contractId: string; comments?: string }) => {
      const response = await api.post(`/approval/${contractId}/approve`, {
        comments: comments || 'Approved by Operations Head'
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['contracts-list'] });
      setApprovingContract(null);
      setApprovalComments('');
    },
    onError: (err: any) => {
      alert(`Approval failed: ${err?.response?.data?.detail || err.message}`);
    }
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ contractId, reason }: { contractId: string; reason: string }) => {
      const response = await api.post(`/approval/${contractId}/reject`, {
        reason
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['contracts-list'] });
      setRejectingContract(null);
      setRejectionReason('');
    },
    onError: (err: any) => {
      alert(`Rejection failed: ${err?.response?.data?.detail || err.message}`);
    }
  });

  if (user?.role !== 'operation_head' && user?.role !== 'admin') {
    return (
      <div className="p-lg max-w-[800px] mx-auto text-center mt-12">
        <div className="bg-surface-container-lowest border border-outline-variant p-xl rounded-xl shadow-sm">
          <span className="material-symbols-outlined text-[64px] text-error mb-md">gated_admin_protection</span>
          <h2 className="font-headline-lg text-headline-lg text-primary mb-sm">Access Restricted</h2>
          <p className="text-on-surface-variant font-body-md">
            This workspace is reserved for Operations Heads and System Administrators. Please contact your operations supervisor for approval queue access.
          </p>
        </div>
      </div>
    );
  }

  const contractsList: PendingContract[] = data?.pending || [];

  // Filter list based on tabs and search query
  const filteredContracts = contractsList.filter((c) => {
    const titleMatch = (c.original_filename || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                       (c.customer_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                       (c.contract_type || '').toLowerCase().includes(searchQuery.toLowerCase());
                       
    if (!titleMatch) return false;
    
    if (activeTab === 'pending') {
      return true; // All fetched are pending
    }
    if (activeTab === 'urgent') {
      // Logic for urgent: contains MSA, Master, or uploaded more than 3 days ago
      const isMsa = (c.contract_type || '').toLowerCase().includes('msa') || 
                    (c.original_filename || '').toLowerCase().includes('master') ||
                    (c.original_filename || '').toLowerCase().includes('msa');
      return isMsa;
    }
    return true;
  });

  const getUrgentCount = () => {
    return contractsList.filter(c => 
      (c.contract_type || '').toLowerCase().includes('msa') || 
      (c.original_filename || '').toLowerCase().includes('master') ||
      (c.original_filename || '').toLowerCase().includes('msa')
    ).length;
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }) + ' · ' + date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="p-lg flex-1 flex flex-col h-[calc(100vh-56px)] max-w-[1400px] mx-auto w-full overflow-hidden">
      {/* Page Header */}
      <div className="flex justify-between items-end mb-lg">
        <div>
          <h1 className="font-display-sm text-display-sm text-primary">Approval Queue</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">Review and manage pending legal agreements.</p>
        </div>
        
        {/* State Tabs */}
        <div className="flex gap-sm">
          <div className="bg-surface-container-low rounded-lg p-xs flex gap-xs border border-outline-variant">
            <button 
              onClick={() => setActiveTab('pending')}
              className={`px-md py-1 rounded font-label-md text-label-md transition-all ${
                activeTab === 'pending'
                  ? 'bg-surface-container-lowest shadow-sm text-primary font-bold'
                  : 'hover:bg-surface-container-high text-on-surface-variant'
              }`}
            >
              Pending ({contractsList.length})
            </button>
            <button 
              onClick={() => setActiveTab('urgent')}
              className={`px-md py-1 rounded font-label-md text-label-md transition-all ${
                activeTab === 'urgent'
                  ? 'bg-surface-container-lowest shadow-sm text-primary font-bold'
                  : 'hover:bg-surface-container-high text-on-surface-variant'
              }`}
            >
              Urgent ({getUrgentCount()})
            </button>
            <button 
              onClick={() => setActiveTab('all')}
              className={`px-md py-1 rounded font-label-md text-label-md transition-all ${
                activeTab === 'all'
                  ? 'bg-surface-container-lowest shadow-sm text-primary font-bold'
                  : 'hover:bg-surface-container-high text-on-surface-variant'
              }`}
            >
              All ({contractsList.length})
            </button>
          </div>
        </div>
      </div>

      {/* Main Table Container */}
      <div className="flex-1 bg-surface-container-lowest rounded-xl border border-outline-variant flex flex-col shadow-sm overflow-hidden mb-md">
        {/* Table Toolbar */}
        <div className="px-lg py-sm border-b border-outline-variant flex items-center justify-between bg-surface-container-low/30">
          <div className="flex items-center gap-md">
            <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Queue Priority</span>
            <div className="h-4 w-[1px] bg-outline-variant"></div>
            
            {/* Local Search input */}
            <div className="relative">
              <span className="absolute left-sm top-1/2 -translate-y-1/2 material-symbols-outlined text-outline text-[18px]">search</span>
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search queue..." 
                className="pl-xl pr-md py-xs bg-surface-container-low border-none rounded-lg text-body-sm focus:ring-1 focus:ring-primary w-64 transition-all"
              />
            </div>
          </div>
          <div className="text-body-sm text-on-surface-variant font-mono">
            Showing {filteredContracts.length} contract{filteredContracts.length !== 1 ? 's' : ''} pending approval
          </div>
        </div>

        {/* Scrollable Table Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-64 gap-sm text-on-surface-variant">
              <span className="material-symbols-outlined animate-spin text-[48px]">sync</span>
              <span className="font-label-md">Loading approval queue from Oracle 26ai...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-64 gap-sm text-error">
              <span className="material-symbols-outlined text-[48px]">error</span>
              <span className="font-label-md">Failed to retrieve pending approvals</span>
            </div>
          ) : filteredContracts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-xs text-on-surface-variant text-center p-lg">
              <span className="material-symbols-outlined text-[48px] text-outline mb-sm">fact_check</span>
              <h3 className="font-headline-md text-headline-md text-primary">Queue Clear</h3>
              <p className="font-body-md text-on-surface-variant max-w-[400px]">
                There are no pending legal agreements in this section requiring review. Everything has been processed!
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-surface-container-lowest z-10 border-b border-outline-variant">
                <tr className="bg-surface-container-lowest">
                  <th className="pl-lg py-md font-label-md text-label-md text-on-surface-variant uppercase">Contract Title</th>
                  <th className="px-lg py-md font-label-md text-label-md text-on-surface-variant uppercase">Organization</th>
                  <th className="px-lg py-md font-label-md text-label-md text-on-surface-variant uppercase">Type</th>
                  <th className="px-lg py-md font-label-md text-label-md text-on-surface-variant uppercase">Submission Date</th>
                  <th className="px-lg py-md font-label-md text-label-md text-on-surface-variant uppercase">Status</th>
                  <th className="pr-lg py-md font-label-md text-label-md text-on-surface-variant uppercase text-right w-36">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {filteredContracts.map((contract) => {
                  const isUrgent = (contract.contract_type || '').toLowerCase().includes('msa') || 
                                   (contract.original_filename || '').toLowerCase().includes('master');
                                   
                  return (
                    <tr 
                      key={contract.contract_id}
                      className={`hover:bg-surface-container-low/40 transition-colors group border-l-4 ${
                        isUrgent ? 'border-l-error' : 'border-l-transparent'
                      }`}
                    >
                      {/* Contract Title */}
                      <td className="pl-lg py-md">
                        <div className="flex items-center gap-sm">
                          <span className="material-symbols-outlined text-primary text-[20px]">
                            {isUrgent ? 'warning' : 'description'}
                          </span>
                          <span 
                            onClick={() => navigate(`/review/${contract.contract_id}`)}
                            className="font-body-md font-bold text-primary hover:underline cursor-pointer transition-all"
                          >
                            {contract.original_filename || 'Unnamed Contract'}
                          </span>
                        </div>
                      </td>

                      {/* Organization */}
                      <td className="px-lg py-md font-body-md text-on-surface">
                        {contract.customer_name || 'N/A'}
                      </td>

                      {/* Contract Type */}
                      <td className="px-lg py-md">
                        <span className="bg-secondary-container text-on-secondary-container px-sm py-0.5 rounded text-[11px] font-bold uppercase tracking-wider">
                          {contract.contract_type || 'General'}
                        </span>
                      </td>

                      {/* Submission Date */}
                      <td className="px-lg py-md font-body-sm text-on-surface-variant">
                        {formatDate(contract.uploaded_at)}
                      </td>

                      {/* Status */}
                      <td className="px-lg py-md">
                        <div className="flex items-center gap-xs text-amber-700 bg-amber-50 border border-amber-200 px-sm py-0.5 rounded-full w-fit">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                          <span className="font-label-md text-[11px] font-bold">Pending Review</span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="pr-lg py-md text-right">
                        <div className="flex justify-end gap-xs opacity-80 group-hover:opacity-100 transition-opacity">
                          {/* View details */}
                          <button 
                            onClick={() => navigate(`/review/${contract.contract_id}`)}
                            className="p-1 hover:bg-primary-fixed hover:text-primary rounded transition-colors text-on-surface-variant"
                            title="Open Workspace Review"
                          >
                            <span className="material-symbols-outlined text-[20px]">visibility</span>
                          </button>
                          
                          {/* Reject / Send Back */}
                          <button 
                            onClick={() => setRejectingContract(contract)}
                            className="p-1 hover:bg-error-container hover:text-on-error-container rounded transition-colors text-on-surface-variant"
                            title="Reject & Send Back"
                          >
                            <span className="material-symbols-outlined text-[20px]">undo</span>
                          </button>
                          
                          {/* Quick Approve */}
                          <button 
                            onClick={() => setApprovingContract(contract)}
                            className="p-1 bg-primary text-on-primary rounded hover:opacity-90 transition-all shadow-sm flex items-center justify-center"
                            title="Approve & Publish"
                          >
                            <span className="material-symbols-outlined text-[20px] text-white">check_circle</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* REJECTION MODAL */}
      {rejectingContract && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-md">
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg max-w-[500px] w-full shadow-2xl flex flex-col gap-md">
            <div>
              <div className="flex items-center gap-sm text-error mb-xs">
                <span className="material-symbols-outlined text-[28px]">undo</span>
                <h3 className="font-headline-lg text-headline-lg font-bold text-primary">Reject & Send Back</h3>
              </div>
              <p className="text-on-surface-variant font-body-sm">
                You are returning <strong className="text-primary">{rejectingContract.original_filename}</strong> to the Operations user for revision.
              </p>
            </div>

            <div className="space-y-xs">
              <label className="font-label-md text-label-md text-primary block">Rejection Reason / Comments</label>
              <textarea 
                rows={4}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Specify what needs to be edited or corrected (e.g., Liability Cap has incorrect grounding reference on Page 4)."
                className="w-full bg-surface-container-low border-none rounded-lg p-sm font-body-sm text-on-surface focus:ring-1 focus:ring-primary focus:outline-none resize-none"
              />
            </div>

            <div className="flex justify-end gap-sm pt-sm border-t border-outline-variant">
              <button 
                onClick={() => {
                  setRejectingContract(null);
                  setRejectionReason('');
                }}
                className="px-md py-sm border border-outline-variant rounded-lg font-label-md text-label-md hover:bg-surface-container-low text-on-surface transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  if (!rejectionReason.trim()) {
                    alert('Please provide a reason for returning this contract.');
                    return;
                  }
                  rejectMutation.mutate({
                    contractId: rejectingContract.contract_id,
                    reason: rejectionReason
                  });
                }}
                disabled={rejectMutation.isPending}
                className="px-md py-sm bg-error text-on-error rounded-lg font-label-md text-label-md shadow-sm hover:opacity-90 active:scale-95 transition-all flex items-center gap-xs"
              >
                {rejectMutation.isPending ? 'Sending...' : 'Confirm Return'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* APPROVAL MODAL */}
      {approvingContract && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-md">
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-lg max-w-[500px] w-full shadow-2xl flex flex-col gap-md">
            <div>
              <div className="flex items-center gap-sm text-primary mb-xs">
                <span className="material-symbols-outlined text-[28px]" style={{ fontVariationSettings: '"FILL" 1' }}>check_circle</span>
                <h3 className="font-headline-lg text-headline-lg font-bold text-primary">Approve & Publish</h3>
              </div>
              <p className="text-on-surface-variant font-body-sm">
                You are approving <strong className="text-primary">{approvingContract.original_filename}</strong>. This will promote all verified parameters to the published corpus.
              </p>
            </div>

            <div className="space-y-xs">
              <label className="font-label-md text-label-md text-primary block">Approval Comments (Optional)</label>
              <textarea 
                rows={3}
                value={approvalComments}
                onChange={(e) => setApprovalComments(e.target.value)}
                placeholder="Optional approval notes or audit logs to attach."
                className="w-full bg-surface-container-low border-none rounded-lg p-sm font-body-sm text-on-surface focus:ring-1 focus:ring-primary focus:outline-none resize-none"
              />
            </div>

            <div className="flex justify-end gap-sm pt-sm border-t border-outline-variant">
              <button 
                onClick={() => {
                  setApprovingContract(null);
                  setApprovalComments('');
                }}
                className="px-md py-sm border border-outline-variant rounded-lg font-label-md text-label-md hover:bg-surface-container-low text-on-surface transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  approveMutation.mutate({
                    contractId: approvingContract.contract_id,
                    comments: approvalComments
                  });
                }}
                disabled={approveMutation.isPending}
                className="px-md py-sm bg-primary text-on-primary rounded-lg font-label-md text-label-md shadow-sm hover:opacity-90 active:scale-95 transition-all flex items-center gap-xs"
              >
                {approveMutation.isPending ? 'Publishing...' : 'Approve & Publish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
