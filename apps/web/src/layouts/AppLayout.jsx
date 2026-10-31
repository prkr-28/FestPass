import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import { Toaster, toast } from 'react-hot-toast';
import { onSocketEvent } from '../lib/socket';
import { Ticket, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

export default function AppLayout() {
  useEffect(() => {
    // Listen for live ticket issuance across the cluster
    const unsubTicket = onSocketEvent('ticket:issued', (data) => {
      toast.custom(
        (t) => (
          <div
            className={`${
              t.visible ? 'animate-enter' : 'animate-leave'
            } max-w-md w-full bg-slate-900 border border-cyan-500/40 shadow-xl rounded-xl pointer-events-auto flex ring-1 ring-black ring-opacity-5 p-3.5`}
          >
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
                <Ticket className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-100">Live Ticket Issued</p>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  <span className="font-medium text-cyan-300">{data.holderName || 'Attendee'}</span> issued by Node{' '}
                  <span className="font-mono text-cyan-300">{data.issuedByNode || 'B1'}</span>
                </p>
              </div>
            </div>
          </div>
        ),
        { duration: 4000 }
      );
    });

    // Listen for live check-in results across gate nodes
    const unsubCheckin = onSocketEvent('checkin:result', (data) => {
      const isAccepted = data.result === 'accepted';
      toast.custom(
        (t) => (
          <div
            className={`${
              t.visible ? 'animate-enter' : 'animate-leave'
            } max-w-md w-full bg-slate-900 border ${
              isAccepted ? 'border-emerald-500/40' : 'border-rose-500/40'
            } shadow-xl rounded-xl pointer-events-auto flex p-3.5`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`h-8 w-8 rounded-lg ${
                  isAccepted ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                } flex items-center justify-center shrink-0`}
              >
                {isAccepted ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-100">
                  {isAccepted ? 'Gate Scan: Accepted' : 'Gate Scan: Duplicate Rejected'}
                </p>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  Gate <span className="font-mono text-cyan-300">{data.gateNodeId}</span> (Mode: {data.mode})
                </p>
              </div>
            </div>
          </div>
        ),
        { duration: 3500 }
      );
    });

    // Listen for concurrent check-in conflicts
    const unsubConflict = onSocketEvent('conflict:detected', (data) => {
      toast.custom(
        (t) => (
          <div
            className={`${
              t.visible ? 'animate-enter' : 'animate-leave'
            } max-w-md w-full bg-slate-900 border border-amber-500/60 shadow-2xl rounded-xl pointer-events-auto flex p-4`}
          >
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold text-amber-300">Offline Checkin Conflict Resolved</p>
                <p className="text-[11px] text-slate-300 mt-1">
                  Ticket <span className="font-mono text-slate-200">{data.ticketId?.slice(0, 14)}...</span> scanned
                  concurrently. Winner resolved by HLC.
                </p>
              </div>
            </div>
          </div>
        ),
        { duration: 6000 }
      );
    });

    return () => {
      unsubTicket();
      unsubCheckin();
      unsubConflict();
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      <Navbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
      <Toaster position="bottom-right" />
    </div>
  );
}
