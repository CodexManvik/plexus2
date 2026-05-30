import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuthStore } from '../stores/authStore';

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
  const user = useAuthStore((state) => state.user);

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
    <div className="p-lg max-w-[1400px] mx-auto w-full flex-1 overflow-y-auto">
      {/* Dashboard Header */}
      <div className="flex justify-between items-end mb-lg">
        <div>
          <h1 className="font-display-sm text-display-sm text-primary">Executive Insights</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Contract lifecycle overview for {user?.full_name || 'Legal Operations'}
          </p>
        </div>
        <div className="flex gap-sm">
          <button className="bg-surface-container-low border border-outline-variant px-md py-xs rounded-lg font-label-md text-label-md flex items-center gap-xs text-on-surface-variant hover:bg-surface-container-high transition-all">
            <span className="material-symbols-outlined text-[18px]">calendar_today</span>
            This Quarter
          </button>
          <button 
            onClick={() => navigate('/upload')}
            className="bg-primary text-on-primary px-md py-xs rounded-lg font-label-md text-label-md flex items-center gap-xs hover:opacity-90 active:scale-[0.98] transition-all shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            New Analysis
          </button>
        </div>
      </div>

      {/* KPI Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-lg mb-lg">
        {/* KPI 1: Executed (Published) */}
        <div className="bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-xs">Executed Contracts</p>
              <p className="font-display-sm text-display-sm text-primary">
                {isLoading ? '...' : executedCount}
              </p>
            </div>
            <div className="bg-primary-fixed text-on-primary-fixed-variant p-sm rounded-lg">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: '"FILL" 1' }}>history_edu</span>
            </div>
          </div>
          <div className="mt-lg flex items-center gap-xs">
            <span className="material-symbols-outlined text-primary text-[18px]">trending_up</span>
            <span className="text-body-sm font-bold text-primary">Live Corpus Sync</span>
            <span className="text-body-sm text-on-surface-variant">with Oracle 26ai</span>
          </div>
        </div>

        {/* KPI 2: Pending Review */}
        <div className="bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-xs">Pending Review</p>
              <p className="font-display-sm text-display-sm text-primary">
                {isLoading ? '...' : pendingReviewCount}
              </p>
            </div>
            <div className="bg-tertiary-fixed text-on-tertiary-fixed-variant p-sm rounded-lg">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: '"FILL" 1' }}>pending_actions</span>
            </div>
          </div>
          <div className="mt-lg">
            <div className="w-full bg-surface-container h-1.5 rounded-full overflow-hidden">
              <div 
                className="bg-primary h-full transition-all duration-500" 
                style={{ width: `${totalCount > 0 ? (pendingReviewCount / totalCount) * 100 : 0}%` }}
              ></div>
            </div>
            <p className="mt-xs text-body-sm text-on-surface-variant">
              {totalCount > 0 ? Math.round((pendingReviewCount / totalCount) * 100) : 0}% of indexed agreements
            </p>
          </div>
        </div>

        {/* KPI 3: Closing Soon */}
        <div className="bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wider mb-xs">Total Contracts</p>
              <p className="font-display-sm text-display-sm text-primary">
                {isLoading ? '...' : totalCount}
              </p>
            </div>
            <div className="bg-error-container-flat text-on-error-container p-sm rounded-lg">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: '"FILL" 1' }}>folder_shared</span>
            </div>
          </div>
          <div className="mt-lg flex items-center gap-xs">
            <span className="material-symbols-outlined text-outline-flat text-[18px]">verified</span>
            <span className="text-body-sm text-on-surface-variant">Across all business units</span>
          </div>
        </div>
      </div>

      {/* Visualization Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-lg mb-lg">
        {/* Bar Chart: Pending Contracts by Department */}
        <div className="lg:col-span-2 bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-sm flex flex-col h-[400px]">
          <div className="flex justify-between items-center mb-xl">
            <h3 className="font-headline-md text-headline-md text-primary">Department Backlog</h3>
            <div className="flex gap-xs items-center">
              <span className="w-3 h-3 bg-primary rounded-full"></span>
              <span className="text-label-md font-label-md text-on-surface-variant">Pending Extractions</span>
            </div>
          </div>
          <div className="flex-1 flex items-end justify-between gap-md px-md pb-md">
            {departments.map((dept) => {
              const count = departmentBacklogs[dept] || 0;
              const pct = maxBacklog > 0 ? (count / maxBacklog) * 100 : 0;
              return (
                <div key={dept} className="flex-1 flex flex-col items-center gap-sm">
                  <div className="w-full bg-primary-fixed/50 hover:bg-primary-fixed transition-all rounded-t-lg relative group flex flex-col justify-end" style={{ height: '200px' }}>
                    <div 
                      className="bg-primary hover:bg-primary-container w-full rounded-t-lg transition-all duration-700 ease-out relative"
                      style={{ height: `${pct}%` }}
                    >
                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-primary text-on-primary px-2 py-0.5 rounded text-[10px] opacity-0 group-hover:opacity-100 transition-opacity font-bold">
                        {count}
                      </div>
                    </div>
                  </div>
                  <span className="font-label-md text-label-md text-on-surface-variant">{dept}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Expiry List (Realistic Mock for renewals) */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden flex flex-col h-[400px]">
          <div className="p-lg border-b border-outline-variant bg-surface-container-low">
            <h3 className="font-headline-md text-headline-md text-primary">Upcoming Expiries</h3>
            <p className="text-body-sm text-on-surface-variant">Contracts requiring renewal within 30 days</p>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-outline-variant custom-scrollbar">
            {/* List Item 1 */}
            <div className="p-md hover:bg-surface-container transition-all flex items-center justify-between group cursor-pointer">
              <div className="flex items-center gap-sm">
                <div className="w-10 h-10 rounded-lg bg-error-container-flat text-on-error-container flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">assignment_late</span>
                </div>
                <div>
                  <h4 className="font-body-md text-body-md font-bold text-primary truncate max-w-[150px]">Azure MSA 2024</h4>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">Microsoft • $450k</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-error font-bold font-label-md text-label-md">2 Days Left</p>
                <p className="text-body-sm text-on-surface-variant">Aug 24</p>
              </div>
            </div>
            {/* List Item 2 */}
            <div className="p-md hover:bg-surface-container transition-all flex items-center justify-between group cursor-pointer">
              <div className="flex items-center gap-sm">
                <div className="w-10 h-10 rounded-lg bg-surface-container-highest text-on-surface-variant flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">gavel</span>
                </div>
                <div>
                  <h4 className="font-body-md text-body-md font-bold text-primary truncate max-w-[150px]">Office Lease</h4>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">Apex Prop. • $12k/mo</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-on-surface-variant font-bold font-label-md text-label-md">5 Days Left</p>
                <p className="text-body-sm text-on-surface-variant">Aug 27</p>
              </div>
            </div>
            {/* List Item 3 */}
            <div className="p-md hover:bg-surface-container transition-all flex items-center justify-between group cursor-pointer">
              <div className="flex items-center gap-sm">
                <div className="w-10 h-10 rounded-lg bg-surface-container-highest text-on-surface-variant flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">handshake</span>
                </div>
                <div>
                  <h4 className="font-body-md text-body-md font-bold text-primary truncate max-w-[150px]">Stripe Integration</h4>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">Stripe Inc. • Confidential</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-on-surface-variant font-bold font-label-md text-label-md">11 Days Left</p>
                <p className="text-body-sm text-on-surface-variant">Sep 02</p>
              </div>
            </div>
          </div>
          <div className="p-sm bg-surface-container-low text-center border-t border-outline-variant">
            <button className="text-primary font-label-md text-label-md hover:underline font-bold" onClick={() => navigate('/repository')}>
              View All Expiries
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Section: Live Activity Log Table */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden mb-lg">
        <div className="p-lg border-b border-outline-variant flex justify-between items-center">
          <h3 className="font-headline-md text-headline-md text-primary">Recent Activity Log</h3>
          <button 
            onClick={() => navigate('/repository')}
            className="text-primary hover:underline font-label-md text-label-md font-bold"
          >
            Go to Repository
          </button>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-on-surface-variant font-body-md">Querying Oracle database...</div>
        ) : contractsList.length === 0 ? (
          <div className="text-center py-8 text-on-surface-variant font-body-md">No contracts uploaded yet. Start by uploading one!</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">CONTRACT TITLE</th>
                  <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">DEPARTMENT</th>
                  <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">STATUS</th>
                  <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">OWNER</th>
                  <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant">LAST UPDATED</th>
                  <th className="px-lg py-sm font-label-md text-label-md text-on-surface-variant text-right">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {contractsList.slice(0, 5).map((contract) => (
                  <tr key={contract.contract_id} className="hover:bg-surface-container-low transition-colors group">
                    <td className="px-lg py-md font-body-md text-body-md font-bold text-primary">
                      {contract.filename}
                    </td>
                    <td className="px-lg py-md font-body-md text-body-md">
                      {contract.department || 'Legal Operations'}
                    </td>
                    <td className="px-lg py-md">
                      {getStatusBadge(contract.workflow_state)}
                    </td>
                    <td className="px-lg py-md">
                      <div className="flex items-center gap-xs">
                        <div className="w-6 h-6 rounded-full bg-primary-fixed flex items-center justify-center text-[10px] font-bold text-primary">
                          {contract.customer_name?.substring(0, 2).toUpperCase() || 'CN'}
                        </div>
                        <span className="font-body-sm text-body-sm">{contract.customer_name || 'Client'}</span>
                      </div>
                    </td>
                    <td className="px-lg py-md font-body-sm text-body-sm">
                      {formatRelativeTime(contract.uploaded_at)}
                    </td>
                    <td className="px-lg py-md text-right">
                      {['DRAFT_READY', 'USER_EDITING'].includes(contract.workflow_state) ? (
                        <button 
                          onClick={() => navigate(`/review/${contract.contract_id}`)}
                          className="bg-primary text-on-primary px-sm py-1 rounded text-label-md font-label-md flex items-center gap-xs hover:opacity-90 ml-auto"
                        >
                          <span className="material-symbols-outlined text-[14px]">edit_note</span>
                          Review Draft
                        </button>
                      ) : (
                        <button 
                          onClick={() => navigate(`/repository`)}
                          className="text-primary hover:opacity-70 transition-opacity ml-auto"
                        >
                          <span className="material-symbols-outlined">visibility</span>
                        </button>
                      )}
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
