import { useState, useEffect, useRef } from 'react';
import { api, getActiveGateNode, setActiveGateNode, GATE_NODES } from '../api/client';
import { saveOfflineScan, getPendingOfflineScans, syncOfflineScans } from '../lib/offlineQueue';
import {
  QrCode,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  WifiOff,
  RefreshCw,
  Camera,
  Keyboard,
  History,
  ShieldAlert,
  Loader2,
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { toast } from 'react-hot-toast';

export default function GateScannerPage() {
  const [selectedGate, setSelectedGate] = useState(getActiveGateNode());
  const [manualToken, setManualToken] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [activeScanResult, setActiveScanResult] = useState(null);
  const [scanHistory, setScanHistory] = useState([]);
  const [isOffline, setIsOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);

  const html5QrCodeRef = useRef(null);
  const lastScannedTokenRef = useRef('');
  const lastScanTimeRef = useRef(0);

  // Check pending offline scans on mount
  useEffect(() => {
    async function checkPending() {
      try {
        const pending = await getPendingOfflineScans();
        setPendingCount(pending.length);
      } catch (_e) {}
    }
    checkPending();
  }, []);

  // Update active gate node in client
  const handleSelectGate = (url) => {
    setSelectedGate(url);
    setActiveGateNode(url);
  };

  // Play audio / tactile feedback
  const triggerFeedback = (result) => {
    if (typeof window !== 'undefined' && 'navigator' in window && navigator.vibrate) {
      if (result === 'accepted') {
        navigator.vibrate([100, 50, 100]);
      } else {
        navigator.vibrate([300, 100, 300]);
      }
    }
  };

  // Core scan execution
  const processScan = async (tokenString) => {
    // Debounce duplicate reads of the exact same string within 2.5 seconds
    const now = Date.now();
    if (tokenString === lastScannedTokenRef.current && now - lastScanTimeRef.current < 2500) {
      return;
    }
    lastScannedTokenRef.current = tokenString;
    lastScanTimeRef.current = now;

    setIsScanning(true);
    const startTime = Date.now();

    try {
      const res = await api.post(
        '/api/gate/scan',
        {
          token: tokenString.trim(),
          mode: 'online',
        },
        {},
        'gate'
      );

      setIsOffline(false);
      const data = res.data;
      const latency = Date.now() - startTime;
      const scanItem = {
        ...data,
        token: tokenString,
        latencyMs: data.latencyMs || latency,
        timestamp: new Date().toLocaleTimeString(),
      };

      setActiveScanResult(scanItem);
      setScanHistory((prev) => [scanItem, ...prev.slice(0, 19)]);
      triggerFeedback(data.result);
    } catch (err) {
      // Check if network error or gate server unreachable -> fall back to offline queue
      const isUnreachable =
        !err.response ||
        err.code === 'ECONNABORTED' ||
        err.response?.status === 502 ||
        err.response?.status === 503;

      if (isUnreachable) {
        setIsOffline(true);
        toast.error('Gate unreachable: saving to offline queue');

        const gateId = selectedGate.includes('4004')
          ? 'G1'
          : selectedGate.includes('4005')
            ? 'G2'
            : 'G3';
        await saveOfflineScan({
          token: tokenString.trim(),
          gateNodeId: gateId,
        });

        setPendingCount((prev) => prev + 1);

        const scanItem = {
          success: true,
          result: 'accepted',
          mode: 'offline',
          token: tokenString,
          offlineQueued: true,
          latencyMs: Date.now() - startTime,
          timestamp: new Date().toLocaleTimeString(),
        };

        setActiveScanResult(scanItem);
        setScanHistory((prev) => [scanItem, ...prev.slice(0, 19)]);
        triggerFeedback('accepted');
      } else {
        const errorData = err.response?.data || {
          result: 'rejected_invalid',
          error: err.message,
        };
        const scanItem = {
          success: false,
          result: errorData.result || 'rejected_invalid',
          error: errorData.error?.message || errorData.error || 'Scan rejected',
          token: tokenString,
          latencyMs: Date.now() - startTime,
          timestamp: new Date().toLocaleTimeString(),
        };
        setActiveScanResult(scanItem);
        setScanHistory((prev) => [scanItem, ...prev.slice(0, 19)]);
        triggerFeedback(scanItem.result);
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (!manualToken.trim()) return;
    processScan(manualToken.trim());
    setManualToken('');
  };

  const handleSyncOffline = async () => {
    setIsSyncing(true);
    try {
      const outcome = await syncOfflineScans();
      setPendingCount(0);
      setIsOffline(false);
      toast.success(
        `Offline sync complete! Processed: ${outcome.processed}, Conflicts: ${outcome.conflicts?.length || 0}`
      );
    } catch (err) {
      toast.error('Failed to sync offline scans. Ensure gate is reachable.');
    } finally {
      setIsSyncing(false);
    }
  };

  const toggleCamera = async () => {
    if (cameraActive) {
      if (html5QrCodeRef.current) {
        try {
          await html5QrCodeRef.current.stop();
        } catch (_e) {}
      }
      setCameraActive(false);
    } else {
      setCameraActive(true);
      setTimeout(async () => {
        try {
          const qrCodeScanner = new Html5Qrcode('qr-reader');
          html5QrCodeRef.current = qrCodeScanner;
          await qrCodeScanner.start(
            { facingMode: 'environment' },
            {
              fps: 10,
              qrbox: { width: 250, height: 250 },
            },
            (decodedText) => {
              processScan(decodedText);
            },
            () => {}
          );
        } catch (err) {
          toast.error('Could not access camera. Please use manual input.');
          setCameraActive(false);
        }
      }, 200);
    }
  };

  const getVerdictStyle = (result) => {
    if (result === 'accepted') {
      return {
        bg: 'bg-emerald-950/90 border-emerald-500/80 text-emerald-200',
        badge: 'bg-emerald-500 text-slate-950',
        title: 'ENTRY ACCEPTED',
        icon: CheckCircle2,
      };
    }
    if (result === 'rejected_duplicate') {
      return {
        bg: 'bg-rose-950/90 border-rose-500/80 text-rose-200',
        badge: 'bg-rose-500 text-white',
        title: 'ALREADY USED',
        icon: XCircle,
      };
    }
    if (result === 'revoked') {
      return {
        bg: 'bg-amber-950/90 border-amber-500/80 text-amber-200',
        badge: 'bg-amber-500 text-slate-950',
        title: 'TICKET REVOKED',
        icon: AlertTriangle,
      };
    }
    return {
      bg: 'bg-rose-950/90 border-rose-500/80 text-rose-200',
      badge: 'bg-rose-500 text-white',
      title: 'INVALID / FAKE TOKEN',
      icon: ShieldAlert,
    };
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Offline Mode Banner */}
      {isOffline && (
        <div className="rounded-2xl border border-amber-500/50 bg-amber-500/10 p-4 text-xs text-amber-300 flex items-center justify-between shadow-xl">
          <div className="flex items-center gap-3">
            <WifiOff className="h-5 w-5 text-amber-400 shrink-0" />
            <div>
              <span className="font-bold">Offline Scanning Active:</span> Gate is currently
              partitioned. Scans are cryptographically validated locally and queued for anti-entropy
              sync.
            </div>
          </div>
          {pendingCount > 0 && (
            <button
              onClick={handleSyncOffline}
              disabled={isSyncing}
              className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-1.5 font-bold text-slate-950 hover:bg-amber-400 transition"
            >
              {isSyncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span>Sync ({pendingCount})</span>
            </button>
          )}
        </div>
      )}

      {/* Header & Gate Device Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Gate Validation Terminal</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Distributed Quorum Entry Verification & Offline Partition Scanner
          </p>
        </div>

        {/* Gate Selection Pill */}
        <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1">
          {GATE_NODES.map((url, i) => {
            const isSelected = url === selectedGate;
            return (
              <button
                key={url}
                onClick={() => handleSelectGate(url)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition ${
                  isSelected
                    ? 'bg-cyan-500 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Gate G{i + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* Result Display Banner */}
      {activeScanResult &&
        (() => {
          const style = getVerdictStyle(activeScanResult.result);
          const Icon = style.icon;
          return (
            <div
              className={`rounded-3xl border-2 p-6 transition-all duration-300 shadow-2xl ${style.bg}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 rounded-2xl bg-black/30 flex items-center justify-center shrink-0">
                    <Icon className="h-8 w-8" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-black uppercase ${style.badge}`}
                      >
                        {style.title}
                      </span>
                      <span className="text-xs font-mono text-slate-300">
                        {activeScanResult.latencyMs}ms latency
                      </span>
                    </div>
                    <div className="mt-1.5 text-xs text-slate-200">
                      {activeScanResult.result === 'accepted' ? (
                        <span>
                          Ticket{' '}
                          <span className="font-mono font-bold">{activeScanResult.ticketId}</span>{' '}
                          verified. Mode:{' '}
                          <span className="uppercase font-semibold text-cyan-300">
                            {activeScanResult.mode}
                          </span>
                          {activeScanResult.offlineQueued && ' (Queued locally)'}
                        </span>
                      ) : activeScanResult.result === 'rejected_duplicate' ? (
                        <span>
                          First scanned at{' '}
                          <span className="font-semibold">{activeScanResult.firstCheckedInAt}</span>{' '}
                          by{' '}
                          <span className="font-mono font-bold text-cyan-300">
                            {activeScanResult.gateNodeId || 'Peer Gate'}
                          </span>
                        </span>
                      ) : (
                        <span>{activeScanResult.error}</span>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setActiveScanResult(null)}
                  className="text-slate-400 hover:text-white text-xs font-medium"
                >
                  Dismiss
                </button>
              </div>
            </div>
          );
        })()}

      {/* Scanner Mode Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Camera Scanner View */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 flex flex-col items-center justify-center text-center">
          <div className="w-full flex items-center justify-between mb-4">
            <span className="text-xs font-semibold text-white flex items-center gap-2">
              <Camera className="h-4 w-4 text-cyan-400" />
              <span>Camera Barcode Scanner</span>
            </span>
            <button
              onClick={toggleCamera}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                cameraActive
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : 'bg-cyan-500 text-white'
              }`}
            >
              {cameraActive ? 'Stop Camera' : 'Start Camera'}
            </button>
          </div>

          <div className="w-full h-64 rounded-xl border-2 border-dashed border-slate-800 bg-slate-950 flex items-center justify-center overflow-hidden relative">
            <div id="qr-reader" className="w-full h-full" />
            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 text-xs gap-2">
                <QrCode className="h-10 w-10 text-slate-700" />
                <span>Click "Start Camera" to scan passes via webcam or phone camera</span>
              </div>
            )}
          </div>
        </div>

        {/* Manual Token Input View */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold text-white flex items-center gap-2">
                <Keyboard className="h-4 w-4 text-cyan-400" />
                <span>Manual Token / Barcode Fallback</span>
              </span>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Paste or type any Ed25519 signed ticket string
              (`FP1.&lt;ticketId&gt;.&lt;eventId&gt;.&lt;sig&gt;`) to execute verification against
              Gate Quorum.
            </p>

            <form onSubmit={handleManualSubmit} className="space-y-3">
              <textarea
                rows={4}
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="Paste token: FP1.242162..."
                className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs font-mono text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
              />

              <button
                type="submit"
                disabled={isScanning || !manualToken.trim()}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-cyan-600 py-2.5 text-xs font-semibold text-white shadow hover:bg-cyan-500 disabled:opacity-50 transition"
              >
                {isScanning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Verifying with Gate Quorum...</span>
                  </>
                ) : (
                  <>
                    <QrCode className="h-4 w-4" />
                    <span>Verify & Check In</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {pendingCount > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-400 font-mono">{pendingCount} offline scans pending</span>
              <button
                onClick={handleSyncOffline}
                disabled={isSyncing}
                className="text-cyan-400 hover:underline flex items-center gap-1"
              >
                <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>Sync with gate</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Recent Scan History */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-xl">
        <div className="flex items-center gap-2 text-xs font-bold text-white mb-3">
          <History className="h-4 w-4 text-cyan-400" />
          <span>Recent Scan Activity (This Session)</span>
        </div>

        {scanHistory.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500">
            No scans recorded yet this session.
          </div>
        ) : (
          <div className="space-y-2">
            {scanHistory.map((s, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-xl border border-slate-800/80 bg-slate-950 px-3.5 py-2 text-xs"
              >
                <div className="flex items-center gap-2.5">
                  {s.result === 'accepted' ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  ) : s.result === 'rejected_duplicate' ? (
                    <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                  )}
                  <div>
                    <span className="font-mono text-slate-200">
                      {s.ticketId || s.token?.slice(0, 20)}...
                    </span>
                    <span className="ml-2 font-semibold text-[10px] uppercase text-slate-400">
                      {s.result} ({s.mode || 'online'})
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-slate-500 font-mono text-[11px]">
                  <span>{s.latencyMs}ms</span>
                  <span>{s.timestamp}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
