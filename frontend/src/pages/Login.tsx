import { useState, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { authService } from '../services/auth';

type RoleType = 'admin' | 'operation_user' | 'operation_head';

export default function Login() {
  const [role, setRole] = useState<RoleType>('admin');
  const [email, setEmail] = useState('admin@plexus.com');
  const [password, setPassword] = useState('Admin@123456');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);

  // Auto-fill default credentials based on selected role to facilitate quick testing
  useEffect(() => {
    if (role === 'admin') {
      setEmail('admin@plexus.com');
      setPassword('Admin@123456');
    } else if (role === 'operation_user') {
      setEmail('user@plexus.com');
      setPassword('User@123456');
    } else if (role === 'operation_head') {
      setEmail('head@plexus.com');
      setPassword('Head@123456');
    }
    setError('');
  }, [role]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 1. Authenticate with backend
      const tokenResponse = await authService.login({ email, password });
      
      // 2. Store tokens in Zustand so the Axios interceptor injects them into the getCurrentUser request
      useAuthStore.setState({
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
      });
      
      // 3. Fetch authenticated profile details
      const profile = await authService.getCurrentUser();
      
      // 4. Save details to global store
      setAuth(profile, tokenResponse.access_token, tokenResponse.refresh_token);
      
      // 5. Redirect to Dashboard
      navigate('/dashboard');
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') {
        setError(detail);
      } else if (Array.isArray(detail)) {
        const msg = detail.map((d: any) => d.msg).join(', ');
        setError(msg);
      } else {
        setError(err.response?.data?.message || 'Incorrect email or password. Please verify credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-background text-on-background min-h-screen flex items-center justify-center p-md bg-surface-container-low login-mesh">
      {/* Login Container */}
      <main className="w-full max-w-[440px] flex flex-col gap-lg z-10">
        
        {/* Branding Section */}
        <header className="flex flex-col items-center text-center gap-sm">
          <div className="flex items-center gap-xs">
            <span className="material-symbols-outlined text-primary text-[32px]" style={{ fontVariationSettings: '"FILL" 1' }}>
              gavel
            </span>
            <h1 className="font-headline-lg text-headline-lg text-primary tracking-tighter">ContractLens</h1>
          </div>
          <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">
            Enterprise Contract Intelligence
          </p>
        </header>

        {/* Form Card */}
        <section className="bg-surface-container-lowest border border-outline-variant rounded-lg p-xl shadow-sm">
          <div className="mb-lg">
            <h2 className="font-headline-md text-headline-md text-primary mb-xs">Welcome back</h2>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Please enter your credentials to access the legal repository.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-md">
            {error && (
              <div className="bg-error-container text-error border border-error/20 px-4 py-3 rounded-lg text-sm transition-all duration-200">
                {error}
              </div>
            )}

            {/* Role Selection */}
            <div className="space-y-xs">
              <label className="font-label-md text-label-md text-on-surface flex items-center gap-xs" htmlFor="role">
                <span className="material-symbols-outlined text-[16px]">account_tree</span>
                SYSTEM ROLE
              </label>
              <div className="relative">
                <select 
                  id="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as RoleType)}
                  className="w-full bg-surface-container-low border-b-2 border-outline-variant focus:border-primary text-body-md font-body-md py-sm px-md appearance-none transition-all outline-none"
                >
                  <option value="admin">Admin</option>
                  <option value="operation_user">Operation User</option>
                  <option value="operation_head">Operation Head</option>
                </select>
                <div className="absolute right-md top-1/2 -translate-y-1/2 pointer-events-none">
                  <span className="material-symbols-outlined text-on-surface-variant">expand_more</span>
                </div>
              </div>
            </div>

            {/* Username / Email */}
            <div className="space-y-xs">
              <label className="font-label-md text-label-md text-on-surface flex items-center gap-xs" htmlFor="username">
                <span className="material-symbols-outlined text-[16px]">person</span>
                USERNAME / EMAIL
              </label>
              <input 
                id="username"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. j.doe@firm.com"
                className="w-full bg-surface-container-low border-b-2 border-outline-variant focus:border-primary text-body-md font-body-md py-sm px-md transition-all outline-none placeholder:text-outline"
              />
            </div>

            {/* Password */}
            <div className="space-y-xs">
              <div className="flex justify-between items-center">
                <label className="font-label-md text-label-md text-on-surface flex items-center gap-xs" htmlFor="password">
                  <span className="material-symbols-outlined text-[16px]">lock</span>
                  PASSWORD
                </label>
                <a href="#forgot" className="font-label-md text-label-md text-primary hover:underline transition-all">Forgot?</a>
              </div>
              <div className="relative">
                <input 
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-surface-container-low border-b-2 border-outline-variant focus:border-primary text-body-md font-body-md py-sm px-md transition-all outline-none placeholder:text-outline"
                />
                <button 
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-md top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-primary transition-colors"
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <div className="flex items-center gap-sm pt-xs">
              <input 
                id="remember"
                type="checkbox"
                className="w-4 h-4 rounded-sm border-outline-variant text-primary focus:ring-primary-container"
              />
              <label htmlFor="remember" className="font-body-sm text-body-sm text-on-surface-variant cursor-pointer select-none">
                Remember this device for 30 days
              </label>
            </div>

            {/* Submit Button */}
            <button 
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-on-primary font-label-md text-label-md py-md rounded-lg hover:bg-primary-container active:scale-[0.98] transition-all flex items-center justify-center gap-sm mt-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>{loading ? 'SECURING ACCESS...' : 'SECURE ACCESS'}</span>
              <span className="material-symbols-outlined text-[18px]">login</span>
            </button>
          </form>
        </section>

        {/* Footer / Trust Badges */}
        <footer className="flex flex-col items-center gap-md">
          <div className="flex items-center gap-lg opacity-60">
            <div className="flex items-center gap-xs">
              <span className="material-symbols-outlined text-[16px]">verified_user</span>
              <span className="font-label-md text-[10px]">SOC2 COMPLIANT</span>
            </div>
            <div className="flex items-center gap-xs">
              <span className="material-symbols-outlined text-[16px]">encrypted</span>
              <span className="font-label-md text-[10px]">AES-256 ENCRYPTION</span>
            </div>
          </div>
          <nav className="flex gap-md">
            <a href="#privacy" className="font-label-md text-[11px] text-on-surface-variant hover:text-primary transition-colors">Privacy Policy</a>
            <a href="#terms" className="font-label-md text-[11px] text-on-surface-variant hover:text-primary transition-colors">Terms of Service</a>
            <a href="#support" className="font-label-md text-[11px] text-on-surface-variant hover:text-primary transition-colors">Support</a>
          </nav>
        </footer>
      </main>
    </div>
  );
}
