import { useEffect, useRef, useState } from "react";
import { captureInput, detectFromCapture, listInputs, rememberInput, rememberedInput, type InputDevice, type VinylDetection } from "../services/vinylCapture";

const LISTEN_SECONDS = 45;

type Phase =
  | { kind: "idle" }
  | { kind: "setup"; devices: InputDevice[] }
  | { kind: "listening"; frac: number; level: number }
  | { kind: "analyzing" }
  | { kind: "error"; message: string };

interface Props {
  trackLabel: string;
  onDetected: (r: VinylDetection) => void;
}

/** "Detect" for a vinyl track: play the record into an audio input, listen 45 s, detect key + BPM locally. */
export default function VinylKeyDetect({ trackLabel, onDetected }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [deviceId, setDeviceId] = useState<string | null>(rememberedInput);
  const abortRef = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (phase.kind !== "setup" && phase.kind !== "error") return;
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setPhase({ kind: "idle" }); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [phase.kind]);

  const open = async () => {
    try {
      const devices = await listInputs();
      if (devices.length === 0) { setPhase({ kind: "error", message: "No audio input found. Connect your turntable / mixer to an audio input." }); return; }
      if (!deviceId || !devices.some(d => d.deviceId === deviceId)) setDeviceId(devices[0].deviceId);
      setPhase({ kind: "setup", devices });
    } catch {
      setPhase({ kind: "error", message: "Microphone / audio-input access was denied. Allow it in System Settings → Privacy & Security → Microphone." });
    }
  };

  const listen = async () => {
    if (deviceId) rememberInput(deviceId);
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase({ kind: "listening", frac: 0, level: 0 });
    try {
      const { samples, sampleRate } = await captureInput(deviceId, LISTEN_SECONDS, (frac, level) => setPhase({ kind: "listening", frac, level }), ac.signal);
      setPhase({ kind: "analyzing" });
      const r = await detectFromCapture(samples, sampleRate);
      onDetected(r);
      setPhase({ kind: "idle" });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") { setPhase({ kind: "idle" }); return; }
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "Detection failed" });
    } finally {
      abortRef.current = null;
    }
  };

  const busy = phase.kind === "listening" || phase.kind === "analyzing";
  return (
    <div ref={boxRef} className="relative">
      <button type="button" onClick={busy ? () => abortRef.current?.abort() : () => void open()}
        aria-label={busy ? `Stop listening to ${trackLabel}` : `Detect key and BPM of ${trackLabel} from the record`}
        title={busy ? "Stop" : "Detect key + BPM: play the record into your audio input"}
        className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer flex items-center gap-1 ${busy ? "border-[#7c3aed] text-[#c4b5fd] bg-[#7c3aed]/15" : "border-[#2c2c42] text-[#8394a8] hover:text-[#e2e8f0] hover:border-[#7c3aed]"}`}>
        {phase.kind === "listening" ? (
          <>
            <span className="w-8 h-1 rounded-full bg-[#2c2c42] overflow-hidden inline-block" aria-hidden>
              <span className="block h-full bg-[#7c3aed]" style={{ width: `${phase.frac * 100}%` }} />
            </span>
            {Math.ceil(LISTEN_SECONDS * (1 - phase.frac))}s ■
          </>
        ) : phase.kind === "analyzing" ? "Analyzing…" : "🎙 Detect"}
      </button>

      {phase.kind === "listening" && (
        <div className="absolute right-0 top-full mt-1 z-20 w-56 rounded-lg border border-[#363650] bg-[#20202e] p-2 shadow-2xl text-[10px] text-[#8394a8]">
          Listening — keep the record playing.
          <div className="mt-1.5 h-1.5 rounded-full bg-[#2c2c42] overflow-hidden" aria-label="Input level">
            <div className={`h-full ${phase.level > 0.95 ? "bg-[#ef4444]" : phase.level < 0.02 ? "bg-[#f59e0b]" : "bg-[#22c55e]"}`} style={{ width: `${Math.min(1, phase.level) * 100}%` }} />
          </div>
          {phase.level < 0.02 && <p className="mt-1 text-[#f59e0b]">No signal — check the input and level.</p>}
          {phase.level > 0.95 && <p className="mt-1 text-[#ef4444]">Clipping — lower the input level.</p>}
        </div>
      )}

      {phase.kind === "setup" && (
        <div role="dialog" aria-label="Detect key from record"
          className="absolute right-0 top-full mt-1 z-20 w-64 rounded-lg border border-[#363650] bg-[#20202e] p-2.5 shadow-2xl flex flex-col gap-2">
          <p className="text-[10px] text-[#8394a8] leading-snug">
            Play <span className="text-[#e2e8f0]">{trackLabel}</span> into an audio input (mixer line-out or audio interface), from its main section. DJFriend listens for {LISTEN_SECONDS} s and analyses it on this computer — nothing is recorded or saved.
          </p>
          <label className="text-[9px] uppercase tracking-widest font-semibold text-[#6b7a94]" htmlFor="vinyl-input">Audio input</label>
          <select id="vinyl-input" value={deviceId ?? ""} onChange={e => setDeviceId(e.target.value)}
            className="bg-[#1c1c2e] border border-[#2c2c42] rounded px-1.5 py-1 text-[11px] text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] cursor-pointer">
            {phase.devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
          </select>
          <button type="button" onClick={() => void listen()}
            className="rounded-md bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-[11px] font-medium py-1.5 cursor-pointer transition-colors">
            Start listening
          </button>
        </div>
      )}

      {phase.kind === "error" && (
        <div role="alert" className="absolute right-0 top-full mt-1 z-20 w-60 rounded-lg border border-[#ef4444]/40 bg-[#20202e] p-2 shadow-2xl text-[10px] text-[#fca5a5]">
          {phase.message}
        </div>
      )}
    </div>
  );
}
