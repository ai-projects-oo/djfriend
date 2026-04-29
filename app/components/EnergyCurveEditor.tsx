/* eslint-disable react-refresh/only-export-components */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { CurvePoint, ArcPreset, SetTrack } from '../types';
import { buildSvgPath, sampleCurve } from '../lib/curveInterpolation';

const SVG_HEIGHT = 180;
const HANDLE_RADIUS = 8;
const PADDING = { top: 16, bottom: 24, left: 8, right: 8 };

export const ARC_PRESETS: Record<ArcPreset, number[]> = {
  'Build-up': [0.1, 0.25, 0.45, 0.7, 0.95],
  Peak: [0.4, 0.7, 0.95, 0.7, 0.4],
  Valley: [0.8, 0.5, 0.2, 0.5, 0.8],
  Steady: [0.65, 0.65, 0.65, 0.65, 0.65],
  'W-shape': [0.8, 0.3, 0.8, 0.3, 0.8],
};

export const DEFAULT_CURVE: CurvePoint[] = [
  { x: 0.0, y: 0.3 },
  { x: 0.25, y: 0.65 },
  { x: 0.5, y: 0.9 },
  { x: 0.75, y: 0.75 },
  { x: 1.0, y: 0.5 },
];

interface Props {
  points: CurvePoint[];
  onChange: (points: CurvePoint[]) => void;
  setTracks?: SetTrack[]; // overlay actual track energies as dots
  setLength?: number;     // number of tracks — used to cap max control points
  libraryEnergyRange?: { min: number; max: number } | null; // real energy range of filtered library
  tipConfig?: import('../types').TipConfig;
}

/** Max control points recommended for a given set length */
function maxPointsForSetLength(n: number): number {
  if (n <= 6)  return 3;
  if (n <= 12) return 5;
  if (n <= 20) return 7;
  return 9;
}

/** Resample current curve to a new number of evenly-spaced control points */
function resampleCurve(points: CurvePoint[], newCount: number): CurvePoint[] {
  if (newCount < 2) newCount = 2;
  return Array.from({ length: newCount }, (_, i) => {
    const x = i / (newCount - 1);
    return { x, y: sampleCurve(points, x) };
  });
}

export default function EnergyCurveEditor({ points, onChange, setTracks, setLength = 0, libraryEnergyRange, tipConfig }: Props) {
  const showInfoTips = tipConfig?.info !== false;
  const svgRef = useRef<SVGSVGElement>(null);
  const [svgWidth, setSvgWidth] = useState(600);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [activePreset, setActivePreset] = useState<ArcPreset | null>(null);

  // Measure SVG width via ResizeObserver
  const measuredRef = useCallback((el: SVGSVGElement | null) => {
    if (!el) return;
    (svgRef as React.MutableRefObject<SVGSVGElement | null>).current = el;
    setSvgWidth(el.clientWidth || 600);
    const ro = new ResizeObserver(() => setSvgWidth(el.clientWidth));
    ro.observe(el);
  }, []);

  const innerWidth = svgWidth - PADDING.left - PADDING.right;
  const innerHeight = SVG_HEIGHT - PADDING.top - PADDING.bottom;

  const toSvgX = useCallback(
    (x: number) => PADDING.left + x * innerWidth,
    [innerWidth],
  );
  const toSvgY = useCallback(
    (y: number) => PADDING.top + (1 - y) * innerHeight,
    [innerHeight],
  );
  const fromSvgY = useCallback(
    (svgY: number) => {
      const y = 1 - (svgY - PADDING.top) / innerHeight;
      return Math.max(0, Math.min(1, y));
    },
    [innerHeight],
  );

  const pathD = useMemo(
    () => buildSvgPath(points, svgWidth, SVG_HEIGHT, 200),
    [points, svgWidth],
  );

  // Energy gradient stops sampled from the curve
  const gradientStops = useMemo(() => {
    const stops = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const e = sampleCurve(points, t);
      const color = energyToColor(e);
      stops.push({ offset: `${t * 100}%`, color });
    }
    return stops;
  }, [points]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGCircleElement>, idx: number) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDraggingIdx(idx);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (draggingIdx === null || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const svgY = e.clientY - rect.top;
      const newY = fromSvgY(svgY);
      const updated = points.map((p, i) => (i === draggingIdx ? { ...p, y: newY } : p));
      setActivePreset(null);
      onChange(updated);
    },
    [draggingIdx, points, onChange, fromSvgY],
  );

  const handlePointerUp = useCallback(() => {
    setDraggingIdx(null);
  }, []);

  const applyPreset = useCallback(
    (preset: ArcPreset) => {
      const yValues = ARC_PRESETS[preset];
      const updated = points.map((p, i) => ({
        ...p,
        y: yValues[i] ?? p.y,
      }));
      setActivePreset(preset);
      onChange(updated);
    },
    [points, onChange],
  );

  // Rebuild path for fill under curve
  const fillPath = useMemo(() => {
    if (!pathD) return '';
    return `${pathD} L ${(svgWidth - PADDING.right).toFixed(2)} ${SVG_HEIGHT} L ${PADDING.left} ${SVG_HEIGHT} Z`;
  }, [pathD, svgWidth]);

  const maxPoints = setLength > 0 ? maxPointsForSetLength(setLength) : 9;
  const currentCount = points.length;

  return (
    <div className="flex flex-col gap-3">
      {/* Preset buttons + point count control */}
      <div className="flex gap-1.5 items-center overflow-x-auto scrollbar-none">
        {(Object.keys(ARC_PRESETS) as ArcPreset[]).map((preset) => (
          <button
            key={preset}
            onClick={() => applyPreset(preset)}
            className={`px-2.5 py-1 text-xs rounded border transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 ${
              activePreset === preset
                ? 'border-[#7c3aed] bg-[#7c3aed]/10 text-[#e2e8f0]'
                : 'border-[#2a2a3a] bg-[#12121a] text-[#94a3b8] hover:border-[#7c3aed] hover:text-[#e2e8f0]'
            }`}
          >
            {preset}
          </button>
        ))}
        <button
          onClick={() => { setActivePreset(null); onChange(DEFAULT_CURVE); }}
          title="Reset curve to default"
          className="px-2 py-1 text-xs rounded border border-[#2a2a3a] bg-[#12121a] text-[#475569] hover:border-[#7c3aed] hover:text-[#e2e8f0] transition-colors cursor-pointer flex-shrink-0"
        >
          ↺
        </button>

      </div>

      {/* SVG canvas */}
      <div className="relative rounded-lg overflow-hidden border border-[#2a2a3a] bg-[#0d0d14]">
        {/* Y-axis labels */}
        <div
          className="absolute left-0 top-0 flex flex-col justify-between text-[10px] pointer-events-none"
          style={{ height: SVG_HEIGHT, paddingTop: PADDING.top, paddingBottom: PADDING.bottom }}
        >
          <span className={`pl-1 ${libraryEnergyRange ? 'text-[#7c3aed]' : 'text-[#475569]'}`}>
            {libraryEnergyRange ? Math.round(libraryEnergyRange.max * 100) : '100'}
          </span>
          <span className="pl-1 text-[#475569]">
            {libraryEnergyRange ? Math.round(((libraryEnergyRange.min + libraryEnergyRange.max) / 2) * 100) : '50'}
          </span>
          <span className={`pl-1 ${libraryEnergyRange ? 'text-[#7c3aed]' : 'text-[#475569]'}`}>
            {libraryEnergyRange ? Math.round(libraryEnergyRange.min * 100) : '0'}
          </span>
        </div>

        <svg
          ref={measuredRef}
          width="100%"
          height={SVG_HEIGHT}
          style={{ display: 'block', cursor: draggingIdx !== null ? 'grabbing' : 'default' }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <defs>
            <linearGradient id="energyGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              {gradientStops.map((s, i) => (
                <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity="0.3" />
              ))}
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map((t) => (
            <line
              key={t}
              x1={toSvgX(t)}
              y1={PADDING.top}
              x2={toSvgX(t)}
              y2={SVG_HEIGHT - PADDING.bottom}
              stroke="#1e1e2e"
              strokeWidth={1}
            />
          ))}
          {[0.25, 0.5, 0.75].map((e) => (
            <line
              key={e}
              x1={PADDING.left}
              y1={toSvgY(e)}
              x2={svgWidth - PADDING.right}
              y2={toSvgY(e)}
              stroke="#1e1e2e"
              strokeWidth={1}
            />
          ))}

          {/* Library energy range guide lines */}
          {libraryEnergyRange && (
            <>
              <line
                x1={PADDING.left} y1={toSvgY(libraryEnergyRange.max)}
                x2={svgWidth - PADDING.right} y2={toSvgY(libraryEnergyRange.max)}
                stroke="#7c3aed" strokeWidth={1} strokeOpacity={0.4} strokeDasharray="4 3"
              />
              <line
                x1={PADDING.left} y1={toSvgY(libraryEnergyRange.min)}
                x2={svgWidth - PADDING.right} y2={toSvgY(libraryEnergyRange.min)}
                stroke="#7c3aed" strokeWidth={1} strokeOpacity={0.4} strokeDasharray="4 3"
              />
            </>
          )}

          {/* Filled area under curve */}
          {fillPath && (
            <path d={fillPath} fill="url(#energyGradient)" />
          )}

          {/* Curve line */}
          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke="#7c3aed"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Control point handles */}
          {points.map((pt, idx) => (
            <g key={idx}>
              {/* Outer ring */}
              <circle
                cx={toSvgX(pt.x)}
                cy={toSvgY(pt.y)}
                r={HANDLE_RADIUS + 4}
                fill="transparent"
                stroke="#7c3aed"
                strokeWidth={1}
                strokeOpacity={0.3}
              />
              {/* Handle circle */}
              <circle
                cx={toSvgX(pt.x)}
                cy={toSvgY(pt.y)}
                r={HANDLE_RADIUS}
                fill={draggingIdx === idx ? '#7c3aed' : '#1a1a26'}
                stroke="#7c3aed"
                strokeWidth={2}
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => handlePointerDown(e, idx)}
                onMouseEnter={() => setHoverIdx(idx)}
                onMouseLeave={() => setHoverIdx(null)}
              />
              {/* Energy value tooltip on hover/drag */}
              {showInfoTips && (draggingIdx === idx || (hoverIdx === idx && draggingIdx === null)) && (
                <text
                  x={toSvgX(pt.x)}
                  y={toSvgY(pt.y) - HANDLE_RADIUS - 6}
                  textAnchor="middle"
                  fill="#e2e8f0"
                  fontSize={11}
                  pointerEvents="none"
                >
                  {Math.round(pt.y * 100)}
                </text>
              )}
            </g>
          ))}

          {/* Actual track energy overlay dots */}
          {setTracks && setTracks.length > 1 && setTracks.map((t, i) => {
            const xPos = i / (setTracks.length - 1);
            const cx = toSvgX(xPos);
            const cy = toSvgY(t.energy);
            const targetCy = toSvgY(t.targetEnergy);
            return (
              <g key={t.file}>
                {/* Vertical line from target to actual */}
                <line x1={cx} y1={targetCy} x2={cx} y2={cy} stroke={energyToColor(t.energy)} strokeWidth={1} strokeOpacity={0.3} />
                {/* Actual energy dot */}
                <circle
                  cx={cx} cy={cy} r={t.locked ? 4 : 3}
                  fill={energyToColor(t.energy)}
                  fillOpacity={0.85}
                  stroke={t.locked ? '#fff' : energyToColor(t.energy)}
                  strokeWidth={t.locked ? 1.5 : 0}
                >
                  <title>{t.title} — Energy: {Math.round(t.energy * 100)}% Target: {Math.round(t.targetEnergy * 100)}%{t.locked ? ' 🔒' : ''}</title>
                </circle>
              </g>
            );
          })}

          {/* X-axis labels */}
          <text x={toSvgX(0)} y={SVG_HEIGHT - 4} textAnchor="start" fill="#475569" fontSize={10}>0%</text>
          <text x={toSvgX(0.5)} y={SVG_HEIGHT - 4} textAnchor="middle" fill="#475569" fontSize={10}>50%</text>
          <text x={toSvgX(1)} y={SVG_HEIGHT - 4} textAnchor="end" fill="#475569" fontSize={10}>100%</text>
        </svg>
      </div>

      {/* Control point count pills */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-[#334155] uppercase tracking-wider flex-shrink-0">Points</span>
        {[2, 3, 4, 5, 6, 7, 8, 9].map(n => {
          const isActive = currentCount === n;
          const isDisabled = n > maxPoints;
          return (
            <button
              key={n}
              onClick={() => { if (!isDisabled && !isActive) { setActivePreset(null); onChange(resampleCurve(points, n)); } }}
              disabled={isDisabled}
              title={isDisabled ? `Max ${maxPoints} for ${setLength} tracks` : `${n} control points`}
              className={`w-7 h-6 text-xs rounded border transition-colors flex-shrink-0 ${
                isActive
                  ? 'border-[#7c3aed] bg-[#7c3aed]/20 text-[#e2e8f0] cursor-default'
                  : isDisabled
                  ? 'border-[#1e1e2e] bg-transparent text-[#2a2a3a] cursor-not-allowed'
                  : 'border-[#2a2a3a] bg-[#12121a] text-[#64748b] hover:border-[#7c3aed] hover:text-[#e2e8f0] cursor-pointer'
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { energyColor } from '../lib/theme';

function energyToColor(energy: number): string {
  return energyColor(energy);
}
