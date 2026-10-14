import { useEffect, useMemo, useRef, useState } from "react";
import type { AppleMusicExportResult, AppleMusicKeyField } from "../types";
import { skipReasonText, type AppleMusicExportOptions, type PreparedExport } from "../lib/appleMusicExport";
import { exportToAppleMusic, type AppleMusicExportProgress } from "../services/appleMusicExport";

const LS_KEY = "djfriend:appleMusicExportOptions";

function loadOptions(): AppleMusicExportOptions {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { addMissing: true, writeBack: null, ...(JSON.parse(raw) as Partial<AppleMusicExportOptions>) };
  } catch { /* defaults */ }
  return { addMissing: true, writeBack: null };
}

interface Props {
  /** "Push “Warmup” to Apple Music" or "Export all playlists to Apple Music". */
  title: string;
  /** Builds the job for the chosen options (pure; called on every option change). */
  prepare: (opts: AppleMusicExportOptions) => PreparedExport;
  playlistNames: Map<string, string>;
  onDone: (result: AppleMusicExportResult) => void;
  onClose: () => void;
}

type Stage =
  | { kind: "options" }
  | { kind: "running"; progress: AppleMusicExportProgress | null; playlistIndex: number }
  | { kind: "done"; result: AppleMusicExportResult }
  | { kind: "error"; message: string };

function progressText(p: AppleMusicExportProgress | null): string {
  if (!p) return "Opening Music…";
  switch (p.phase) {
    case "index":    return "Reading your Music library…";
    case "library":  return `Adding files to Music (${p.done}/${p.total})…`;
    case "playlist": return `Writing “${p.name}” (${p.index + 1}/${p.total})…`;
    case "tracks":   return `Writing “${p.name}” — ${p.done}/${p.total} tracks…`;
    case "tagging":  return `Writing BPM & key (${p.done}/${p.total})…`;
  }
}

function progressFraction(stage: Extract<Stage, { kind: "running" }>, playlistTotal: number): number | null {
  const p = stage.progress;
  if (!p || playlistTotal === 0) return null;
  if (p.phase === "playlist") return p.index / playlistTotal;
  if (p.phase === "tracks") return (stage.playlistIndex + (p.total ? p.done / p.total : 0)) / playlistTotal;
  if (p.phase === "tagging") return 1;
  return null;
}

export default function AppleMusicExportDialog({ title, prepare, playlistNames, onDone, onClose }: Props) {
  const [opts, setOpts] = useState<AppleMusicExportOptions>(loadOptions);
  const [stage, setStage] = useState<Stage>({ kind: "options" });
  const [showSkipped, setShowSkipped] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const prepared = useMemo(() => prepare(opts), [prepare, opts]);
  const skippedTotal = Object.values(prepared.skipped).reduce((n, list) => n + list.length, 0);

  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(opts)); } catch { /* ignore */ } }, [opts]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setStage({ kind: "running", progress: null, playlistIndex: 0 });
    try {
      const result = await exportToAppleMusic(prepared.job, p => {
        setStage(s => s.kind === "running"
          ? { kind: "running", progress: p, playlistIndex: p.phase === "playlist" ? p.index : s.playlistIndex }
          : s);
      }, controller.signal);
      onDone(result);
      setStage({ kind: "done", result });
    } catch (err) {
      if (controller.signal.aborted) { setStage({ kind: "options" }); return; }
      setStage({ kind: "error", message: err instanceof Error ? err.message : "Export failed" });
    } finally {
      abortRef.current = null;
    }
  };

  const running = stage.kind === "running";
  const setKeyField = (f: AppleMusicKeyField | null) => setOpts(o => ({ ...o, writeBack: f }));

  return (
    <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4" onClick={() => { if (!running) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="w-full max-w-md rounded-xl border border-[#363650] bg-[#20202e] p-5 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-[#e2e8f0]"> {title}</h3>
          {!running && (
            <button type="button" onClick={onClose} aria-label="Close" className="text-xs text-[#8394a8] hover:text-[#e2e8f0] cursor-pointer">Close</button>
          )}
        </div>

        {stage.kind === "options" && (
          <>
            <p className="text-xs text-[#8394a8] leading-relaxed">
              {prepared.job.playlists.length} playlist{prepared.job.playlists.length === 1 ? "" : "s"} · {prepared.trackCount} tracks go into the
              <span className="text-[#a6b5c8]"> DJFriend</span> folder in Music. Pushing again replaces their contents.
              Your other Music playlists aren’t touched.
            </p>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={opts.addMissing} onChange={e => setOpts(o => ({ ...o, addMissing: e.target.checked }))}
                className="mt-0.5 w-3.5 h-3.5 accent-[#7c3aed] cursor-pointer" />
              <span className="text-xs text-[#a6b5c8]">
                Add tracks that aren’t in your Music library yet
                <span className="block text-[10px] text-[#64748b]">Otherwise they’re left out of the Music playlist.</span>
              </span>
            </label>

            <div className="flex flex-col gap-1.5">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" checked={opts.writeBack !== null} onChange={e => setKeyField(e.target.checked ? "grouping" : null)}
                  className="mt-0.5 w-3.5 h-3.5 accent-[#7c3aed] cursor-pointer" />
                <span className="text-xs text-[#a6b5c8]">
                  Write BPM and key to the Music tracks
                  <span className="block text-[10px] text-[#64748b]">So Rekordbox and Serato see them when importing from Apple Music. Overwrites Music’s BPM.</span>
                </span>
              </label>
              {opts.writeBack !== null && (
                <div className="ml-6 flex flex-col gap-1" role="radiogroup" aria-label="Field for the key">
                  {([
                    ["grouping", "Grouping field", "replaces the grouping, e.g. “8A”"],
                    ["comment", "Comment field", "adds “8A · ” in front of the existing comment"],
                  ] as const).map(([value, label, hint]) => (
                    <label key={value} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="keyField" checked={opts.writeBack === value} onChange={() => setKeyField(value)}
                        className="w-3 h-3 accent-[#7c3aed] cursor-pointer" />
                      <span className="text-[11px] text-[#a6b5c8]">{label} <span className="text-[#64748b]">— {hint}</span></span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {skippedTotal > 0 && (
              <div className="text-[11px] text-[#f59e0b]">
                <button type="button" onClick={() => setShowSkipped(s => !s)} className="cursor-pointer hover:underline">
                  {skippedTotal} track{skippedTotal === 1 ? "" : "s"} can’t be exported {showSkipped ? "▴" : "▾"}
                </button>
                {showSkipped && (
                  <ul className="mt-1.5 max-h-32 overflow-y-auto flex flex-col gap-0.5 text-[10px] text-[#8394a8]">
                    {Object.entries(prepared.skipped).flatMap(([pid, list]) => list.map((s, i) => (
                      <li key={`${pid}-${i}`} className="truncate">{playlistNames.get(pid)}: {s.title} <span className="text-[#58656e]">({skipReasonText(s.reason)})</span></li>
                    )))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs rounded-md border border-[#363650] text-[#8292a4] hover:text-[#a6b5c8] cursor-pointer">Cancel</button>
              <button type="button" onClick={() => void start()} disabled={prepared.trackCount === 0}
                className="px-3 py-1.5 text-xs rounded-md bg-[#7c3aed] text-white hover:bg-[#6d28d9] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                Export to Music
              </button>
            </div>
          </>
        )}

        {stage.kind === "running" && (() => {
          const frac = progressFraction(stage, prepared.job.playlists.length);
          return (
            <div className="flex flex-col gap-3" aria-live="polite">
              <p className="text-xs text-[#a6b5c8]">{progressText(stage.progress)}</p>
              <div className="h-1 bg-[#2c2c42] rounded-full overflow-hidden">
                <div className={`h-full bg-[#7c3aed] rounded-full transition-all ${frac === null ? "animate-pulse w-full" : ""}`}
                  style={frac === null ? undefined : { width: `${Math.round(frac * 100)}%` }} />
              </div>
              <p className="text-[10px] text-[#64748b]">Music may open. The first time, macOS asks to let DJFriend control Music — click OK.</p>
              <div className="flex justify-end">
                <button type="button" onClick={() => abortRef.current?.abort()} className="px-3 py-1.5 text-xs rounded-md border border-[#363650] text-[#8292a4] hover:text-[#ef4444] cursor-pointer">Cancel</button>
              </div>
            </div>
          );
        })()}

        {stage.kind === "done" && (() => {
          const r = stage.result;
          const entries = Object.entries(r.playlists);
          const added = entries.reduce((n, [, p]) => n + p.added, 0);
          const notInMusic = entries.reduce((n, [, p]) => n + p.skipped.length, 0);
          return (
            <div className="flex flex-col gap-2" aria-live="polite">
              <p className="text-xs text-[#34d399]">✓ Exported {entries.length} playlist{entries.length === 1 ? "" : "s"} with {added} tracks to Music.</p>
              <ul className="text-[11px] text-[#8394a8] flex flex-col gap-0.5">
                {r.addedToLibrary > 0 && <li>{r.addedToLibrary} file{r.addedToLibrary === 1 ? "" : "s"} added to your Music library</li>}
                {r.tagged > 0 && <li>BPM / key written to {r.tagged} track{r.tagged === 1 ? "" : "s"}</li>}
                {notInMusic > 0 && <li className="text-[#f59e0b]">{notInMusic} track{notInMusic === 1 ? "" : "s"} weren’t in Music and were left out</li>}
                {skippedTotal > 0 && <li className="text-[#f59e0b]">{skippedTotal} track{skippedTotal === 1 ? "" : "s"} had no local file</li>}
              </ul>
              {r.errors.length > 0 && (
                <details className="text-[10px] text-[#ef4444]">
                  <summary className="cursor-pointer">{r.errors.length} problem{r.errors.length === 1 ? "" : "s"}</summary>
                  <ul className="mt-1 max-h-28 overflow-y-auto">{r.errors.map((e, i) => <li key={i} className="truncate" title={e}>{e}</li>)}</ul>
                </details>
              )}
              <div className="flex justify-end">
                <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs rounded-md bg-[#7c3aed] text-white hover:bg-[#6d28d9] cursor-pointer">Done</button>
              </div>
            </div>
          );
        })()}

        {stage.kind === "error" && (
          <div className="flex flex-col gap-3" role="alert">
            <p className="text-xs text-[#ef4444] leading-relaxed">{stage.message}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs rounded-md border border-[#363650] text-[#8292a4] cursor-pointer">Close</button>
              <button type="button" onClick={() => setStage({ kind: "options" })} className="px-3 py-1.5 text-xs rounded-md bg-[#7c3aed] text-white hover:bg-[#6d28d9] cursor-pointer">Try again</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
