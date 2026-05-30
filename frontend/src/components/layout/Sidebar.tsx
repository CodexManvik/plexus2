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
    <aside className="fixed left-0 top-14 h-[calc(100vh-3.5rem)] w-sidebar-width z-40 bg-surface border-r border-outline-variant flex flex-col py-md px-sm gap-xs">
      {/* Branding Header Panel */}
      <div className="px-sm mb-lg">
        <div className="flex items-center gap-sm mb-xs">
          <div className="w-10 h-10 bg-primary-container rounded-lg flex items-center justify-center text-on-primary-container shadow-sm">
            <span className="material-symbols-outlined" style={{ fontVariationSettings: '"FILL" 1' }}>balance</span>
          </div>
          <div>
            <h2 className="font-headline-md text-headline-md font-black text-primary leading-tight">ContractLens</h2>
            <p className="font-body-sm text-body-sm text-on-surface-variant">Enterprise Tier</p>
          </div>
        </div>
        
        {/* Quick action button for starting a new analysis (Extraction upload) */}
        {(user?.role === 'admin' || user?.role === 'operation_user') && (
          <button 
            onClick={() => navigate('/upload')}
            className="w-full mt-md bg-primary text-on-primary py-sm rounded-lg font-label-md text-label-md flex items-center justify-center gap-xs hover:opacity-90 active:scale-[0.98] transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            New Analysis
          </button>
        )}
      </div>

      {/* Main navigation list */}
      <nav className="flex-1 flex flex-col gap-xs overflow-y-auto custom-scrollbar">
        {filteredNavItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-sm px-sm py-sm rounded-lg transition-all duration-200 ${
                isActive
                  ? 'bg-secondary-container text-on-secondary-container font-bold shadow-sm'
                  : 'text-secondary hover:bg-surface-container-high'
              }`
            }
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span className="font-label-md text-label-md">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer / User Profile & Logout section */}
      <div className="border-t border-outline-variant pt-sm flex flex-col gap-xs">
        <div className="px-sm py-xs flex flex-col gap-xs mb-xs">
          <div className="font-label-md text-[12px] text-primary font-bold truncate">
            {user?.full_name || 'Guest User'}
          </div>
          <div className="text-[10px] text-on-surface-variant font-mono uppercase tracking-wider">
            {user?.role?.replace('_', ' ') || 'No Role'}
          </div>
        </div>

        <a 
          href="#support"
          className="flex items-center gap-sm px-sm py-sm text-secondary hover:bg-surface-container-high rounded-lg transition-all duration-200"
        >
          <span className="material-symbols-outlined">help</span>
          <span className="font-label-md text-label-md">Support</span>
        </a>

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-sm px-sm py-sm text-error hover:bg-error-container/30 rounded-lg transition-all duration-200 text-left"
        >
          <span className="material-symbols-outlined">logout</span>
          <span className="font-label-md text-label-md">Logout</span>
        </button>
      </div>
    </aside>
  );
}
