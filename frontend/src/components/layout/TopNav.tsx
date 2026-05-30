import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

export default function TopNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);

  const getLinkClass = (path: string) => {
    const isActive = location.pathname === path;
    return `font-label-md text-label-md pb-2 cursor-pointer transition-colors ${
      isActive
        ? 'text-primary border-b-2 border-primary font-bold'
        : 'text-on-surface-variant hover:text-primary'
    }`;
  };

  return (
    <header className="fixed top-0 w-full z-50 bg-surface-container-lowest border-b border-outline-variant flex justify-between items-center h-14 px-lg">
      {/* Left side: Brand Title and Quick SubNav */}
      <div className="flex items-center gap-md">
        <span 
          onClick={() => navigate('/dashboard')}
          className="text-headline-lg font-headline-lg font-bold text-primary cursor-pointer tracking-tighter"
        >
          ContractLens Manager
        </span>
        
        <nav className="hidden md:flex gap-lg ml-xl h-full items-center pt-2">
          <span 
            onClick={() => navigate('/dashboard')} 
            className={getLinkClass('/dashboard')}
          >
            Dashboard
          </span>
          <span 
            onClick={() => navigate('/repository')} 
            className={getLinkClass('/repository')}
          >
            Repository
          </span>
          {(user?.role === 'operation_head' || user?.role === 'admin') && (
            <span 
              onClick={() => navigate('/approvals')} 
              className={getLinkClass('/approvals')}
            >
              Approvals
            </span>
          )}
        </nav>
      </div>

      {/* Right side: Quick Search, Upload, notifications, and profile */}
      <div className="flex items-center gap-md">
        {/* Search block */}
        <div className="relative hidden lg:block">
          <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]">
            search
          </span>
          <input 
            type="text" 
            placeholder="Search contracts..." 
            onClick={() => navigate('/repository')}
            className="bg-surface-container-low border-none rounded-lg pl-xl pr-md py-xs text-body-sm w-64 focus:ring-1 focus:ring-primary cursor-pointer"
          />
        </div>

        {/* Upload Button Gated */}
        {(user?.role === 'admin' || user?.role === 'operation_user') && (
          <button 
            onClick={() => navigate('/upload')}
            className="bg-primary text-on-primary px-md py-xs rounded-lg font-label-md text-label-md hover:opacity-90 active:scale-[0.98] transition-all shadow-sm"
          >
            Upload
          </button>
        )}

        {/* Icon groups */}
        <div className="flex gap-sm">
          <span className="material-symbols-outlined text-on-surface-variant cursor-pointer hover:text-primary transition-colors">
            notifications
          </span>
          <span 
            onClick={() => navigate('/admin')}
            className="material-symbols-outlined text-on-surface-variant cursor-pointer hover:text-primary transition-colors"
          >
            settings
          </span>
        </div>

        {/* Profile Image Avatar */}
        <div className="flex items-center gap-xs border-l border-outline-variant pl-md">
          <div className="w-8 h-8 rounded-full overflow-hidden border border-outline-variant bg-primary-fixed flex items-center justify-center font-bold text-primary text-[12px]">
            {user?.full_name?.substring(0, 2).toUpperCase() || 'US'}
          </div>
        </div>
      </div>
    </header>
  );
}
