import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

export default function TopNav() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  return (
    <header className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-md border-b border-outline-variant/40 flex justify-between items-center h-14 px-lg shadow-sm">
      {/* Left side: Brand Title and Quick SubNav */}
      <div className="flex items-center gap-md">
        <div 
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-sm cursor-pointer select-none group"
        >
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-on-primary shadow-md group-hover:scale-105 transition-transform duration-200">
            <span className="material-symbols-outlined text-[18px] font-bold">balance</span>
          </div>
          <span className="text-headline-md font-headline-md font-bold tracking-tight text-primary group-hover:text-primary/80 transition-colors">
            ContractLens
          </span>
          <span className="px-xs py-[1px] bg-primary-fixed text-on-primary-fixed text-[9px] font-extrabold rounded uppercase tracking-wider">
            Enterprise
          </span>
        </div>
      </div>

      {/* Right side: Quick Search, Upload, notifications, and profile */}
      <div className="flex items-center gap-md">
        {/* Search block */}
        <div className="relative hidden lg:block">
          <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
            search
          </span>
          <input 
            type="text" 
            placeholder="Search enterprise agreements..." 
            onClick={() => navigate('/repository')}
            className="bg-surface-container-low/50 hover:bg-surface-container-low border border-outline-variant/30 hover:border-outline focus:border-primary rounded-full pl-xl pr-md py-1.5 text-body-sm w-72 focus:ring-2 focus:ring-primary/20 cursor-pointer transition-all duration-200 focus:outline-none shadow-inner"
          />
        </div>

        {/* Upload Button Gated */}
        {(user?.role === 'admin' || user?.role === 'operation_user') && (
          <button 
            onClick={() => navigate('/upload')}
            className="bg-primary hover:bg-primary/90 text-on-primary px-lg py-1.5 rounded-full font-label-md text-label-md flex items-center gap-xs hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 shadow-sm font-bold"
          >
            <span className="material-symbols-outlined text-[16px]">upload_file</span>
            Upload
          </button>
        )}

        {/* Icon groups */}
        <div className="flex items-center gap-xs">
          <div className="w-8 h-8 rounded-full hover:bg-surface-container-low flex items-center justify-center transition-colors cursor-pointer group">
            <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary transition-colors text-[20px]">
              notifications
            </span>
          </div>
          <div 
            onClick={() => navigate('/admin')}
            className="w-8 h-8 rounded-full hover:bg-surface-container-low flex items-center justify-center transition-colors cursor-pointer group"
          >
            <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary transition-colors text-[20px]">
              settings
            </span>
          </div>
        </div>

        {/* Profile Image Avatar */}
        <div className="flex items-center gap-xs border-l border-outline-variant/40 pl-md">
          <div className="w-8 h-8 rounded-full overflow-hidden border border-outline-variant/60 bg-primary-fixed flex items-center justify-center font-extrabold text-primary text-[11px] shadow-sm select-none">
            {user?.full_name?.substring(0, 2).toUpperCase() || 'US'}
          </div>
        </div>
      </div>
    </header>
  );
}
