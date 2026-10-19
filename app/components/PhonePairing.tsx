import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { PairingPayload } from "../types";
import type { DeviceSyncStatus } from "../hooks/useDeviceSync";
import { DEFAULT_RELAY } from "../services/deviceSync";

export interface PhonePairingProps {
  pairing: PairingPayload | null;
  status: DeviceSyncStatus;
  onPair: (relay?: string) => void;
  onUnpair: () => Promise<void>;
  onSyncNow: () => void;
}

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
}

/** Settings → Phone: pair the DJFriend mobile app by QR code; end-to-end encrypted sync. */
export default function PhonePairing({ pairing, status, onPair, onUnpair, onSyncNow }: PhonePairingProps) {
  const [qrFor, setQrFor] = useState<{ syncId: string; url: string } | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [relay, setRelay] = useState(DEFAULT_RELAY);
  const [advanced, setAdvanced] = useState(false);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!pairing || !showQr) return;
    let alive = true;
    void QRCode.toDataURL(JSON.stringify(pairing), { margin: 1, width: 220, errorCorrectionLevel: "M" })
      .then(url => { if (alive) setQrFor({ syncId: pairing.syncId, url }); });
    return () => { alive = false; };
  }, [pairing, showQr]);
  // Only ever show the code for the current pairing
  const qr = pairing && showQr && qrFor?.syncId === pairing.syncId ? qrFor.url : null;

  const btn = "px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer";

  return (
    <div id="phone-sync">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-[#b6c2d0] mb-1">Phone</h3>
      <p className="text-[11px] text-[#9aa8ba] mb-3 leading-snug">
        Pair the DJFriend phone app to sync your library, playlists, sets and vinyl keys. Everything is encrypted on your devices —
        the sync server only stores data it can't read. No account needed.
      </p>

      {!pairing ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { onPair(relay); setShowQr(true); }} className={`${btn} bg-[#7c3aed] hover:bg-[#6d28d9] text-white`}>
              Pair a phone
            </button>
            <button type="button" onClick={() => setAdvanced(a => !a)} className="text-[10px] text-[#9aa8ba] hover:text-[#ccd6e2] cursor-pointer">
              {advanced ? "Hide" : "Advanced"}
            </button>
          </div>
          {advanced && (
            <label className="flex flex-col gap-1 text-[10px] text-[#9aa8ba]">
              Sync server
              <input value={relay} onChange={e => setRelay(e.target.value)} aria-label="Sync server URL"
                className="bg-[#1c1c2e] border border-[#2c2c42] rounded px-2 py-1 text-[11px] text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed]" />
            </label>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-[11px]">
            <span className={`w-2 h-2 rounded-full ${status.error ? "bg-[#ef4444]" : status.syncing ? "bg-[#f59e0b] animate-pulse" : "bg-[#22c55e]"}`} aria-hidden />
            <span className="text-[#ccd6e2]">
              {status.error ? `Sync error: ${status.error}` : status.syncing ? "Syncing…" : status.lastSync ? `Synced ${ago(status.lastSync)}` : "Paired — waiting for first sync"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setShowQr(s => !s); setCopied(false); }} className={`${btn} border border-[#363650] text-[#ccd6e2] hover:text-[#e2e8f0]`}>
              {showQr ? "Hide QR code" : "Show QR code"}
            </button>
            <button type="button" onClick={onSyncNow} disabled={status.syncing} className={`${btn} border border-[#363650] text-[#ccd6e2] hover:text-[#e2e8f0] disabled:opacity-40`}>
              Sync now
            </button>
            {!confirmUnpair ? (
              <button type="button" onClick={() => setConfirmUnpair(true)} className={`${btn} border border-[#ef4444]/40 text-[#ef4444]/80 hover:bg-[#ef4444]/10`}>
                Unpair
              </button>
            ) : (
              <span className="flex items-center gap-2 text-[11px] text-[#ccd6e2]">
                Unpair all phones and delete the synced copy?
                <button type="button" onClick={() => { void onUnpair(); setConfirmUnpair(false); setShowQr(false); }} className={`${btn} bg-[#ef4444] text-white`}>Unpair</button>
                <button type="button" onClick={() => setConfirmUnpair(false)} className={`${btn} text-[#9aa8ba]`}>Cancel</button>
              </span>
            )}
          </div>
          {showQr && (
            <div className="flex items-start gap-3">
              {qr
                ? <img src={qr} alt="Pairing QR code — scan with the DJFriend phone app" width={180} height={180} className="rounded-lg bg-white p-1" />
                : <div className="w-[180px] h-[180px] rounded-lg bg-[#1c1c2e]" aria-hidden />}
              <p className="text-[11px] text-[#9aa8ba] leading-snug max-w-[220px]">
                Open DJFriend on your phone and scan this code.
                <br />
                <button type="button" onClick={() => { void navigator.clipboard.writeText(JSON.stringify(pairing)); setCopied(true); }}
                  className="mt-1 text-[#a78bfa] hover:text-[#c4b5fd] cursor-pointer" aria-label="Copy pairing code">
                  {copied ? "Copied — paste it in the phone app" : "Copy code instead"}
                </button>
                <br /><br />
                <span className="text-[#f59e0b]">Treat this code like a password</span> — anyone who scans it can read your synced data.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
