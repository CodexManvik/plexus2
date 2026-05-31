import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

interface Contract {
  contract_id: string;
  filename: string;
  customer_name: string;
  contract_type: string;
  department: string;
  workflow_state: string;
  uploaded_at: string;
  approved_at?: string;
  published_at?: string;
}

export default function Dashboard() {
  const navigate = useNavigate();

  // Fetch live contracts from the database
  const { data, isLoading } = useQuery({
    queryKey: ['contracts-list'],
    queryFn: async () => {
      const response = await api.get('/contracts?limit=100');
      return response.data;
    },
  });

  const contractsList: Contract[] = data?.contracts || [];

  // Dynamic KPI Calculations based on live backend data
  const totalCount = contractsList.length;
  const executedCount = contractsList.filter(c => c.workflow_state === 'PUBLISHED').length;
  
  // Pending review includes drafts, user editing, and pending head approval
  const pendingReviewCount = contractsList.filter(c => 
    ['DRAFT_READY', 'USER_EDITING', 'REVIEW_PENDING', 'REJECTED'].includes(c.workflow_state)
  ).length;

  // Department backlog calculations
  const departments = ['Legal', 'Sales', 'HR', 'Procurement', 'IT'];
  const departmentBacklogs = departments.reduce((acc, dept) => {
    acc[dept] = contractsList.filter(c => 
      c.department?.toLowerCase() === dept.toLowerCase() && 
      ['DRAFT_READY', 'USER_EDITING', 'REVIEW_PENDING'].includes(c.workflow_state)
    ).length;
    return acc;
  }, {} as Record<string, number>);

  // Find max backlog for scaling the CSS chart heights
  const maxBacklog = Math.max(...Object.values(departmentBacklogs), 1);

  // State-to-badge styling map
  const getStatusBadge = (state: string) => {
    switch (state) {
      case 'PUBLISHED':
        return <span className="px-sm py-1 bg-primary text-on-primary text-[10px] font-bold rounded uppercase tracking-wider">Published</span>;
      case 'REVIEW_PENDING':
        return <span className="px-sm py-1 bg-secondary-container text-on-secondary-container text-[10px] font-bold rounded uppercase tracking-wider">In Approval</span>;
      case 'DRAFT_READY':
      case 'USER_EDITING':
        return <span className="px-sm py-1 bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold rounded uppercase tracking-wider">In Review</span>;
      case 'APPROVED':
        return <span className="px-sm py-1 bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold rounded uppercase tracking-wider">Approved</span>;
      case 'REJECTED':
        return <span className="px-sm py-1 bg-error-container text-on-error-container text-[10px] font-bold rounded uppercase tracking-wider">Rejected</span>;
      default:
        return <span className="px-sm py-1 bg-surface-container-highest text-on-surface-variant text-[10px] font-bold rounded uppercase tracking-wider">Processing</span>;
    }
  };

  const formatRelativeTime = (dateString: string) => {
    const elapsed = Date.now() - new Date(dateString).getTime();
    const mins = Math.floor(elapsed / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (mins < 60) return `${Math.max(1, mins)} mins ago`;
    if (hours < 24) return `${hours} hours ago`;
    return `${days} days ago`;
  };

  return (
    <div className="p-lg max-w-[1400px] mx-auto w-full flex-1 overflow-y-auto custom-scrollbar bg-slate-50/50">
      {/* Dashboard Header */}
      <div className="flex justify-between items-end mb-xl border-b border-slate-200/50 pb-md animate-fadeInUp">
        <div>
          <h1 className="font-display-sm text-display-sm text-primary font-black tracking-tight select-none">Executive Insights</h1>
          <p className="font-body-md text-body-md text-slate-500 font-semibold mt-xs select-none">
            Contract life-cycle metrics and real-time semantic processing audits
          </p>
        </div>
        <div className="flex gap-sm">
          <button className="bg-white border border-slate-200/70 hover:border-slate-400/50 px-md py-2 rounded-xl font-label-md text-label-md flex items-center gap-xs text-slate-600 hover:text-slate-800 hover:bg-slate-50 transition-all duration-150 select-none shadow-sm font-bold">
            <span className="material-symbols-outlined text-[18px]">calendar_today</span>
            This Quarter
          </button>
          <button 
            onClick={() => navigate('/upload')}
            className="bg-primary hover:bg-primary/95 text-on-primary px-md py-2 rounded-xl font-label-md text-label-md flex items-center gap-xs hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 shadow-sm font-bold select-none"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            New Analysis
          </button>
        </div>
      </div>

      {/* KPI Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-lg mb-xl">
        {/* KPI 1: Executed (Published) */}
        <div className="bg-white border border-slate-200/50 p-lg rounded-2xl shadow-[0_2px_8px_-3px_rgba(0,0,0,0.05),0_10px_20px_-5px_rgba(0,0,0,0.03)] hover-float transition-all duration-300 relative overflow-hidden group flex flex-col justify-between h-44 animate-fadeInUp">
          <div className="absolute top-0 right-0 w-24 h-24 bg-primary-fixed/20 rounded-full blur-2xl -mr-6 -mt-6 group-hover:bg-primary-fixed/35 transition-colors duration-300"></div>
          
          <div className="flex justify-between items-start z-10 select-none">
            <div>
              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1">Executed Contracts</p>
              <p className="font-display-sm text-[36px] font-black text-primary leading-tight">
                {isLoading ? '...' : executedCount}
              </p>
            </div>
            <div className="bg-primary-fixed text-primary p-sm rounded-xl shrink-0">
              <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: '"FILL" 1' }}>history_edu</span>
            </div>
          </div>
          <div className="mt-auto flex items-center gap-xs z-10 select-none">
            <div className="flex items-center gap-[2px] px-sm py-[2px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-bold">
              <span className="material-symbols-outlined text-[12px] font-bold">sync</span>
              <span>Active</span>
            </div>
            <span className="text-[11px] text-slate-500 font-bold">Corpus Synced with Oracle 26ai</span>
          </div>
        </div>

        {/* KPI 2: Pending Review */}
        <div className="bg-white border border-slate-200/50 p-lg rounded-2xl shadow-[0_2px_8px_-3px_rgba(0,0,0,0.05),0_10px_20px_-5px_rgba(0,0,0,0.03)] hover-float transition-all duration-300 relative overflow-hidden group flex flex-col justify-between h-44 animate-fadeInUp" style={{ animationDelay: '80ms' }}>
          <div className="absolute top-0 right-0 w-24 h-24 bg-tertiary-fixed/20 rounded-full blur-2xl -mr-6 -mt-6 group-hover:bg-tertiary-fixed/35 transition-colors duration-300"></div>
          
          <div className="flex justify-between items-start z-10 select-none">
            <div>
              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1">Pending Review</p>
              <p className="font-display-sm text-[36px] font-black text-primary leading-tight">
                {isLoading ? '...' : pendingReviewCount}
              </p>
            </div>
            <div className="bg-tertiary-fixed text-on-tertiary-fixed-variant p-sm rounded-xl shrink-0">
              <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: '"FILL" 1' }}>pending_actions</span>
            </div>
          </div>
          <div className="mt-auto z-10 w-full select-none">
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mb-1.5 shadow-inner">
              <div 
                className="bg-gradient-to-r from-blue-500 to-indigo-600 h-full rounded-full transition-all duration-700 ease-out" 
                style={{ width: `${totalCount > 0 ? (pendingReviewCount / totalCount) * 100 : 0}%` }}
              ></div>
            </div>
            <p className="text-[11px] text-slate-500 font-bold">
              {totalCount > 0 ? Math.round((pendingReviewCount / totalCount) * 100) : 0}% of indexed agreements require action
            </p>
          </div>
        </div>

        {/* KPI 3: Total Contracts */}
        <div className="bg-white border border-slate-200/50 p-lg rounded-2xl shadow-[0_2px_8px_-3px_rgba(0,0,0,0.05),0_10px_20px_-5px_rgba(0,0,0,0.03)] hover-float transition-all duration-300 relative overflow-hidden group flex flex-col justify-between h-44 animate-fadeInUp" style={{ animationDelay: '160ms' }}>
          <div className="absolute top-0 right-0 w-24 h-24 bg-slate-100 rounded-full blur-2xl -mr-6 -mt-6 group-hover:bg-slate-200/30 transition-colors duration-300"></div>
          
          <div className="flex justify-between items-start z-10 select-none">
            <div>
              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1">Total Contracts</p>
              <p className="font-display-sm text-[36px] font-black text-primary leading-tight">
                {isLoading ? '...' : totalCount}
              </p>
            </div>
            <div className="bg-slate-100 text-on-surface-variant p-sm rounded-xl shrink-0">
              <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: '"FILL" 1' }}>folder_shared</span>
            </div>
          </div>
          <div className="mt-auto flex items-center gap-xs z-10 select-none">
            <div className="flex items-center gap-[2px] px-sm py-[2px] bg-slate-100 text-slate-700 border border-slate-200 rounded-full text-[10px] font-bold">
              <span className="material-symbols-outlined text-[12px] font-bold">domain</span>
              <span>Federated</span>
            </div>
            <span className="text-[11px] text-slate-500 font-bold">Indexed across all internal business units</span>
          </div>
        </div>
      </div>

      {/* Visualization Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-lg mb-xl">
        {/* Modern Horizontal Backlog Progress Chart */}
        <div className="lg:col-span-2 bg-white border border-slate-200/50 p-lg rounded-2xl shadow-[0_2px_8px_-3px_rgba(0,0,0,0.05),0_10px_20px_-5px_rgba(0,0,0,0.03)] flex flex-col h-[400px]">
          <div className="flex justify-between items-center mb-md border-b border-slate-100 pb-sm select-none">
            <div>
              <h3 className="font-headline-md text-headline-md text-primary font-black">Department Backlog</h3>
              <p className="text-[11px] text-slate-500 font-bold">Outstanding contract extractions categorized by department</p>
            </div>
            <div className="flex gap-xs items-center px-sm py-1 bg-slate-50 border border-slate-200 rounded-lg">
              <span className="w-2.5 h-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full"></span>
              <span className="text-[11px] font-black text-slate-600">Pending Review</span>
            </div>
          </div>
          
          {/* Horizontal Progress Bars Workspace */}
          <div className="flex-grow flex flex-col justify-around py-xs pr-md">
            {departments.map((dept, index) => {
              const count = departmentBacklogs[dept] || 0;
              const pct = maxBacklog > 0 ? (count / maxBacklog) * 100 : 0;
              return (
                <div key={dept} className="space-y-xs animate-fadeInUp" style={{ animationDelay: `${index * 80}ms` }}>
                  <div className="flex justify-between items-center text-body-sm font-bold text-slate-700 select-none">
                    <span className="tracking-tight">{dept} Department</span>
                    <span className="bg-slate-100 px-sm py-[2px] rounded-lg text-[10px] font-extrabold text-slate-600">
                      {count} {count === 1 ? 'Contract' : 'Contracts'}
                    </span>
                  </div>
                  <div className="w-full bg-slate-50 h-3.5 rounded-full overflow-hidden border border-slate-200/40 shadow-inner relative group cursor-pointer">
                    <div 
                      className="bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600 h-full rounded-full transition-all duration-1000 ease-out animate-growHorizontal"
                      style={{ width: `${pct}%`, animationDelay: `${index * 100}ms` }}
                    >
                      <div className="absolute top-1/2 -translate-y-1/2 right-2 bg-slate-900 text-white text-[8px] font-black px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-md select-none">
                        {Math.round(pct)}%
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Priority-Prioritized Expiry List */}
        <div className="bg-white border border-slate-200/50 rounded-2xl shadow-[0_2px_8px_-3px_rgba(0,0,0,0.05),0_10px_20px_-5px_rgba(0,0,0,0.03)] overflow-hidden flex flex-col h-[400px]">
          <div className="p-lg border-b border-slate-100 bg-slate-50/50 select-none">
            <h3 className="font-headline-md text-headline-md text-primary font-black">Upcoming Expiries</h3>
            <p className="text-[11px] text-slate-500 font-bold">Critical renewals requiring legal assessment within 30 days</p>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 custom-scrollbar p-sm space-y-xs">
            {/* High Priority Item: Azure MSA */}
            <div className="p-md hover:bg-slate-50 border border-transparent hover:border-red-200/50 rounded-xl transition-all flex items-center justify-between group cursor-pointer bg-red-50/30">
              <div className="flex items-center gap-sm min-w-0">
                <div className="w-10 h-10 rounded-xl bg-red-100 text-red-700 flex items-center justify-center shrink-0 shadow-inner relative font-bold animate-pulseSoft">
                  <span className="material-symbols-outlined text-[20px] font-bold">assignment_late</span>
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
                </div>
                <div className="min-w-0 select-none">
                  <h4 className="font-body-md text-body-md font-extrabold text-primary truncate max-w-[140px]">Azure MSA 2024</h4>
                  <p className="text-[11px] text-slate-500 font-bold">Microsoft • $450k</p>
                </div>
              </div>
              <div className="text-right select-none">
                <p className="text-red-600 font-extrabold text-[12px] uppercase tracking-wider">2 Days Left</p>
                <p className="text-[11px] text-slate-400 font-semibold">Aug 24</p>
              </div>
            </div>
            
            {/* Medium Priority Item: Office Lease */}
            <div className="p-md hover:bg-slate-50 border border-transparent hover:border-amber-200/50 rounded-xl transition-all flex items-center justify-between group cursor-pointer bg-amber-50/20">
              <div className="flex items-center gap-sm min-w-0">
                <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 shadow-inner relative font-bold">
                  <span className="material-symbols-outlined text-[20px] font-bold">gavel</span>
                </div>
                <div className="min-w-0 select-none">
                  <h4 className="font-body-md text-body-md font-extrabold text-primary truncate max-w-[140px]">Office Lease</h4>
                  <p className="text-[11px] text-slate-500 font-bold">Apex Prop. • $12k/mo</p>
                </div>
              </div>
              <div className="text-right select-none">
                <p className="text-amber-700 font-extrabold text-[12px] uppercase tracking-wider">5 Days Left</p>
                <p className="text-[11px] text-slate-400 font-semibold">Aug 27</p>
              </div>
            </div>
            
            {/* Standard Item: Stripe Integration */}
            <div className="p-md hover:bg-slate-50 border border-transparent hover:border-slate-200 rounded-xl transition-all flex items-center justify-between group cursor-pointer">
              <div className="flex items-center gap-sm min-w-0">
                <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 shadow-inner font-bold">
                  <span className="material-symbols-outlined text-[20px]">handshake</span>
                </div>
                <div className="min-w-0 select-none">
                  <h4 className="font-body-md text-body-md font-extrabold text-primary truncate max-w-[140px]">Stripe Integration</h4>
                  <p className="text-[11px] text-slate-500 font-bold">Stripe Inc. • Confidential</p>
                </div>
              </div>
              <div className="text-right select-none">
                <p className="text-slate-600 font-extrabold text-[12px] uppercase tracking-wider">11 Days Left</p>
                <p className="text-[11px] text-slate-400 font-semibold">Sep 02</p>
              </div>
            </div>
          </div>
          <div className="p-sm bg-slate-50/50 text-center border-t border-slate-100 mt-auto select-none">
            <button className="text-primary hover:text-primary/80 font-bold text-label-md flex items-center justify-center gap-xs w-full py-1 transition-colors" onClick={() => navigate('/repository')}>
              <span>View All Expiries</span>
              <span className="material-symbols-outlined text-[16px] font-bold">arrow_forward</span>
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Section: Modern Vertical Timeline Activity Log */}
      <div className="bg-white border border-slate-200/50 rounded-2xl shadow-[0_2px_8px_-3px_rgba(0,0,0,0.05),0_10px_20px_-5px_rgba(0,0,0,0.03)] p-lg mb-lg">
        <div className="border-b border-slate-100 pb-sm flex justify-between items-center mb-lg select-none">
          <div>
            <h3 className="font-headline-md text-headline-md text-primary font-black">Recent Activity Log</h3>
            <p className="text-[11px] text-slate-500 font-bold">Real-time contract ingestion and validation pipeline audit</p>
          </div>
          <button 
            onClick={() => navigate('/repository')}
            className="text-primary hover:text-primary/80 font-extrabold text-label-md flex items-center gap-xs py-1 transition-all"
          >
            <span>Go to Repository</span>
            <span className="material-symbols-outlined text-[16px] font-bold">arrow_forward</span>
          </button>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-on-surface-variant font-body-md bg-slate-50 border border-slate-200/30 rounded-2xl">Querying Oracle database...</div>
        ) : contractsList.length === 0 ? (
          <div className="text-center py-12 text-on-surface-variant font-body-md bg-slate-50 border border-slate-200/30 rounded-2xl">No contracts uploaded yet. Start by uploading one!</div>
        ) : (
          /* High-Fidelity Vertical Connecting Timeline */
          <div className="relative border-l-2 border-slate-100 ml-6 pl-6 space-y-md my-sm select-none">
            {contractsList.slice(0, 5).map((contract, index) => {
              const isActive = ['DRAFT_READY', 'USER_EDITING'].includes(contract.workflow_state);
              return (
                <div 
                  key={contract.contract_id} 
                  className="relative group hover-float p-md bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 animate-fadeInUp"
                  style={{ animationDelay: `${index * 80}ms` }}
                >
                  {/* Vertical line connecting node */}
                  <div className="absolute -left-[31px] top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-4 border-white bg-primary shadow-sm shrink-0 flex items-center justify-center group-hover:scale-110 transition-transform font-bold">
                    {contract.workflow_state === 'PUBLISHED' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>}
                    {contract.workflow_state === 'REVIEW_PENDING' && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>}
                    {['DRAFT_READY', 'USER_EDITING'].includes(contract.workflow_state) && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>}
                  </div>
                  
                  <div className="flex justify-between items-center gap-md">
                    <div className="min-w-0">
                      <div className="flex items-center gap-xs">
                        <h4 className="font-body-md text-body-md font-extrabold text-slate-800 truncate max-w-sm">
                          {contract.filename}
                        </h4>
                        <span className="text-[10px] font-mono text-slate-400">
                          ID: {contract.contract_id.substring(0, 8)}
                        </span>
                      </div>
                      <div className="flex items-center gap-md mt-xs select-none">
                        <div className="flex items-center gap-xs">
                          <span className="material-symbols-outlined text-[14px] text-slate-400">domain</span>
                          <span className="text-[11px] text-slate-500 font-bold">{contract.department || 'Legal Operations'}</span>
                        </div>
                        <span className="text-slate-200 select-none">•</span>
                        <div className="flex items-center gap-xs">
                          <span className="material-symbols-outlined text-[14px] text-slate-400">person</span>
                          <span className="text-[11px] text-slate-500 font-bold">{contract.customer_name || 'Client'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-md shrink-0 select-none">
                      <div className="text-right">
                        <p className="text-[10px] font-mono text-slate-400">{formatRelativeTime(contract.uploaded_at)}</p>
                        <div className="mt-xs">{getStatusBadge(contract.workflow_state)}</div>
                      </div>

                      {isActive ? (
                        <button 
                          onClick={() => navigate(`/review/${contract.contract_id}`)}
                          className="bg-primary hover:bg-primary/95 text-on-primary px-md py-1.5 rounded-xl text-label-md font-bold flex items-center gap-xs shadow-sm hover:scale-105 transition-all"
                        >
                          <span className="material-symbols-outlined text-[16px] font-bold">edit_note</span>
                          Review
                        </button>
                      ) : (
                        <button 
                          onClick={() => navigate(`/review/${contract.contract_id}`)}
                          className="w-8 h-8 rounded-full hover:bg-slate-50 border border-slate-100 flex items-center justify-center text-primary transition-colors hover:scale-105"
                        >
                          <span className="material-symbols-outlined text-[18px] font-bold">arrow_forward</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
