import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import {
  getActiveBoothNode,
  
  BOOTH_NODES,
    setActiveBoothNode,
  subscribeNodeChanges,
} from '../api/client';
import { Ticket, Server, LogOut, User, RefreshCw } from 'lucide-react';

export default function Navbar() {
  const { user, isAuthenticated, logout } = useAuthStore();
  const navigate = useNavigate();
  const [activeBooth, setActiveBooth] = useState(getActiveBoothNode());
  
  const [showNodeSelector, setShowNodeSelector] = useState(false);

  useEffect(() => {
    return subscribeNodeChanges(({ boothNode }) => {
      setActiveBooth(boothNode);
      
    });
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getRoleBadgeColor = (role) => {
    if (role === 'admin') return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
    if (role === 'booth_staff') return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    if (role === 'gate_staff') return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform">
              <Ticket className="h-5 w-5 text-white" />
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                FestPass
              </span>
              <span className="ml-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-400">
                Distributed
              </span>
            </div>
          </Link>
        </div>

        {/* Center / Right controls */}
        <div className="flex items-center gap-3">
          {/* Active Node Failover Badge / Selector */}
          <div className="relative">
            <button
              onClick={() => setShowNodeSelector(!showNodeSelector)}
              title="Click to manually switch or inspect connected cluster nodes"
              className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-600 transition"
            >
              <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <Server className="h-3.5 w-3.5 text-cyan-400" />
              <span className="hidden sm:inline text-slate-400">Booth:</span>
              <span className="font-mono text-cyan-300">{activeBooth?.replace('http://localhost:', 'Port ')}</span>
            </button>

            {showNodeSelector && (
              <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-800 bg-slate-900 p-3 shadow-2xl z-50">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center justify-between">
                  <span>Connected Booth Node</span>
                  <RefreshCw className="h-3 w-3 text-cyan-400 animate-spin" />
                </div>
                <div className="space-y-1">
                  {BOOTH_NODES.map((url, i) => {
                    const isSelected = url === activeBooth;
                    return (
                      <button
                        key={url}
                        onClick={() => {
                          setActiveBoothNode(url);
                          setShowNodeSelector(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-mono transition ${
                          isSelected
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                            : 'text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <span>Booth B{i + 1}</span>
                        <span className="text-[11px] text-slate-400">{url}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 pt-2 border-t border-slate-800 text-[10px] text-slate-400">
                  Auto-failover is active: if a node fails, requests automatically switch to peer booths.
                </div>
              </div>
            )}
          </div>

          {/* User profile / actions */}
          {isAuthenticated && user ? (
            <div className="flex items-center gap-2">
              <div className="hidden md:flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1 text-xs">
                <User className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-slate-200 font-medium">{user.name}</span>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${getRoleBadgeColor(
                    user.role
                  )}`}
                >
                  {user.role}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 rounded-lg border border-rose-900/40 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 transition"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md hover:bg-cyan-500 transition"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
