import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import {
  LayoutDashboard,
  Calendar,
  Ticket,
  ShoppingBag,
  QrCode,
  Network,
  Search,
  Sparkles,
} from 'lucide-react';

export default function Sidebar() {
  const { user } = useAuthStore();
  const role = user?.role;

  const links = [
    {
      to: '/admin',
      label: 'Admin Dashboard',
      icon: LayoutDashboard,
      show: role === 'admin',
    },
    {
      to: '/admin/events',
      label: 'Events & Quotas',
      icon: Calendar,
      show: role === 'admin',
    },
    {
      to: '/admin/tickets',
      label: 'Tickets & Revoke',
      icon: Ticket,
      show: role === 'admin' || role === 'booth_staff',
    },
    {
      to: '/booth',
      label: 'Booth Ticket Sales',
      icon: ShoppingBag,
      show: role === 'admin' || role === 'booth_staff',
    },
    {
      to: '/gate',
      label: 'Gate Scanner',
      icon: QrCode,
      show: role === 'admin' || role === 'gate_staff',
      badge: 'Stage 6',
    },
    {
      to: '/cluster',
      label: 'Live Cluster & Chaos',
      icon: Network,
      show: true,
      badge: 'Live',
    },
    {
      to: '/my-ticket',
      label: 'Attendee Pass Portal',
      icon: Search,
      show: true,
    },
  ];

  return (
    <aside className="hidden lg:flex w-64 flex-col border-r border-slate-800 bg-slate-950/60 p-4">
      <div className="mb-4 px-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Navigation</h2>
      </div>

      <nav className="flex-1 space-y-1">
        {links
          .filter((item) => item.show)
          .map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/admin'}
                className={({ isActive }) =>
                  `flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-medium transition ${
                    isActive
                      ? 'bg-gradient-to-r from-cyan-500/20 to-indigo-500/10 text-cyan-300 border border-cyan-500/30 shadow-sm'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                  }`
                }
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="rounded-full bg-slate-800 border border-slate-700 px-1.5 py-0.2 text-[9px] font-medium text-slate-300">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
      </nav>

      <div className="mt-auto pt-4 border-t border-slate-800/80">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
            <span>High Consistency</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
            Atomic local quota slices prevent overselling across booth nodes without coordination.
          </p>
        </div>
      </div>
    </aside>
  );
}
