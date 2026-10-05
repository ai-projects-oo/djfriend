import { useState } from 'react';
import { getSetPlan, VENUE_TYPES, SET_PHASES } from '../lib/venuePlanner';
import type { VenueType, SetPhase, SetPlan } from '../types';

interface Props {
  onApply: (plan: SetPlan) => void;
  venue: VenueType;
  phase: SetPhase;
  onVenueChange: (v: VenueType) => void;
  onPhaseChange: (p: SetPhase) => void;
}

export default function VenuePlannerPanel({ onApply, venue, phase, onVenueChange, onPhaseChange }: Props) {
  const [applied, setApplied] = useState(false);

  const plan = getSetPlan(venue, phase);

  function handleApply() {
    onApply(plan);
    setApplied(true);
    setTimeout(() => setApplied(false), 1800);
  }

  const selectClass =
    'bg-[#1c1c2e] border border-[#363650] text-[#e2e8f0] text-xs rounded px-2 py-1.5 focus:outline-none focus:border-[#7c3aed] cursor-pointer';

  return (
    <div className="bg-[#20202e] border border-[#2c2c42] rounded-xl p-4 flex flex-col gap-3">

      {/* Selectors */}
      <div className="flex gap-2">
        <div className="flex-1 flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-widest text-[#8394a8]">Venue</span>
          <select
            value={venue}
            onChange={e => { onVenueChange(e.target.value as VenueType); setApplied(false); }}
            className={selectClass}
          >
            {VENUE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="flex-1 flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-widest text-[#8394a8]">Phase</span>
          <select
            value={phase}
            onChange={e => { onPhaseChange(e.target.value as SetPhase); setApplied(false); }}
            className={selectClass}
          >
            {SET_PHASES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {/* Plan preview */}
      <div className="bg-[#1c1c2e] rounded-lg p-3 flex flex-col gap-2 border border-[#2c2c42]">

        {/* Mini curve preview */}
        <MiniCurve points={plan.curve} />

        {/* BPM row */}
        <div className="flex items-center gap-2 text-[10px] text-[#8394a8]">
          <span className="text-[#64748b]">BPM</span>
          <span className="font-semibold text-[#a6b5c8]">{plan.bpmMin}–{plan.bpmMax}</span>
          <span className="text-[#6b7a94]">·</span>
          <span className="text-[#64748b]">target</span>
          <span className="font-semibold text-[#a6b5c8]">{plan.bpmTarget}</span>
        </div>

        {/* Weights row */}
        <div className="flex items-center gap-2 text-[10px] text-[#64748b] flex-wrap">
          <WeightChip label="Harmonic" value={plan.scoringWeights.harmonicWeight} />
          <WeightChip label="Energy"   value={plan.scoringWeights.energyWeight} />
          <WeightChip label="BPM"      value={plan.scoringWeights.bpmWeight} />
          <WeightChip label="Trans."   value={plan.scoringWeights.transitionWeight} />
        </div>

        {/* Reasoning */}
        <p className="text-[10px] text-[#8394a8] italic leading-snug">{plan.reasoning}</p>
      </div>

      {/* Apply button */}
      <button
        type="button"
        onClick={handleApply}
        className="w-full rounded-lg py-2 text-xs font-semibold transition-all"
        style={{
          background: applied ? '#16a34a' : '#7c3aed',
          color: '#fff',
        }}
      >
        {applied ? '✓ Applied' : 'Apply to generator'}
      </button>
    </div>
  );
}

function WeightChip({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <span className="flex items-center gap-1">
      <span>{label}</span>
      <span
        className="font-semibold"
        style={{ color: pct >= 40 ? '#a78bfa' : pct >= 25 ? '#7c3aed' : '#8394a8' }}
      >
        {pct}%
      </span>
    </span>
  );
}

function MiniCurve({ points }: { points: { x: number; y: number }[] }) {
  const W = 200, H = 40;
  const pad = 4;
  const xs = points.map(p => pad + p.x * (W - pad * 2));
  const ys = points.map(p => H - pad - p.y * (H - pad * 2));
  const d = points
    .map((_, i) => `${i === 0 ? 'M' : 'L'} ${xs[i].toFixed(1)} ${ys[i].toFixed(1)}`)
    .join(' ');
  const area = `${d} L ${xs[xs.length - 1].toFixed(1)} ${H} L ${xs[0].toFixed(1)} ${H} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 36 }}>
      <defs>
        <linearGradient id="vp-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#vp-grad)" />
      <path d={d} stroke="#7c3aed" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((_, i) => (
        <circle key={i} cx={xs[i]} cy={ys[i]} r="2.5" fill="#7c3aed" />
      ))}
    </svg>
  );
}
