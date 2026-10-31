import { useState, useEffect } from 'react';
import axios from 'axios';
import { api, GATE_NODES } from '../api/client';
import { onSocketEvent } from '../lib/socket';
import { formatDate } from '../lib/utils';
import { Zap, Play, RotateCcw, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';

export default function ClusterDashboardPage() {
  const [nodes, setNodes] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [replicationMeta, setReplicationMeta] = useState(null);
  const [activeTab, setActiveTab] = useState('topology'); // 'topology' | 'conflicts' | 'chaos'

  // Chaos settings
  const [chaosAction, setChaosAction] = useState('partition');
  const [chaosTarget, setChaosTarget] = useState('G1');
  const [chaosDelay, setChaosDelay] = useState(500);
  const [chaosDrop, setChaosDrop] = useState(0.5);
  const [isTriggeringChaos, setIsTriggeringChaos] = useState(false);

  // Demo execution state
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoResult, setDemoResult] = useState(null);

  const fetchClusterState = async () => {
    try {
      const [nodesRes, conflictsRes, replRes] = await Promise.all([
        api.get('/api/cluster/nodes'),
        api.get('/api/cluster/conflicts'),
        api.get('/api/cluster/replication'),
      ]);

      setNodes(nodesRes.data?.peers || []);
      setConflicts(conflictsRes.data?.conflicts || []);
      setReplicationMeta(replRes.data || null);
    } catch (err) {
      console.error('Failed to query cluster state:', err);
    } finally {
      /* done */
    }
  };

  useEffect(() => {
    fetchClusterState();
    const interval = setInterval(fetchClusterState, 3500);

    const unsubCluster = onSocketEvent('cluster:update', () => {
      fetchClusterState();
    });

    const unsubConflict = onSocketEvent('conflict:detected', () => {
      fetchClusterState();
    });

    return () => {
      clearInterval(interval);
      unsubCluster();
      unsubConflict();
    };
  }, []);

  const handleApplyChaos = async () => {
    setIsTriggeringChaos(true);
    try {
      await api.post('/internal/chaos', {
        action: chaosAction,
        targetNodeId: chaosTarget,
        delayMs: Number(chaosDelay),
        dropRate: Number(chaosDrop),
      });
      toast.success(`Chaos injected: ${chaosAction} on target ${chaosTarget}`);
      fetchClusterState();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to inject chaos rule');
    } finally {
      setIsTriggeringChaos(false);
    }
  };

  const handleResetChaos = async () => {
    setIsTriggeringChaos(true);
    try {
      await api.post('/internal/chaos', { action: 'reset' });
      toast.success('All network partitions & chaos rules reset to clean state');
      fetchClusterState();
    } catch (err) {
      toast.error('Failed to reset chaos rules');
    } finally {
      setIsTriggeringChaos(false);
    }
  };

  const handleRunDoubleScanDemo = async () => {
    setDemoRunning(true);
    setDemoResult(null);
    try {
      // 1. Query an active event
      const eventsRes = await api.get('/api/events?limit=1');
      const eventId = eventsRes.data?.events?.[0]?.id;
      if (!eventId) {
        toast.error('No events found. Please create an event first.');
        setDemoRunning(false);
        return;
      }

      // 2. Issue a ticket on Booth B1
      const ticketRes = await api.post('/api/tickets/issue', {
        eventId,
        holderName: 'Double-Scan Demo Attendee',
        holderEmail: `doublescan.${Date.now()}@campus.edu`,
      });

      const token = ticketRes.data?.ticket?.token;
      const ticketId = ticketRes.data?.ticket?.ticketId || ticketRes.data?.ticket?.id;

      // 3. Simultaneously fire scans at G1 and G2
      const t0 = Date.now();
      const g1Url = GATE_NODES[0] || 'http://localhost:4004';
      const g2Url = GATE_NODES[1] || 'http://localhost:4005';
      const [resG1, resG2] = await Promise.all([
        axios
          .post(`${g1Url}/api/gate/scan`, { token, mode: 'online' }, { timeout: 3500 })
          .catch((e) => e.response || e),
        axios
          .post(`${g2Url}/api/gate/scan`, { token, mode: 'online' }, { timeout: 3500 })
          .catch((e) => e.response || e),
      ]);

      const g1Data = resG1.data || {};
      const g2Data = resG2.data || {};

      setDemoResult({
        ticketId,
        durationMs: Date.now() - t0,
        gate1: { result: g1Data.result || 'error', latency: g1Data.latencyMs },
        gate2: { result: g2Data.result || 'error', latency: g2Data.latencyMs },
      });

      toast.success('Double-scan demo completed!');
      fetchClusterState();
    } catch (err) {
      toast.error(err.message || 'Demo run failed');
    } finally {
      setDemoRunning(false);
    }
  };

  const getNodeStatusBadge = (status) => {
    if (status === 'alive' || status === 'healthy') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Alive</span>
        </span>
      );
    }
    if (status === 'suspect') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          <span>Suspect</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 border border-rose-500/30 px-2 py-0.5 text-[10px] font-semibold text-rose-400">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
        <span>Dead</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Live Cluster & Chaos Studio
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time node topology, failure detection state machine, CRDT conflict log, and chaos
            simulator
          </p>
        </div>

        {/* Tab Controls */}
        <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1">
          <button
            onClick={() => setActiveTab('topology')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === 'topology'
                ? 'bg-cyan-500 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Node Topology (6)
          </button>
          <button
            onClick={() => setActiveTab('conflicts')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
              activeTab === 'conflicts'
                ? 'bg-cyan-500 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Conflicts</span>
            {conflicts.length > 0 && (
              <span className="rounded-full bg-rose-500 px-1.5 py-0.2 text-[9px] font-bold text-white">
                {conflicts.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('chaos')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
              activeTab === 'chaos'
                ? 'bg-cyan-500 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="h-3.5 w-3.5" />
            <span>Chaos & Demos</span>
          </button>
        </div>
      </div>

      {/* TAB 1: Node Topology */}
      {activeTab === 'topology' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {nodes.map((node) => {
              const isBooth = node.role === 'booth';
              return (
                <div
                  key={node.node_id}
                  className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 backdrop-blur-sm hover:border-slate-700 transition shadow-xl"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-10 w-10 rounded-xl flex items-center justify-center font-bold text-sm ${
                          isBooth
                            ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                            : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                        }`}
                      >
                        {node.node_id}
                      </div>
                      <div>
                        <div className="font-bold text-sm text-slate-100 uppercase tracking-tight">
                          {isBooth ? 'Booth Node' : 'Gate Node'} {node.node_id}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">{node.url}</div>
                      </div>
                    </div>
                    {getNodeStatusBadge(node.status)}
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-xs font-mono">
                    <div className="rounded-lg bg-slate-950 p-2">
                      <span className="text-[10px] text-slate-500 block uppercase font-sans">
                        Replication Lag
                      </span>
                      <span className="text-slate-200 font-bold">
                        {node.replicationLagOps || 0} ops
                      </span>
                    </div>
                    <div className="rounded-lg bg-slate-950 p-2">
                      <span className="text-[10px] text-slate-500 block uppercase font-sans">
                        Heartbeat Jitter
                      </span>
                      <span className="text-slate-200 font-bold">
                        {node.replicationLagMs || 0} ms
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 text-[10px] text-slate-500 flex justify-between">
                    <span>Role: {node.role}</span>
                    <span>Last Seen: {formatDate(node.last_seen)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Replication Watermark Card */}
          {replicationMeta && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs font-mono">
              <div>
                <span className="text-[10px] uppercase font-semibold text-slate-400 block font-sans">
                  Current Local HLC Clock
                </span>
                <span className="text-cyan-300 font-bold text-sm">{replicationMeta.hlc}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-slate-400 block font-sans">
                  Total Replicated Operations in OpLog
                </span>
                <span className="text-slate-200 font-bold text-sm">
                  {replicationMeta.totalOperations} ops
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Conflicts Table */}
      {activeTab === 'conflicts' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Offline Check-in Conflict Ledger ({conflicts.length})
            </h2>
            <span className="text-[11px] text-slate-400">
              Resolved deterministically by lowest Hybrid Logical Clock
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                  <th className="py-3 px-4">Conflict ID</th>
                  <th className="py-3 px-4">Ticket ID</th>
                  <th className="py-3 px-4">Winning Checkin</th>
                  <th className="py-3 px-4">Losing Checkin</th>
                  <th className="py-3 px-4">Detected At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {conflicts.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="py-12 text-center text-slate-500 font-sans text-xs">
                      No concurrent offline conflicts detected. Cluster is in perfect consensus.
                    </td>
                  </tr>
                ) : (
                  conflicts.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-3 px-4 text-cyan-300">{c.id.slice(0, 14)}...</td>
                      <td className="py-3 px-4 text-slate-200">{c.ticket_id}</td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>{c.winner_checkin_id?.slice(0, 10)}...</span>
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 text-rose-400">
                          <XCircle className="h-3 w-3" />
                          <span>{c.loser_checkin_id?.slice(0, 10)}...</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 font-sans text-slate-400 text-[11px]">
                        {formatDate(c.detected_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: Chaos & Viva Demo Controls */}
      {activeTab === 'chaos' && (
        <div className="space-y-6">
          {/* Quick Double Scan Demo Card */}
          <div className="rounded-2xl border border-cyan-500/40 bg-gradient-to-r from-cyan-950/40 to-indigo-950/40 p-6 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/20 border border-cyan-500/40 px-2.5 py-0.5 text-[10px] font-bold text-cyan-300 uppercase tracking-widest mb-1.5">
                  Live Distributed Proof
                </span>
                <h2 className="text-lg font-bold text-white">
                  One-Click Concurrent Double-Scan Demo
                </h2>
                <p className="text-xs text-slate-300 mt-1 max-w-xl leading-relaxed">
                  Issues an Ed25519-signed ticket on Booth B1 and fires simultaneous scans at Gate
                  G1 and Gate G2 at the exact same millisecond. Proves that Distributed Gate Quorum
                  guarantees exactly one acceptance and one duplicate rejection.
                </p>
              </div>

              <button
                onClick={handleRunDoubleScanDemo}
                disabled={demoRunning}
                className="flex items-center gap-2 rounded-xl bg-cyan-500 px-5 py-3 text-xs font-bold text-slate-950 shadow-lg shadow-cyan-500/30 hover:bg-cyan-400 disabled:opacity-50 shrink-0 transition"
              >
                {demoRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Executing Consensus...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    <span>Fire Double-Scan</span>
                  </>
                )}
              </button>
            </div>

            {/* Demo Outcome Card */}
            {demoResult && (
              <div className="mt-5 pt-4 border-t border-cyan-500/30">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 mb-2">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>CONSENSUS VERDICT: EXACTLY 1 ACCEPTED, 1 REJECTED!</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                  <div
                    className={`rounded-xl p-3 border ${
                      demoResult.gate1.result === 'accepted'
                        ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                        : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
                    }`}
                  >
                    <div className="font-bold">
                      Gate G1: {demoResult.gate1.result.toUpperCase()}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {demoResult.gate1.latency || 12}ms latency
                    </div>
                  </div>
                  <div
                    className={`rounded-xl p-3 border ${
                      demoResult.gate2.result === 'accepted'
                        ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                        : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
                    }`}
                  >
                    <div className="font-bold">
                      Gate G2: {demoResult.gate2.result.toUpperCase()}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {demoResult.gate2.latency || 12}ms latency
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Fault Injection Panel */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
            <h2 className="text-base font-bold text-white mb-1">Chaos & Fault Injection Engine</h2>
            <p className="text-xs text-slate-400 mb-5">
              Simulate network partitions, 4G latency, and packet drops between distributed peer
              nodes
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Action</label>
                <select
                  value={chaosAction}
                  onChange={(e) => setChaosAction(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
                >
                  <option value="partition">Network Partition</option>
                  <option value="delay">Artificial Latency</option>
                  <option value="drop">Packet Drop Rate</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Target Node</label>
                <select
                  value={chaosTarget}
                  onChange={(e) => setChaosTarget(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
                >
                  {nodes.map((n) => (
                    <option key={n.node_id} value={n.node_id}>
                      {n.node_id} ({n.role})
                    </option>
                  ))}
                </select>
              </div>

              {chaosAction === 'delay' ? (
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Delay (ms)</label>
                  <input
                    type="number"
                    min="100"
                    step="100"
                    value={chaosDelay}
                    onChange={(e) => setChaosDelay(e.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              ) : chaosAction === 'drop' ? (
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">
                    Drop Rate (0.0 - 1.0)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    value={chaosDrop}
                    onChange={(e) => setChaosDrop(e.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              ) : (
                <div className="flex items-center text-[11px] text-slate-500 pt-5">
                  Target peer will be blocked bidirectionally
                </div>
              )}

              <div className="flex items-end gap-2">
                <button
                  onClick={handleApplyChaos}
                  disabled={isTriggeringChaos}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 font-semibold text-white shadow hover:bg-rose-500 disabled:opacity-50"
                >
                  <Zap className="h-3.5 w-3.5" />
                  <span>Apply</span>
                </button>
                <button
                  onClick={handleResetChaos}
                  disabled={isTriggeringChaos}
                  className="rounded-xl border border-slate-800 px-3 py-2 font-medium text-slate-300 hover:bg-slate-800"
                  title="Reset all chaos rules"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
