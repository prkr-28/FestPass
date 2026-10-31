import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { getActiveBoothNode } from '../api/client';
import { Ticket, Lock, Mail, Server, ArrowRight, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading, error } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const activeNode = getActiveBoothNode();

  const handleLogin = async (e) => {
    e?.preventDefault();
    const result = await login(email, password);
    if (result.success) {
      const from = location.state?.from?.pathname;
      if (from) {
        navigate(from, { replace: true });
      } else if (result.user.role === 'admin') {
        navigate('/admin', { replace: true });
      } else if (result.user.role === 'booth_staff') {
        navigate('/booth', { replace: true });
      } else if (result.user.role === 'gate_staff') {
        navigate('/gate', { replace: true });
      } else {
        navigate('/my-ticket', { replace: true });
      }
    }
  };

  const handleQuickLogin = (quickEmail, quickPassword) => {
    setEmail(quickEmail);
    setPassword(quickPassword);
    login(quickEmail, quickPassword).then((result) => {
      if (result.success) {
        if (result.user.role === 'admin') navigate('/admin');
        else if (result.user.role === 'booth_staff') navigate('/booth');
        else if (result.user.role === 'gate_staff') navigate('/gate');
      }
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 relative overflow-hidden">
      {/* Background neon glows */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Card Header */}
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 shadow-xl shadow-cyan-500/20 mb-4">
            <Ticket className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">FestPass Staff Access</h1>
          <p className="mt-1 text-xs text-slate-400">
            Distributed Ticketing & Offline Entry Validation
          </p>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1 text-[11px] text-slate-400">
            <Server className="h-3 w-3 text-cyan-400" />
            <span>Target Node:</span>
            <span className="font-mono text-cyan-300">{activeNode}</span>
          </div>
        </div>

        {/* Login Form Container */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 sm:p-8 backdrop-blur-xl shadow-2xl">
          {error && (
            <div className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Staff Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@campus.edu"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/80 pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/80 pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-2 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 hover:from-cyan-400 hover:to-indigo-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50 transition"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          {/* Quick Demo Login Preset Buttons */}
          <div className="mt-6 pt-5 border-t border-slate-800">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
              Quick Demo Logins (Viva Presets)
            </p>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleQuickLogin('admin@campus.edu', 'AdminPass123!')}
                className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-2 py-1.5 text-center text-[11px] font-medium text-purple-300 hover:bg-purple-500/20 transition"
              >
                Admin
              </button>
              <button
                type="button"
                onClick={() => handleQuickLogin('booth1@campus.edu', 'BoothPass123!')}
                className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-1.5 text-center text-[11px] font-medium text-blue-300 hover:bg-blue-500/20 transition"
              >
                Booth Staff
              </button>
              <button
                type="button"
                onClick={() => handleQuickLogin('gate1@campus.edu', 'GatePass123!')}
                className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-center text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20 transition"
              >
                Gate Staff
              </button>
            </div>
          </div>
        </div>

        {/* Public portal link */}
        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/my-ticket')}
            className="text-xs text-slate-400 hover:text-cyan-400 transition"
          >
            Looking for your festival ticket? <span className="underline font-medium">Attendee Pass Portal →</span>
          </button>
        </div>
      </div>
    </div>
  );
}
