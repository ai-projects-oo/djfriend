import { useMemo, useState } from "react";
import type { Playlist, SmartCriteria, SmartField, SmartLimitBy, SmartOp, SmartRule } from "../types";
import { SMART_FIELDS, OPS_BY_KIND, defaultRule, fieldKind, invalidRules } from "../lib/smartPlaylists";

const CAMELOT_KEYS = Array.from({ length: 12 }, (_, i) => [`${i + 1}A`, `${i + 1}B`]).flat();
const LIMIT_BY: { by: SmartLimitBy; label: string }[] = [
  { by: "random", label: "random" },
  { by: "energy", label: "highest energy" },
  { by: "bpm", label: "lowest BPM" },
  { by: "dateAdded", label: "most recently added" },
  { by: "title", label: "title" },
  { by: "mostPlayed", label: "most used in sets" },
  { by: "leastPlayed", label: "least used in sets" },
];

const newId = () => crypto.randomUUID();

interface Props {
  /** Existing smart playlist to edit; omit to create one. */
  initial?: { name: string; smart: SmartCriteria };
  /** Playlists a rule can refer to (the edited one is excluded by the caller). */
  playlists: Playlist[];
  /** Number of library tracks the rules match right now. */
  countMatches: (criteria: SmartCriteria) => number;
  onSave: (name: string, criteria: SmartCriteria) => void;
  onClose: () => void;
}

const selectClass = "bg-[#1c1c2e] border border-[#363650] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed] cursor-pointer";
const inputClass = "bg-[#1c1c2e] border border-[#363650] rounded px-2 py-1 text-xs text-[#e2e8f0] focus:outline-none focus:border-[#7c3aed]";

export default function SmartPlaylistEditor({ initial, playlists, countMatches, onSave, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? "Smart Playlist");
  const [match, setMatch] = useState<SmartCriteria["match"]>(initial?.smart.match ?? "all");
  const [rules, setRules] = useState<SmartRule[]>(initial?.smart.rules.length ? initial.smart.rules : [defaultRule(newId(), "bpm")]);
  const [limitOn, setLimitOn] = useState(!!initial?.smart.limit);
  const [limitCount, setLimitCount] = useState(String(initial?.smart.limit?.count ?? 50));
  const [limitBy, setLimitBy] = useState<SmartLimitBy>(initial?.smart.limit?.by ?? "random");

  const criteria = useMemo<SmartCriteria>(() => ({
    match,
    rules,
    ...(limitOn && Number(limitCount) > 0 ? { limit: { count: Math.floor(Number(limitCount)), by: limitBy } } : {}),
  }), [match, rules, limitOn, limitCount, limitBy]);
  const count = useMemo(() => countMatches(criteria), [countMatches, criteria]);
  const invalid = useMemo(() => new Set(invalidRules(criteria)), [criteria]);

  const updateRule = (id: string, patch: Partial<SmartRule>) => setRules(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const changeField = (id: string, field: SmartField) => setRules(rs => rs.map(r => (r.id === id ? defaultRule(id, field) : r)));
  const addRuleAfter = (id: string) => setRules(rs => {
    const i = rs.findIndex(r => r.id === id);
    const next = [...rs];
    next.splice(i + 1, 0, defaultRule(newId(), "genre"));
    return next;
  });
  const removeRule = (id: string) => setRules(rs => rs.filter(r => r.id !== id));

  const valueInput = (r: SmartRule) => {
    const kind = fieldKind(r.field);
    const bad = invalid.has(r.id) ? " border-[#ef4444]/70" : "";
    switch (kind) {
      case "number":
        return (
          <span className="flex items-center gap-1">
            <input aria-label="Value" type="number" value={r.value} onChange={e => updateRule(r.id, { value: e.target.value })} className={`${inputClass} w-20${bad}`} />
            {r.op === "between" && (
              <>
                <span className="text-[10px] text-[#9aa8ba]">and</span>
                <input aria-label="Upper value" type="number" value={r.value2 ?? ""} onChange={e => updateRule(r.id, { value2: e.target.value })} className={`${inputClass} w-20${bad}`} />
              </>
            )}
            {SMART_FIELDS.find(f => f.field === r.field)?.unit && <span className="text-[10px] text-[#9aa8ba]">{SMART_FIELDS.find(f => f.field === r.field)!.unit}</span>}
          </span>
        );
      case "key":
        return (
          <select aria-label="Key" value={r.value} onChange={e => updateRule(r.id, { value: e.target.value })} className={selectClass}>
            {CAMELOT_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        );
      case "vocal":
        return (
          <select aria-label="Vocals" value={r.value} onChange={e => updateRule(r.id, { value: e.target.value })} className={selectClass}>
            <option value="instrumental">instrumental</option>
            <option value="mostly-vocal">mostly vocal</option>
            <option value="vocal">vocal</option>
          </select>
        );
      case "days":
        return <input aria-label="Days" type="number" min={0} value={r.value} onChange={e => updateRule(r.id, { value: e.target.value })} className={`${inputClass} w-20${bad}`} />;
      case "playlist":
        return (
          <select aria-label="Playlist" value={r.value} onChange={e => updateRule(r.id, { value: e.target.value })} className={`${selectClass}${bad}`}>
            <option value="">Choose…</option>
            {[...playlists].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.smart ? "⚙ " : ""}{p.name}</option>)}
          </select>
        );
      default:
        return <input aria-label="Value" type="text" value={r.value} placeholder="text…" onChange={e => updateRule(r.id, { value: e.target.value })} className={`${inputClass} w-40${bad}`} />;
    }
  };

  const canSave = name.trim().length > 0 && invalid.size === 0;

  return (
    <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={initial ? "Edit smart playlist" : "New smart playlist"}
        className="w-full max-w-2xl rounded-xl border border-[#363650] bg-[#20202e] p-5 flex flex-col gap-4 max-h-[90vh]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <span className="text-lg" aria-hidden>⚙</span>
          <input aria-label="Smart playlist name" value={name} onChange={e => setName(e.target.value)} autoFocus
            className="flex-1 bg-transparent border-b border-[#363650] focus:border-[#7c3aed] text-sm font-semibold text-[#e2e8f0] outline-none pb-1" />
        </div>

        <div className="flex items-center gap-2 text-xs text-[#ccd6e2]">
          Match
          <select aria-label="Match all or any" value={match} onChange={e => setMatch(e.target.value as SmartCriteria["match"])} className={selectClass}>
            <option value="all">all</option>
            <option value="any">any</option>
          </select>
          of the following rules:
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto pr-1">
          {rules.map(r => {
            const kind = fieldKind(r.field);
            return (
              <div key={r.id} className="flex items-center gap-2 flex-wrap" role="group" aria-label="Rule">
                <select aria-label="Field" value={r.field} onChange={e => changeField(r.id, e.target.value as SmartField)} className={selectClass}>
                  {SMART_FIELDS.map(f => <option key={f.field} value={f.field}>{f.label}</option>)}
                </select>
                <select aria-label="Condition" value={r.op} onChange={e => updateRule(r.id, { op: e.target.value as SmartOp, ...(e.target.value === "between" && r.value2 == null ? { value2: r.value } : {}) })} className={selectClass}>
                  {OPS_BY_KIND[kind].map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                </select>
                {valueInput(r)}
                <span className="ml-auto flex gap-1">
                  <button type="button" aria-label="Remove rule" title="Remove rule" disabled={rules.length === 1} onClick={() => removeRule(r.id)}
                    className="w-6 h-6 rounded border border-[#363650] text-[#b6c2d0] hover:text-[#ef4444] disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed">−</button>
                  <button type="button" aria-label="Add rule" title="Add rule" onClick={() => addRuleAfter(r.id)}
                    className="w-6 h-6 rounded border border-[#363650] text-[#b6c2d0] hover:text-[#a78bfa] cursor-pointer">+</button>
                </span>
              </div>
            );
          })}
        </div>

        <label className="flex items-center gap-2 text-xs text-[#ccd6e2] flex-wrap">
          <input type="checkbox" checked={limitOn} onChange={e => setLimitOn(e.target.checked)} className="w-3.5 h-3.5 accent-[#7c3aed] cursor-pointer" />
          Limit to
          <input aria-label="Limit count" type="number" min={1} value={limitCount} disabled={!limitOn} onChange={e => setLimitCount(e.target.value)} className={`${inputClass} w-16 disabled:opacity-40`} />
          tracks, selected by
          <select aria-label="Limit by" value={limitBy} disabled={!limitOn} onChange={e => setLimitBy(e.target.value as SmartLimitBy)} className={`${selectClass} disabled:opacity-40`}>
            {LIMIT_BY.map(l => <option key={l.by} value={l.by}>{l.label}</option>)}
          </select>
        </label>

        <div className="flex items-center gap-3 pt-1 border-t border-[#2c2c42]">
          <span className="text-xs text-[#a78bfa] tabular-nums" aria-live="polite">{count} track{count === 1 ? "" : "s"} match</span>
          {invalid.size > 0 && <span className="text-[10px] text-[#ef4444]">Fill in the highlighted rule{invalid.size === 1 ? "" : "s"}</span>}
          <span className="text-[10px] text-[#8d9aab]">Updates automatically as your library changes.</span>
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs rounded-md border border-[#363650] text-[#b6c2d0] hover:text-[#ccd6e2] cursor-pointer">Cancel</button>
            <button type="button" disabled={!canSave} onClick={() => onSave(name.trim(), criteria)}
              className="px-3 py-1.5 text-xs rounded-md bg-[#7c3aed] text-white hover:bg-[#6d28d9] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
              {initial ? "Save" : "Create"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
