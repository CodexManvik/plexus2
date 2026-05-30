import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopNav from './TopNav';

export default function AppShell() {
  return (
    <div className="min-h-screen bg-background text-on-surface flex flex-col">
      <TopNav />
      
      <div className="flex flex-1">
        <Sidebar />
        
        <main className="flex-1 ml-sidebar-width pt-14 min-h-[calc(100vh-3.5rem)] flex flex-col">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
