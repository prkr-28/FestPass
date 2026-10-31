import { useState, useEffect, useRef } from 'react';
import { api, getActiveBoothNode } from '../api/client';
import { formatCurrency } from '../lib/utils';
import {
  Ticket,
  User,
  Mail,
  Phone,
  Plus,
  Trash2,
  Download,
  Printer,
  CheckCircle2,
  Loader2,
  X,
  Server,
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { toast } from 'react-hot-toast';

export default function BoothSalesPage() {
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [isGroup, setIsGroup] = useState(false);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Single ticket fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // Group booking fields
  const [groupTickets, setGroupTickets] = useState([
    { holderName: '', holderEmail: '', holderPhone: '' },
    { holderName: '', holderEmail: '', holderPhone: '' },
  ]);

  // Issued ticket confirmation modal state
  const [issuedTicket, setIssuedTicket] = useState(null);
  const qrRef = useRef(null);

  const activeBooth = getActiveBoothNode();

  useEffect(() => {
    async function loadEvents() {
      try {
        const res = await api.get('/api/events?limit=20');
        const activeEvents = (res.data?.events || []).filter(
          (e) => e.status === 'on_sale' || e.status === 'active'
        );
        setEvents(activeEvents);
        if (activeEvents.length > 0) {
          setSelectedEventId(activeEvents[0].id);
        }
      } catch (err) {
        toast.error('Failed to load active events');
      } finally {
        setIsLoadingEvents(false);
      }
    }
    loadEvents();
  }, []);

  const selectedEvent = events.find((e) => e.id === selectedEventId);

  const handleAddGroupRow = () => {
    if (groupTickets.length >= 20) {
      toast.error('Maximum 20 tickets per bulk transaction');
      return;
    }
    setGroupTickets([...groupTickets, { holderName: '', holderEmail: '', holderPhone: '' }]);
  };

  const handleRemoveGroupRow = (idx) => {
    if (groupTickets.length <= 1) return;
    setGroupTickets(groupTickets.filter((_, i) => i !== idx));
  };

  const handleUpdateGroupRow = (idx, field, value) => {
    const updated = [...groupTickets];
    updated[idx][field] = value;
    setGroupTickets(updated);
  };

  const handleIssueTickets = async (e) => {
    e.preventDefault();
    if (!selectedEventId) {
      toast.error('Please select an event');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isGroup) {
        // Bulk issue
        const validGroup = groupTickets.filter((t) => t.holderName.trim() && t.holderEmail.trim());
        if (validGroup.length === 0) {
          toast.error('Please enter details for at least one attendee');
          setIsSubmitting(false);
          return;
        }

        const res = await api.post('/api/tickets/bulk', {
          eventId: selectedEventId,
          tickets: validGroup,
        });

        toast.success(`Successfully issued ${res.data?.count || validGroup.length} tickets!`);
        if (res.data?.tickets && res.data.tickets.length > 0) {
          setIssuedTicket(res.data.tickets[0]);
        }
      } else {
        // Single issue
        const res = await api.post('/api/tickets/issue', {
          eventId: selectedEventId,
          holderName: name,
          holderEmail: email,
          holderPhone: phone,
        });

        toast.success('Ticket issued successfully!');
        setIssuedTicket(res.data?.ticket);
        setName('');
        setEmail('');
        setPhone('');
      }
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message || 'Issuance failed';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const downloadQrPng = () => {
    const canvas = qrRef.current?.querySelector('canvas');
    if (!canvas) return;
    const pngUrl = canvas.toDataURL('image/png');
    const downloadLink = document.createElement('a');
    downloadLink.href = pngUrl;
    downloadLink.download = `ticket-${issuedTicket?.ticketId || 'festpass'}.png`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  const printTicket = () => {
    window.print();
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Booth Point-of-Sale</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Atomic ticket generation with Ed25519 asymmetric cryptographic signing & QR output
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-300">
          <Server className="h-3.5 w-3.5 text-cyan-400" />
          <span>Active Booth:</span>
          <span className="font-mono text-cyan-300 font-semibold">{activeBooth}</span>
        </div>
      </div>

      {/* Main Issuance Form Card */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8 backdrop-blur-xl shadow-2xl">
        <form onSubmit={handleIssueTickets} className="space-y-6">
          {/* Event Picker */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
              Select Campus Event
            </label>
            {isLoadingEvents ? (
              <div className="text-xs text-slate-500 flex items-center gap-2 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                <span>Loading events...</span>
              </div>
            ) : events.length === 0 ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                No active events available on sale. Please create or publish an event first.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {events.map((e) => {
                  const isSelected = e.id === selectedEventId;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setSelectedEventId(e.id)}
                      className={`text-left rounded-xl p-3.5 border transition ${
                        isSelected
                          ? 'border-cyan-500 bg-cyan-500/10 shadow-lg shadow-cyan-500/10'
                          : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-semibold text-slate-100 text-xs truncate">{e.name}</div>
                      <div className="text-[11px] text-slate-400 mt-1 truncate">{e.venue}</div>
                      <div className="mt-2 flex items-center justify-between text-xs font-mono font-bold text-emerald-400">
                        <span>{formatCurrency(e.price)}</span>
                        <span className="text-[10px] text-slate-400 font-normal">Cap: {e.capacity}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Mode Switcher: Single vs Group */}
          <div className="flex items-center gap-2 border-b border-slate-800 pb-4">
            <button
              type="button"
              onClick={() => setIsGroup(false)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                !isGroup
                  ? 'bg-cyan-500 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Single Attendee
            </button>
            <button
              type="button"
              onClick={() => setIsGroup(true)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                isGroup
                  ? 'bg-cyan-500 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Group Booking (Bulk up to 20)
            </button>
          </div>

          {/* Single Attendee Form */}
          {!isGroup ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Full Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="jane@campus.edu"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Phone (Optional)
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 555 123 4567"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          ) : (
            /* Group Booking Rows */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Add up to 20 attendees. All tickets will be generated atomically in a single transaction.
                </span>
                <button
                  type="button"
                  onClick={handleAddGroupRow}
                  className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
                >
                  <Plus className="h-3 w-3" />
                  <span>Add Attendee</span>
                </button>
              </div>

              {groupTickets.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-5 text-[11px] font-mono text-slate-500">{idx + 1}.</span>
                  <input
                    type="text"
                    required
                    placeholder="Name"
                    value={row.holderName}
                    onChange={(e) => handleUpdateGroupRow(idx, 'holderName', e.target.value)}
                    className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                  />
                  <input
                    type="email"
                    required
                    placeholder="Email"
                    value={row.holderEmail}
                    onChange={(e) => handleUpdateGroupRow(idx, 'holderEmail', e.target.value)}
                    className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="Phone (optional)"
                    value={row.holderPhone}
                    onChange={(e) => handleUpdateGroupRow(idx, 'holderPhone', e.target.value)}
                    className="w-36 rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                  />
                  {groupTickets.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveGroupRow(idx)}
                      className="text-slate-500 hover:text-rose-400 p-1"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Issue Action Button */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
            <div className="text-xs text-slate-400">
              Total Price:{' '}
              <span className="font-mono font-bold text-emerald-400 text-sm">
                {selectedEvent
                  ? formatCurrency(
                      selectedEvent.price * (isGroup ? groupTickets.length : 1)
                    )
                  : '$0.00'}
              </span>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !selectedEventId}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 px-6 py-2.5 text-xs font-semibold text-white shadow-lg shadow-cyan-500/20 hover:from-cyan-400 hover:to-indigo-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50 transition"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Signing & Issuing...</span>
                </>
              ) : (
                <>
                  <Ticket className="h-4 w-4" />
                  <span>Issue {isGroup ? `${groupTickets.length} Tickets` : 'Ticket'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Confirmation & QR Modal */}
      {issuedTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="w-full max-w-sm rounded-3xl border border-cyan-500/30 bg-slate-900 p-6 shadow-2xl relative text-center">
            <button
              onClick={() => setIssuedTicket(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="h-6 w-6" />
            </div>

            <h2 className="text-lg font-bold text-white">Ticket Issued!</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Signed with Ed25519 by Node {issuedTicket.issuedByNode || 'B1'}
            </p>

            {/* QR Code Container */}
            <div
              ref={qrRef}
              className="my-5 inline-block p-4 bg-white rounded-2xl shadow-inner border border-slate-200"
            >
              <QRCodeCanvas
                value={issuedTicket.token || ''}
                size={180}
                level="M"
                includeMargin={false}
              />
            </div>

            {/* Details Card */}
            <div className="rounded-xl bg-slate-950 p-3.5 border border-slate-800 text-left text-xs space-y-1 mb-4 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-500">Attendee:</span>
                <span className="text-slate-200 font-sans font-semibold">{issuedTicket.holderName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Ticket ID:</span>
                <span className="text-cyan-300 font-bold">{issuedTicket.ticketId || issuedTicket.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Node:</span>
                <span className="text-slate-200">{issuedTicket.issuedByNode || 'B1'}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={downloadQrPng}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Save PNG</span>
              </button>
              <button
                onClick={printTicket}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-cyan-600 py-2 text-xs font-semibold text-white shadow hover:bg-cyan-500 transition"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Print Pass</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
