import { useState } from 'react';
import { api } from '../api/client';
import {
  Search,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldBan,
  Loader2,
  X,
  Eye,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

export default function TicketsManagementPage() {
  const [searchEmail, setSearchEmail] = useState('');
  const [searchPhone, setSearchPhone] = useState('');
  const [searchId, setSearchId] = useState('');
  const [tickets, setTickets] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Revoke state
  const [revokingTicket, setRevokingTicket] = useState(null);
  const [revokeReason, setRevokeReason] = useState('Attendee requested refund');
  const [isRevoking, setIsRevoking] = useState(false);

  // Detail view state
  const [viewTicket, setViewTicket] = useState(null);

  const handleSearch = async (e) => {
    e?.preventDefault();
    setIsLoading(true);
    try {
      if (searchId.trim()) {
        const res = await api.get(`/api/tickets/${searchId.trim()}/status`);
        setTickets(res.data ? [res.data] : []);
      } else {
        const params = new URLSearchParams();
        if (searchEmail.trim()) params.append('email', searchEmail.trim());
        if (searchPhone.trim()) params.append('phone', searchPhone.trim());

        const res = await api.get(`/api/tickets?${params.toString()}`);
        setTickets(res.data?.tickets || []);
      }
    } catch (err) {
      if (err.response?.status === 404) {
        setTickets([]);
        toast.error('No matching ticket found');
      } else {
        toast.error(err.response?.data?.error?.message || 'Search failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokingTicket) return;
    setIsRevoking(true);
    try {
      const ticketId = revokingTicket.ticketId || revokingTicket.id;
      await api.post(`/api/tickets/${ticketId}/revoke`, {
        reason: revokeReason,
      });
      toast.success(`Ticket #${ticketId.slice(0, 8)}... successfully revoked`);
      setRevokingTicket(null);
      handleSearch();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to revoke ticket');
    } finally {
      setIsRevoking(false);
    }
  };

  const getStatusBadge = (t) => {
    const status = t.status;
    const isFraud = t.fraudAlert || t.fraud_alert;

    if (isFraud) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/20 border border-rose-500/40 px-2 py-0.5 text-[10px] font-bold text-rose-300 animate-pulse">
          <AlertTriangle className="h-3 w-3" />
          <span>FRAUD ALERT</span>
        </span>
      );
    }

    if (status === 'valid') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          <span>Valid</span>
        </span>
      );
    }
    if (status === 'used') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
          <Clock className="h-3 w-3" />
          <span>Used</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 border border-rose-500/30 px-2 py-0.5 text-[10px] font-semibold text-rose-400">
        <XCircle className="h-3 w-3" />
        <span>Revoked</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Ticket Registry & Revocation</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Lookup issued passes across all cluster booths, verify status, check fraud flags, and revoke tickets
        </p>
      </div>

      {/* Search Filters */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-lg">
        <form onSubmit={handleSearch} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Ticket ID (Snowflake 64-bit)
            </label>
            <input
              type="text"
              value={searchId}
              onChange={(e) => setSearchId(e.target.value)}
              placeholder="e.g. 242162..."
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Attendee Email
            </label>
            <input
              type="email"
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              placeholder="e.g. attendee@campus.edu"
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Attendee Phone
              </label>
              <input
                type="text"
                value={searchPhone}
                onChange={(e) => setSearchPhone(e.target.value)}
                placeholder="+1555..."
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-1.5 rounded-xl bg-cyan-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-cyan-500 transition disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span>Search</span>
            </button>
          </div>
        </form>
      </div>

      {/* Results Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                <th className="py-3 px-4">Ticket ID</th>
                <th className="py-3 px-4">Attendee</th>
                <th className="py-3 px-4">Event</th>
                <th className="py-3 px-4">Issued By</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {isLoading ? (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-slate-500">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-cyan-400" />
                    <span>Querying cluster database...</span>
                  </td>
                </tr>
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-slate-500">
                    Use the search filters above to query tickets by attendee email, phone, or Snowflake ID.
                  </td>
                </tr>
              ) : (
                tickets.map((t) => {
                  const id = t.ticketId || t.id;
                  const name = t.holderName || t.holder_name;
                  const email = t.holderEmail || t.holder_email;
                  const phone = t.holderPhone || t.holder_phone;
                  const node = t.issuedByNode || t.issued_by_node || 'B1';

                  return (
                    <tr key={id} className="hover:bg-slate-800/30 transition">
                      <td className="py-3.5 px-4 font-mono font-medium text-cyan-300">
                        {id}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-200">{name}</div>
                        <div className="text-[11px] text-slate-400">
                          {email} {phone && `• ${phone}`}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-300">
                        {t.eventName || t.eventId || t.event_id}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-400">
                        Node {node}
                      </td>
                      <td className="py-3.5 px-4">{getStatusBadge(t)}</td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setViewTicket(t)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-cyan-300 transition"
                            title="Inspect ticket details & token"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          {t.status !== 'revoked' && (
                            <button
                              onClick={() => setRevokingTicket(t)}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 transition"
                              title="Revoke Ticket"
                            >
                              <ShieldBan className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Revoke Confirmation Modal */}
      {revokingTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-900/40 bg-slate-900 p-6 shadow-2xl relative">
            <button
              onClick={() => setRevokingTicket(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3 text-rose-400 mb-3">
              <div className="h-9 w-9 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center">
                <ShieldBan className="h-5 w-5" />
              </div>
              <h2 className="text-base font-bold text-white">Revoke Ticket</h2>
            </div>

            <p className="text-xs text-slate-300 mb-3">
              Are you sure you want to permanently revoke ticket{' '}
              <span className="font-mono text-cyan-300">
                #{(revokingTicket.ticketId || revokingTicket.id)?.slice(0, 12)}...
              </span>
              ? Once revoked, entry gates will reject this ticket.
            </p>

            <div className="mb-4">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Reason for Revocation
              </label>
              <input
                type="text"
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="e.g. Refund issued, duplicate payment"
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-rose-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRevokingTicket(null)}
                className="rounded-xl border border-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRevoke}
                disabled={isRevoking}
                className="flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-rose-500 disabled:opacity-50"
              >
                {isRevoking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldBan className="h-3.5 w-3.5" />}
                <span>Confirm Revocation</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ticket Details Inspector Modal */}
      {viewTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl relative">
            <button
              onClick={() => setViewTicket(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
            <h2 className="text-base font-bold text-white mb-1">Ticket Inspection</h2>
            <p className="text-xs text-slate-400 mb-4">
              Cryptographic Ed25519 Token & Local Node Status
            </p>

            <div className="space-y-3 text-xs">
              <div className="rounded-xl bg-slate-950 p-3 border border-slate-800">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block mb-1">
                  Ticket Token
                </span>
                <p className="font-mono text-[11px] text-cyan-300 break-all select-all">
                  {viewTicket.token || 'Token not loaded'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-950 p-3 border border-slate-800">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block mb-0.5">
                    Issued At HLC
                  </span>
                  <span className="font-mono text-slate-200 text-[11px]">
                    {viewTicket.issuedAtHlc || viewTicket.issued_at_hlc || 'N/A'}
                  </span>
                </div>
                <div className="rounded-xl bg-slate-950 p-3 border border-slate-800">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block mb-0.5">
                    Issuing Node
                  </span>
                  <span className="font-mono text-slate-200 text-[11px]">
                    Node {viewTicket.issuedByNode || viewTicket.issued_by_node || 'B1'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
