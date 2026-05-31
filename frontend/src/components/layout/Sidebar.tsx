import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { authService } from '../../services/auth';

export default function Sidebar() {
  const navigate = useNavigate();
  const { user, refreshToken, clearAuth } = useAuthStore();

  const handleLogout = async () => {
    try {
      if (refreshToken) {
        await authService.logout(refreshToken);
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      clearAuth();
      navigate('/login');
    }
  };

  const navItems = [
    { path: '/dashboard', label: 'Analytics', icon: 'dashboard' },
    { path: '/repository', label: 'Contracts', icon: 'description' },
    { path: '/upload', label: 'Extraction', icon: 'psychology', roles: ['operation_user', 'operation_head', 'admin'] },
    { path: '/approvals', label: 'Approvals', icon: 'fact_check', roles: ['operation_head', 'admin'] },
    { path: '/audit', label: 'Audit Log', icon: 'assignment', roles: ['operation_head', 'admin'] },
    { path: '/admin', label: 'Admin', icon: 'admin_panel_settings', roles: ['admin'] },
  ];

  const filteredNavItems = navItems.filter(
    (item) => !item.roles || item.roles.includes(user?.role || '')
  );

  return (
    <aside className="fixed left-0 top-14 h-[calc(100vh-3.5rem)] w-sidebar-width z-40 bg-white text-slate-700 border-r border-slate-200/70 flex flex-col py-md px-sm justify-between gap-sm transition-all duration-300 select-none shadow-[1px_0_10px_rgba(0,0,0,0.01)]">
      {/* Branding Header Panel */}
      <div className="px-sm mb-sm mt-xs">
        <div className="p-sm bg-slate-50 border border-slate-100 rounded-xl flex items-center gap-sm">
          <div className="w-8 h-8 rounded-lg bg-primary-fixed flex items-center justify-center text-primary shadow-inner shrink-0 font-bold">
            <span className="material-symbols-outlined text-[18px]">workspace_premium</span>
          </div>
          <div className="min-w-0">
            <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Workspace</p>
            <p className="text-body-sm font-extrabold text-slate-800 truncate">Legal Ops Portal</p>
          </div>
        </div>
        
        {/* Quick action button for starting a new analysis (Extraction upload) */}
        {(user?.role === 'admin' || user?.role === 'operation_user') && (
          <button 
            onClick={() => navigate('/upload')}
            className="w-full mt-md bg-primary hover:bg-primary/95 text-on-primary py-2 rounded-xl font-label-md text-label-md flex items-center justify-center gap-xs hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 shadow-sm font-bold"
          >
            <span className="material-symbols-outlined text-[18px] font-bold">add</span>
            New Analysis
          </button>
        )}
      </div>

      {/* Main navigation list */}
      <nav className="flex-1 flex flex-col gap-xs overflow-y-auto custom-scrollbar px-xs">
        {filteredNavItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-sm px-sm py-2 rounded-lg transition-all duration-200 ${
                isActive
                  ? 'bg-indigo-50/70 text-indigo-700 font-extrabold border-l-4 border-indigo-600 shadow-sm pl-2 animate-fadeInUp'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50 pl-3'
              }`
            }
          >
            <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
            <span className="font-label-md text-label-md">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer / User Profile & Logout section */}
      <div className="border-t border-slate-100 pt-md flex flex-col gap-xs">
        <div className="mx-xs p-sm bg-slate-50 border border-slate-100 rounded-xl flex flex-col gap-xs mb-xs">
          <div className="flex items-center gap-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Active Session</span>
          </div>
          <div className="font-label-md text-[12px] text-slate-800 font-bold truncate">
            {user?.full_name || 'Guest User'}
          </div>
          <div className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
            {user?.role?.replace('_', ' ') || 'No Role'}
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="mx-xs flex items-center gap-sm px-sm py-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-all duration-200 text-left font-bold text-label-md"
        >
          <span className="material-symbols-outlined text-[18px]">logout</span>
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
