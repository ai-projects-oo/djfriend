import { useMemo, useState } from "react";
import { groupGenresByFamily } from "../lib/genreUtils";

/** Below this many tracks a genre can't fill a typical set — shown dimmed. */
const THIN = 10;

interface Props {
  /** Umbrella genre labels present in the library (e.g. "Tech House"). */
  labels: string[];
  /** Selected genre values ("~Tech House"). */
  selected: string[];
  /** Tracks in the current source matching any of these genre values. */
  countFor: (values: string[]) => number;
  onToggle: (value: string) => void;
  onClear: () => void;
}

const v = (label: string) => `~${label}`;

/**
 * Genre selection for the Set Generator: families (click to pick the whole family), track counts,
 * a search box, and the current picks pinned at the top.
 */
export default function GenrePicker({ labels, selected, countFor, onToggle, onClear }: Props) {
  const [query, setQuery] = useState("");
  const counts = useMemo(() => new Map(labels.map(l => [l, countFor([v(l)])])), [labels, countFor]);
  const families = useMemo(() => groupGenresByFamily(labels, counts), [labels, counts]);
  const selectedSet = new Set(selected);
  // Families start open when they hold a pick; otherwise only the biggest family is open
  const [open, setOpen] = useState<Set<string>>(() => {
    const withPick = families.filter(f => f.labels.some(l => selectedSet.has(v(l)))).map(f => f.family);
    return new Set(withPick.length ? withPick : families.slice(0, 1).map(f => f.family));
  });
  const toggleOpen = (family: string) => setOpen(prev => { const n = new Set(prev); if (n.has(family)) n.delete(family); else n.add(family); return n; });

  const toggleFamily = (familyLabels: string[]) => {
    const all = familyLabels.every(l => selectedSet.has(v(l)));
    for (const l of familyLabels) if (all === selectedSet.has(v(l))) onToggle(v(l));
  };

  const chip = (label: string) => {
    const active = selectedSet.has(v(label));
    const n = counts.get(label) ?? 0;
    return (
      <button key={label} type="button" onClick={() => onToggle(v(label))} aria-pressed={active}
        title={n < THIN ? `Only ${n} track${n === 1 ? "" : "s"} — may not fill a set` : `${n} tracks`}
        className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-all cursor-pointer border flex items-center gap-1 ${n < THIN && !active ? "opacity-45" : ""}`}
        style={{ backgroundColor: active ? "#7c3aed" : "transparent", color: active ? "#fff" : "#a78bfa", borderColor: active ? "#7c3aed" : "#5a24a8" }}>
        {label}
        <span className={`text-[9px] tabular-nums ${active ? "text-white/70" : "text-[#9aa8ba]"}`}>{n}</span>
      </button>
    );
  };

  const q = query.trim().toLowerCase();
  const matches = q ? labels.filter(l => l.toLowerCase().includes(q)).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0)) : [];
  const picked = selected.filter(s => s.startsWith("~")).map(s => s.slice(1));

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest font-semibold text-[#b6c2d0]">Genre</span>
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find genre…" aria-label="Find genre"
          className="flex-1 min-w-0 bg-[#16161e] border border-[#2c2c42] rounded-md px-2 py-0.5 text-[11px] text-[#e2e8f0] placeholder-[#7d8ba0] focus:outline-none focus:border-[#7c3aed]" />
        {selected.length > 0 && (
          <button type="button" onClick={onClear} className="text-[10px] text-[#b6c2d0] hover:text-[#ccd5df] cursor-pointer">clear</button>
        )}
      </div>

      {picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Selected genres">
          {picked.map(l => (
            <button key={l} type="button" onClick={() => onToggle(v(l))} aria-label={`Remove ${l}`}
              className="pl-2 pr-1.5 py-0.5 rounded-full text-[11px] font-medium bg-[#7c3aed] text-white flex items-center gap-1 cursor-pointer hover:bg-[#6d28d9]">
              {l}<span aria-hidden className="text-white/70">×</span>
            </button>
          ))}
          <span className="text-[10px] text-[#9aa8ba]">{countFor(selected)} tracks</span>
        </div>
      )}

      {q ? (
        <div className="flex flex-wrap gap-1.5">
          {matches.length ? matches.map(chip) : <span className="text-[11px] text-[#9aa8ba]">No genre matches “{query}”</span>}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {families.map(f => {
            const isOpen = open.has(f.family);
            const values = f.labels.map(v);
            const allOn = f.labels.every(l => selectedSet.has(v(l)));
            const someOn = !allOn && f.labels.some(l => selectedSet.has(v(l)));
            return (
              <div key={f.family}>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => toggleOpen(f.family)} aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${f.family}`}
                    className="w-4 text-[9px] text-[#9aa8ba] hover:text-[#e2e8f0] cursor-pointer">{isOpen ? "▾" : "▸"}</button>
                  <button type="button" onClick={() => toggleFamily(f.labels)} aria-pressed={allOn}
                    title={allOn ? `Deselect all ${f.family}` : `Select all ${f.family}`}
                    className={`text-xs font-semibold cursor-pointer transition-colors ${allOn ? "text-white" : someOn ? "text-[#c4b5fd]" : "text-[#ccd6e2] hover:text-white"}`}>
                    {f.family}
                  </button>
                  <span className="text-[10px] text-[#8d9aab] tabular-nums">{countFor(values)}</span>
                  {someOn && <span className="w-1.5 h-1.5 rounded-full bg-[#a78bfa]" aria-label="Some selected" />}
                </div>
                {isOpen && <div className="flex flex-wrap gap-1.5 pl-5 pt-1.5 pb-0.5">{f.labels.map(chip)}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
