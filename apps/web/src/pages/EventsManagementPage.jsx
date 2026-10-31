import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { formatCurrency, formatDate } from '../lib/utils';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  Users,
  CheckCircle,
  Clock,
  XCircle,
  X,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

export default function EventsManagementPage() {
  const [events, setEvents] = useState([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [quotaEvent, setQuotaEvent] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form fields
  const [formName, setFormName] = useState('');
  const [formVenue, setFormVenue] = useState('');
  const [formStartsAt, setFormStartsAt] = useState('');
  const [formCapacity, setFormCapacity] = useState(300);
  const [formPrice, setFormPrice] = useState(20);
  const [formStatus, setFormStatus] = useState('on_sale');

  const fetchEvents = async () => {
    setIsLoading(true);
    try {
      const res = await api.get(`/api/events?limit=50&search=${encodeURIComponent(search)}`);
      setEvents(res.data?.events || []);
    } catch (err) {
      toast.error('Failed to load events');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [search]);

  const resetForm = () => {
    setFormName('');
    setFormVenue('');
    setFormStartsAt(new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 16));
    setFormCapacity(300);
    setFormPrice(20);
    setFormStatus('on_sale');
    setEditingEvent(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setShowCreateModal(true);
  };

  const handleOpenEdit = (event) => {
    setEditingEvent(event);
    setFormName(event.name);
    setFormVenue(event.venue);
    setFormStartsAt(event.starts_at ? new Date(event.starts_at).toISOString().slice(0, 16) : '');
    setFormCapacity(event.capacity);
    setFormPrice(event.price);
    setFormStatus(event.status);
    setShowCreateModal(true);
  };

  const handleSaveEvent = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload = {
        name: formName,
        venue: formVenue,
        startsAt: new Date(formStartsAt).toISOString(),
        capacity: Number(formCapacity),
        price: Number(formPrice),
        status: formStatus,
      };

      if (editingEvent) {
        await api.put(`/api/events/${editingEvent.id}`, payload);
        toast.success(`Event '${formName}' updated`);
      } else {
        await api.post('/api/events', payload);
        toast.success(`Event created & capacity partitioned across booths!`);
      }

      setShowCreateModal(false);
      resetForm();
      fetchEvents();
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message || 'Operation failed';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteEvent = async (eventId, name) => {
    if (!window.confirm(`Are you sure you want to delete '${name}'?`)) return;
    try {
      await api.delete(`/api/events/${eventId}`);
      toast.success('Event deleted');
      fetchEvents();
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to delete event');
    }
  };

  const handleViewQuotas = async (eventId) => {
    try {
      const res = await api.get(`/api/events/${eventId}`);
      setQuotaEvent(res.data?.event || null);
    } catch (err) {
      toast.error('Failed to load quota breakdown');
    }
  };

  const getStatusBadge = (status) => {
    if (status === 'on_sale') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
          <CheckCircle className="h-3 w-3" />
          <span>On Sale</span>
        </span>
      );
    }
    if (status === 'draft') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 border border-slate-500/30 px-2 py-0.5 text-[11px] font-semibold text-slate-400">
          <Clock className="h-3 w-3" />
          <span>Draft</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 border border-rose-500/30 px-2 py-0.5 text-[11px] font-semibold text-rose-400">
        <XCircle className="h-3 w-3" />
        <span>{status}</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Events Management</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure fest events, schedules, ticket pricing, and automatic booth quota partitions
          </p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-md hover:from-cyan-400 hover:to-indigo-500 transition"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Create New Event</span>
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events by name or venue..."
            className="w-full rounded-xl border border-slate-800 bg-slate-900/60 pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition"
          />
        </div>
      </div>

      {/* Events Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                <th className="py-3 px-4">Event</th>
                <th className="py-3 px-4">Venue & Date</th>
                <th className="py-3 px-4">Price</th>
                <th className="py-3 px-4">Capacity</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {isLoading ? (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-slate-500">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-cyan-400" />
                    <span>Loading events...</span>
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-slate-500">
                    No events found matching your search. Click "Create New Event" to get started.
                  </td>
                </tr>
              ) : (
                events.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-800/30 transition">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-200">{e.name}</div>
                      <div className="font-mono text-[10px] text-slate-500">ID: {e.id}</div>
                    </td>
                    <td className="py-3.5 px-4 text-slate-300">
                      <div>{e.venue}</div>
                      <div className="text-[11px] text-slate-500">
                        {formatDate(e.starts_at || e.startsAt)}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono font-medium text-emerald-400">
                      {formatCurrency(e.price)}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-200">{e.capacity} seats</div>
                      <button
                        onClick={() => handleViewQuotas(e.id)}
                        className="text-[10px] text-cyan-400 hover:underline flex items-center gap-1 mt-0.5"
                      >
                        <Users className="h-2.5 w-2.5" />
                        <span>Booth slices</span>
                      </button>
                    </td>
                    <td className="py-3.5 px-4">{getStatusBadge(e.status)}</td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenEdit(e)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-cyan-300 transition"
                          title="Edit event"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteEvent(e.id, e.name)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 transition"
                          title="Delete event"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl relative">
            <button
              onClick={() => setShowCreateModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="text-lg font-bold text-white mb-1">
              {editingEvent ? 'Edit Event' : 'Create Campus Event'}
            </h2>
            <p className="text-xs text-slate-400 mb-5">
              Event capacity will be partitioned automatically across Booth nodes (B1, B2, B3).
            </p>

            <form onSubmit={handleSaveEvent} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Event Name</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Annual TechFest 2026"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Venue</label>
                  <input
                    type="text"
                    required
                    value={formVenue}
                    onChange={(e) => setFormVenue(e.target.value)}
                    placeholder="e.g. Grand Auditorium"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Starts At</label>
                  <input
                    type="datetime-local"
                    required
                    value={formStartsAt}
                    onChange={(e) => setFormStartsAt(e.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Capacity</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={formCapacity}
                    onChange={(e) => setFormCapacity(e.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Price ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    required
                    value={formPrice}
                    onChange={(e) => setFormPrice(e.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Status</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-200 focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="on_sale">on_sale</option>
                    <option value="draft">draft</option>
                    <option value="closed">closed</option>
                  </select>
                </div>
              </div>

              <div className="mt-2 rounded-xl bg-slate-950/60 border border-slate-800 p-3 text-[11px] text-slate-400 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
                <span>
                  Capacity ({formCapacity}) will be divided evenly across booths (e.g.{' '}
                  {Math.floor(formCapacity / 3)} each + remainder to B1). Each booth node can only
                  sell from its own quota.
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-xl border border-slate-800 px-4 py-2 font-medium text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 rounded-xl bg-cyan-600 px-4 py-2 font-semibold text-white shadow hover:bg-cyan-500 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : editingEvent ? (
                    'Save Changes'
                  ) : (
                    'Create Event'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quota Breakdown Modal */}
      {quotaEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl relative">
            <button
              onClick={() => setQuotaEvent(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
            <h2 className="text-base font-bold text-white mb-1">Partitioned Booth Quotas</h2>
            <p className="text-xs text-slate-400 mb-4">{quotaEvent.name}</p>

            <div className="space-y-3">
              {(quotaEvent.quotas || []).map((q) => (
                <div
                  key={q.node_id}
                  className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 flex items-center justify-between"
                >
                  <div>
                    <span className="font-mono font-bold text-cyan-300 text-sm">
                      Node {q.node_id}
                    </span>
                    <span className="ml-2 text-xs text-slate-400">Booth Staff</span>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-semibold text-slate-200">
                      {q.sold} / {q.quota} sold
                    </div>
                    <div className="text-[10px] text-emerald-400 font-medium">
                      {q.quota - q.sold} available
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
