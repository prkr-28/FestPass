import { useState } from 'react';
import { api } from '../api/client';
import { formatDate } from '../lib/utils';
import {
  Search,
  Ticket,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  Loader2,
  Calendar,
  Sparkles,
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { toast } from 'react-hot-toast';

export default function MyTicketPage() {
  const [query, setQuery] = useState('');
  const [ticket, setTicket] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleLookup = async (e) => {
    e?.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setHasSearched(true);
    setTicket(null);

    try {
      const q = query.trim();
      let res;
      if (q.includes('@')) {
        res = await api.get(`/api/tickets?email=${encodeURIComponent(q)}`);
        if (res.data?.tickets?.length > 0) {
          // fetch status of the first matching ticket
          const fullRes = await api.get(`/api/tickets/${res.data.tickets[0].ticketId}/status`);
          setTicket(fullRes.data);
        } else {
          toast.error('No tickets found for this email');
        }
      } else if (q.startsWith('+') || /^\d{7,15}$/.test(q)) {
        res = await api.get(`/api/tickets?phone=${encodeURIComponent(q)}`);
        if (res.data?.tickets?.length > 0) {
          const fullRes = await api.get(`/api/tickets/${res.data.tickets[0].ticketId}/status`);
          setTicket(fullRes.data);
        } else {
          toast.error('No tickets found for this phone');
        }
      } else {
        // Assume ticket ID
        res = await api.get(`/api/tickets/${q}/status`);
        setTicket(res.data);
      }
    } catch (err) {
      if (err.response?.status === 404) {
        toast.error('Ticket not found');
      } else {
        toast.error(err.response?.data?.error?.message || 'Lookup failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusBadge = () => {
    if (!ticket) return null;
    if (ticket.fraudAlert) {
      return (
        <div className="flex items-center gap-1.5 rounded-full bg-rose-500/20 border border-rose-500/40 px-3 py-1 text-xs font-bold text-rose-300 animate-pulse">
          <AlertTriangle className="h-4 w-4" />
          <span>SECURITY ALERT: DUPLICATE SCAN DETECTED</span>
        </div>
      );
    }
    if (ticket.status === 'valid') {
      return (
        <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 px-3 py-1 text-xs font-bold text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          <span>VALID PASS • READY FOR ENTRY</span>
        </div>
      );
    }
    if (ticket.status === 'used') {
      return (
        <div className="flex items-center gap-1.5 rounded-full bg-amber-500/20 border border-amber-500/40 px-3 py-1 text-xs font-bold text-amber-300">
          <Clock className="h-4 w-4" />
          <span>CHECKED IN • PASS USED</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-rose-500/20 border border-rose-500/40 px-3 py-1 text-xs font-bold text-rose-300">
        <XCircle className="h-4 w-4" />
        <span>REVOKED • ENTRY DENIED</span>
      </div>
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Search Header */}
      <div className="text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 shadow-xl shadow-cyan-500/20 mb-3">
          <Ticket className="h-6 w-6 text-white" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Attendee Pass Portal</h1>
        <p className="text-xs text-slate-400 mt-1">
          Look up your official campus event pass, check live entry status, and present your QR code at any gate
        </p>

        {/* Search Bar */}
        <form onSubmit={handleLookup} className="mt-6 flex gap-2 max-w-md mx-auto">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter Ticket ID, Email, or Phone..."
              className="w-full rounded-xl border border-slate-800 bg-slate-900/80 pl-10 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !query.trim()}
            className="flex items-center gap-1.5 rounded-xl bg-cyan-600 px-4 py-2.5 text-xs font-semibold text-white shadow hover:bg-cyan-500 disabled:opacity-50 transition"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <span>Find Pass</span>}
          </button>
        </form>
      </div>

      {/* Ticket Pass Display */}
      {ticket ? (
        <div className="relative mx-auto max-w-sm rounded-3xl border border-cyan-500/30 bg-gradient-to-b from-slate-900 via-slate-900/90 to-slate-950 p-6 shadow-2xl backdrop-blur-xl">
          {/* Holographic accent glow */}
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-cyan-500/20 rounded-full blur-2xl pointer-events-none" />

          {/* Event Header */}
          <div className="border-b border-slate-800 pb-4 text-center">
            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-400 uppercase tracking-widest mb-1">
              <Sparkles className="h-3 w-3" />
              <span>Campus Festival Pass</span>
            </div>
            <h2 className="text-lg font-bold text-white tracking-tight">{ticket.eventName}</h2>
            <div className="mt-2 flex items-center justify-center gap-3 text-xs text-slate-400">
              <div className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-slate-500" />
                <span>{formatDate(ticket.createdAt)}</span>
              </div>
            </div>
          </div>

          {/* Status Badge */}
          <div className="my-4 flex justify-center">{getStatusBadge()}</div>

          {/* QR Code */}
          <div className="my-5 flex justify-center">
            <div className="p-3.5 bg-white rounded-2xl shadow-xl border border-slate-200">
              <QRCodeCanvas
                value={ticket.token || `FP1.${ticket.ticketId}`}
                size={190}
                level="M"
                includeMargin={false}
              />
            </div>
          </div>

          {/* Ticket Meta Details */}
          <div className="rounded-2xl bg-slate-950/80 p-4 border border-slate-800/80 space-y-2 text-xs font-mono">
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-sans">Attendee:</span>
              <span className="text-slate-100 font-sans font-semibold text-right truncate max-w-[180px]">
                {ticket.holderName}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-sans">Email:</span>
              <span className="text-slate-300 font-sans text-right truncate max-w-[180px]">
                {ticket.holderEmail}
              </span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-slate-800">
              <span className="text-slate-500">Ticket ID:</span>
              <span className="text-cyan-400 font-bold">{ticket.ticketId}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500">Issued Node:</span>
              <span className="text-slate-300">Node {ticket.issuedByNode || 'B1'}</span>
            </div>
          </div>

          {/* Check-in log if present */}
          {ticket.checkins && ticket.checkins.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-800 text-[11px]">
              <span className="text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                Gate Entry History
              </span>
              <div className="space-y-1">
                {ticket.checkins.map((chk) => (
                  <div
                    key={chk.id}
                    className="flex justify-between items-center rounded-lg bg-slate-950 px-2.5 py-1 text-slate-300 font-mono text-[10px]"
                  >
                    <span>
                      Gate {chk.gate_node_id} ({chk.result})
                    </span>
                    <span className="text-slate-500">{formatDate(chk.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : hasSearched && !isLoading ? (
        <div className="text-center py-12 text-slate-500 text-xs">
          No ticket found matching query. Please verify your email or ticket ID.
        </div>
      ) : null}
    </div>
  );
}
