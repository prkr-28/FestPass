import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { formatCurrency } from '../lib/utils';
import { onSocketEvent } from '../lib/socket';
import {
  Ticket,
  DollarSign,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  RefreshCw,
  Plus,
  ArrowUpRight,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { Link } from 'react-router-dom';

export default function AdminDashboardPage() {
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [recentFeed, setRecentFeed] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchDashboardData = async () => {
    setIsLoading(true);
    try {
      const [salesRes, eventsRes] = await Promise.all([
        api.get('/api/stats/sales'),
        api.get('/api/events?limit=20'),
      ]);

      setStats(salesRes.data?.stats || null);
      setEvents(eventsRes.data?.events || []);
    } catch (err) {
      console.error('Failed to load admin stats:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();

    // Stream real-time events into live feed
    const unsubTicket = onSocketEvent('ticket:issued', (data) => {
      setRecentFeed((prev) => [
        {
          id: Date.now() + Math.random(),
          type: 'ticket:issued',
          title: `Ticket Issued: ${data.holderName || 'Attendee'}`,
          desc: `Issued by Node ${data.issuedByNode || 'B1'}`,
          time: new Date().toLocaleTimeString(),
        },
        ...prev.slice(0, 9),
      ]);
      // Refresh stats counters
      fetchDashboardData();
    });

    const unsubCheckin = onSocketEvent('checkin:result', (data) => {
      setRecentFeed((prev) => [
        {
          id: Date.now() + Math.random(),
          type: 'checkin:result',
          title: `Gate Scan: ${data.result === 'accepted' ? 'Accepted' : 'Duplicate Blocked'}`,
          desc: `Gate ${data.gateNodeId} (${data.mode})`,
          time: new Date().toLocaleTimeString(),
        },
        ...prev.slice(0, 9),
      ]);
    });

    const unsubConflict = onSocketEvent('conflict:detected', (data) => {
      setRecentFeed((prev) => [
        {
          id: Date.now() + Math.random(),
          type: 'conflict:detected',
          title: 'Offline Conflict Detected & Resolved',
          desc: `Ticket ${data.ticketId?.slice(0, 10)}... resolved by HLC`,
          time: new Date().toLocaleTimeString(),
        },
        ...prev.slice(0, 9),
      ]);
    });

    return () => {
      unsubTicket();
      unsubCheckin();
      unsubConflict();
    };
  }, []);

  const totalRevenue = stats?.totalRevenue || 0;
  const totalSold = stats?.totalSold || 0;
  const totalQuota = stats?.totalQuota || 0;

  // Format chart data: Event breakdown
  const eventChartData = (events || []).map((e) => ({
    name: e.name.length > 18 ? e.name.slice(0, 18) + '...' : e.name,
    capacity: e.capacity,
    sold: e.soldCount || 0,
    price: e.price,
  }));

  // Format booth node quota distribution
  const boothQuotaData = (stats?.byBooth || []).map((b) => ({
    node: `Booth ${b.nodeId}`,
    quota: b.quota,
    sold: b.sold,
    remaining: Math.max(0, b.quota - b.sold),
  }));

  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Cluster Admin Overview</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time ticketing operations, quota allocations, and live distributed metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchDashboardData}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <Link
            to="/admin/events"
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-md hover:from-cyan-400 hover:to-indigo-500 transition"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Create Event</span>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Tickets Issued</span>
            <div className="h-8 w-8 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
              <Ticket className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-white tracking-tight">{totalSold}</div>
          <p className="mt-1 text-[11px] text-slate-400">
            Of <span className="text-slate-200 font-mono">{totalQuota}</span> partitioned cluster capacity
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Gross Sales</span>
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-400 tracking-tight">
            {formatCurrency(totalRevenue)}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Revenue across all active booth nodes</p>
        </div>

        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Events on Sale</span>
            <div className="h-8 w-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-white tracking-tight">
            {events.filter((e) => e.status === 'on_sale').length}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            <span className="font-mono text-cyan-300">{events.length}</span> total campus events registered
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Cluster State</span>
            <div className="h-8 w-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-purple-300 tracking-tight">6 Nodes</div>
          <p className="mt-1 text-[11px] text-slate-400">
            <span className="text-emerald-400 font-medium">B1-B3</span> booths,{' '}
            <span className="text-cyan-400 font-medium">G1-G3</span> gates active
          </p>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Booth Node Quota Allocation */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-white">Partitioned Booth Quotas</h2>
              <p className="text-[11px] text-slate-400">Sold vs Remaining per Booth slice</p>
            </div>
            <span className="text-[10px] rounded-full bg-slate-800 border border-slate-700 px-2 py-0.5 text-slate-300">
              Zero Oversell Guarantee
            </span>
          </div>

          <div className="h-64 w-full">
            {boothQuotaData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={boothQuotaData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="node" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                    itemStyle={{ fontSize: '12px' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Bar dataKey="sold" name="Tickets Sold" fill="#06b6d4" stackId="a" radius={[0, 0, 4, 4]} />
                  <Bar
                    dataKey="remaining"
                    name="Available Quota"
                    fill="#334155"
                    stackId="a"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No quota records available. Seed or create an event.
              </div>
            )}
          </div>
        </div>

        {/* Sales by Event */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-white">Event Sales Capacity</h2>
              <p className="text-[11px] text-slate-400">Total capacity vs tickets issued</p>
            </div>
            <Link to="/admin/events" className="text-xs text-cyan-400 hover:underline flex items-center gap-1">
              <span>View all</span>
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="h-64 w-full">
            {eventChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={eventChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                    itemStyle={{ fontSize: '12px' }}
                  />
                  <Bar dataKey="capacity" name="Total Capacity" fill="#1e293b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="sold" name="Tickets Sold" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No events currently configured.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Live Cluster Stream Feed */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            <h2 className="text-sm font-bold text-white">Live Cluster Stream</h2>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">Socket.IO Connected</span>
        </div>

        <div className="space-y-2">
          {recentFeed.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              Listening for cluster activity... Issue a ticket or scan at a gate to see live stream.
            </div>
          ) : (
            recentFeed.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-xl border border-slate-800/80 bg-slate-950/60 px-3.5 py-2.5 text-xs transition hover:border-slate-700"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`h-7 w-7 rounded-lg flex items-center justify-center text-xs ${
                      item.type === 'ticket:issued'
                        ? 'bg-cyan-500/10 text-cyan-400'
                        : item.type === 'checkin:result'
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-amber-500/10 text-amber-400'
                    }`}
                  >
                    {item.type === 'ticket:issued' ? (
                      <Ticket className="h-3.5 w-3.5" />
                    ) : item.type === 'checkin:result' ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-slate-200">{item.title}</div>
                    <div className="text-[11px] text-slate-400">{item.desc}</div>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-slate-500">{item.time}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
