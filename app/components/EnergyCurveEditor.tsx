/* eslint-disable react-refresh/only-export-components */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { CurvePoint, ArcPreset, SetTrack } from '../types';
import { sampleCurve } from '../lib/curveInterpolation';

const SVG_HEIGHT = 180;
const HANDLE_RADIUS = 5;
const PADDING = { top: 16, bottom: 24, left: 8, right: 8 };
const EPS = 0.001;
const MIN_SECTION = 0.10; // minimum section width as fraction

export const ARC_PRESETS: Record<ArcPreset, number[]> = {
  'Build-up': [0.1, 0.25, 0.45, 0.7, 0.95],
  Peak: [0.4, 0.7, 0.95, 0.7, 0.4],
  Valley: [0.8, 0.5, 0.2, 0.5, 0.8],
  Steady: [0.65, 0.65, 0.65, 0.65, 0.65],
  'W-shape': [0.8, 0.3, 0.8, 0.3, 0.8],
  'Rising-W': [0.2, 0.45, 0.1, 0.65, 0.3, 0.85, 0.95],
};

export const DEFAULT_CURVE: CurvePoint[] = [
  { x: 0,     y: 0.15 },
  { x: 0.167, y: 0.30 },
  { x: 0.333, y: 0.55 },
  { x: 0.5,   y: 0.85 },
  { x: 0.667, y: 0.80 },
  { x: 0.833, y: 0.55 },
  { x: 1,     y: 0.25 },
];

type SectionLabel = 'Start' | 'Middle' | 'End';

const SECTION_PRESETS: Record<SectionLabel, Record<string, number[]>> = {
  Start: {
    'Opening':  [0.10, 0.20, 0.38],
    'Warm-up':  [0.25, 0.45, 0.65],
    'Punch':    [0.65, 0.70, 0.72],
    'Steady':   [0.50, 0.50, 0.50],
    'Rising-W': [0.15, 0.40, 0.20, 0.55, 0.35],
  },
  Middle: {
    'Peak':     [0.85, 0.92, 0.85],
    'Valley':   [0.65, 0.28, 0.65],
    'Build':    [0.50, 0.70, 0.88],
    'Steady':   [0.75, 0.75, 0.75],
    'Rising-W': [0.50, 0.70, 0.45, 0.82, 0.65],
  },
  End: {
    'Closing':  [0.60, 0.35, 0.12],
    'Climax':   [0.70, 0.92, 0.55],
    'Fade':     [0.72, 0.48, 0.18],
    'Steady':   [0.60, 0.60, 0.60],
    'Rising-W': [0.55, 0.76, 0.50, 0.90, 0.70],
  },
};

function getSectionPointCount(points: CurvePoint[], xStart: number, xEnd: number): number {
  return points.filter(p => p.x >= xStart - EPS && p.x <= xEnd + EPS).length;
}

function resampleSection(allPoints: CurvePoint[], xStart: number, xEnd: number, count: number): CurvePoint[] {
  const outside = allPoints.filter(p => p.x < xStart - EPS || p.x > xEnd + EPS);
  const inside: CurvePoint[] = Array.from({ length: count }, (_, i) => {
    const x = count === 1 ? (xStart + xEnd) / 2 : xStart + (i / (count - 1)) * (xEnd - xStart);
    return { x, y: sampleCurve(allPoints, x) };
  });
  return [...outside, ...inside].sort((a, b) => a.x - b.x);
}

function applySectionPreset(allPoints: CurvePoint[], xStart: number, xEnd: number, yValues: number[]): CurvePoint[] {
  const count = yValues.length;
  const outside = allPoints.filter(p => p.x < xStart - EPS || p.x > xEnd + EPS);
  const inside: CurvePoint[] = yValues.map((y, i) => ({
    x: count === 1 ? (xStart + xEnd) / 2 : xStart + (i / (count - 1)) * (xEnd - xStart),
    y,
  }));
  return [...outside, ...inside].sort((a, b) => a.x - b.x);
}

interface Props {
  points: CurvePoint[];
  onChange: (points: CurvePoint[]) => void;
  setTracks?: SetTrack[];
  libraryEnergyRange?: { min: number; max: number } | null;
  tipConfig?: import('../types').TipConfig;
}

export default function EnergyCurveEditor({ points, onChange, setTracks, libraryEnergyRange, tipConfig }: Props) {
  const showInfoTips = tipConfig?.info !== false;
  const svgRef = useRef<SVGSVGElement>(null);
  const [svgWidth, setSvgWidth] = useState(600);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [activeSectionPresets, setActiveSectionPresets] = useState<Record<SectionLabel, string | null>>({
    Start: null, Middle: null, End: null,
  });

  // Draggable section boundaries (x fractions)
  const [boundaries, setBoundaries] = useState<[number, number]>([1 / 3, 2 / 3]);
  const draggingBoundary = useRef<0 | 1 | null>(null);
  const [hoverBoundary, setHoverBoundary] = useState<0 | 1 | null>(null);

  // Derived section ranges from boundaries
  const sections = useMemo(() => [
    { label: 'Start'  as SectionLabel, xStart: 0,             xEnd: boundaries[0] },
    { label: 'Middle' as SectionLabel, xStart: boundaries[0], xEnd: boundaries[1] },
    { label: 'End'    as SectionLabel, xStart: boundaries[1], xEnd: 1             },
  ], [boundaries]);

  const measuredRef = useCallback((el: SVGSVGElement | null) => {
    if (!el) return;
    (svgRef as React.MutableRefObject<SVGSVGElement | null>).current = el;
    setSvgWidth(el.clientWidth || 600);
    const ro = new ResizeObserver(() => setSvgWidth(el.clientWidth));
    ro.observe(el);
  }, []);

  const innerWidth = svgWidth - PADDING.left - PADDING.right;
  const innerHeight = SVG_HEIGHT - PADDING.top - PADDING.bottom;

  const toSvgX = useCallback((x: number) => PADDING.left + x * innerWidth, [innerWidth]);
  const fromSvgX = useCallback((svgX: number) => Math.max(0, Math.min(1, (svgX - PADDING.left) / innerWidth)), [innerWidth]);

  const yMin = libraryEnergyRange ? libraryEnergyRange.min : 0;
  const yMax = libraryEnergyRange ? libraryEnergyRange.max : 1;
  const ySpan = yMax - yMin;

  const toSvgY = useCallback(
    (y: number) => PADDING.top + (1 - (y - yMin) / ySpan) * innerHeight,
    [innerHeight, yMin, ySpan],
  );
  const fromSvgY = useCallback(
    (svgY: number) => {
      const normalized = 1 - (svgY - PADDING.top) / innerHeight;
      return Math.max(yMin, Math.min(yMax, yMin + normalized * ySpan));
    },
    [innerHeight, yMin, yMax, ySpan],
  );

  const pathD = useMemo(() => {
    if (points.length < 2) return '';
    const SAMPLES = 200;
    let d = '';
    for (let i = 0; i <= SAMPLES; i++) {
      const x = i / SAMPLES;
      const y = sampleCurve(points, x);
      const sx = (PADDING.left + x * (svgWidth - PADDING.left - PADDING.right)).toFixed(2);
      const sy = (PADDING.top + (1 - y) * (SVG_HEIGHT - PADDING.top - PADDING.bottom)).toFixed(2);
      d += i === 0 ? `M ${sx} ${sy}` : ` L ${sx} ${sy}`;
    }
    return d;
  }, [points, svgWidth]);

  const gradientStops = useMemo(() => {
    const stops = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const e = sampleCurve(points, t);
      stops.push({ offset: `${t * 100}%`, color: energyToColor(e) });
    }
    return stops;
  }, [points]);

  const fillPath = useMemo(() => {
    if (!pathD) return '';
    const bottom = SVG_HEIGHT - PADDING.bottom;
    return `${pathD} L ${(svgWidth - PADDING.right).toFixed(2)} ${bottom} L ${PADDING.left} ${bottom} Z`;
  }, [pathD, svgWidth]);

  // ── Pointer handlers ────────────────────────────────────────────────────────

  const handlePointPointerDown = useCallback(
    (e: React.PointerEvent<SVGCircleElement>, idx: number) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDraggingIdx(idx);
    },
    [],
  );

  const handleBoundaryPointerDown = useCallback(
    (e: React.PointerEvent<SVGRectElement>, which: 0 | 1) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      draggingBoundary.current = which;
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();

      // Dragging a boundary
      if (draggingBoundary.current !== null) {
        const rawX = fromSvgX(e.clientX - rect.left);
        setBoundaries(prev => {
          const next: [number, number] = [...prev] as [number, number];
          if (draggingBoundary.current === 0) {
            next[0] = Math.max(MIN_SECTION, Math.min(prev[1] - MIN_SECTION, rawX));
          } else {
            next[1] = Math.max(prev[0] + MIN_SECTION, Math.min(1 - MIN_SECTION, rawX));
          }
          return next;
        });
        return;
      }

      // Dragging a control point
      if (draggingIdx !== null) {
        const svgY = e.clientY - rect.top;
        const newY = fromSvgY(svgY);
        const updated = points.map((p, i) => (i === draggingIdx ? { ...p, y: newY } : p));
        // Clear active section preset for the point's section
        const pt = points[draggingIdx];
        const sec = sections.find(s => pt.x >= s.xStart - EPS && pt.x <= s.xEnd + EPS);
        if (sec) setActiveSectionPresets(prev => ({ ...prev, [sec.label]: null }));
        onChange(updated);
      }
    },
    [draggingIdx, points, onChange, fromSvgY, fromSvgX, sections],
  );

  const handlePointerUp = useCallback(() => {
    draggingBoundary.current = null;
    setDraggingIdx(null);
  }, []);

  // ── Section actions ─────────────────────────────────────────────────────────

  const handleSectionPreset = useCallback(
    (section: typeof sections[number], presetName: string, yValues: number[]) => {
      const next = applySectionPreset(points, section.xStart, section.xEnd, yValues);
      setActiveSectionPresets(prev => ({ ...prev, [section.label]: presetName }));
      onChange(next);
    },
    [points, onChange, sections],
  );

  const handleSectionCount = useCallback(
    (section: typeof sections[number], count: number) => {
      const next = resampleSection(points, section.xStart, section.xEnd, count);
      setActiveSectionPresets(prev => ({ ...prev, [section.label]: null }));
      onChange(next);
    },
    [points, onChange, sections],
  );

  const handleReset = useCallback(() => {
    setActiveSectionPresets({ Start: null, Middle: null, End: null });
    setBoundaries([1 / 3, 2 / 3]);
    onChange(DEFAULT_CURVE);
  }, [onChange]);

  const isDraggingBoundary = draggingBoundary.current !== null;

  return (
    <div className="flex flex-col gap-3">
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
          style={{ display: 'block', cursor: isDraggingBoundary ? 'col-resize' : draggingIdx !== null ? 'grabbing' : 'default' }}
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
          {[0.25, 0.75].map(t => (
            <line key={t} x1={toSvgX(t)} y1={PADDING.top} x2={toSvgX(t)} y2={SVG_HEIGHT - PADDING.bottom}
              stroke="#1e1e2e" strokeWidth={1} />
          ))}
          {[0.25, 0.5, 0.75].map(e => (
            <line key={e} x1={PADDING.left} y1={toSvgY(e)} x2={svgWidth - PADDING.right} y2={toSvgY(e)}
              stroke="#1e1e2e" strokeWidth={1} />
          ))}

          {/* Library range guides */}
          {libraryEnergyRange && (
            <>
              <line x1={PADDING.left} y1={toSvgY(libraryEnergyRange.max)} x2={svgWidth - PADDING.right} y2={toSvgY(libraryEnergyRange.max)}
                stroke="#7c3aed" strokeWidth={1} strokeOpacity={0.4} strokeDasharray="4 3" />
              <line x1={PADDING.left} y1={toSvgY(libraryEnergyRange.min)} x2={svgWidth - PADDING.right} y2={toSvgY(libraryEnergyRange.min)}
                stroke="#7c3aed" strokeWidth={1} strokeOpacity={0.4} strokeDasharray="4 3" />
            </>
          )}

          {/* Filled area */}
          {fillPath && <path d={fillPath} fill="url(#energyGradient)" />}

          {/* Curve */}
          {pathD && (
            <path d={pathD} fill="none" stroke="#7c3aed" strokeWidth={2.5}
              strokeLinecap="round" strokeLinejoin="round" />
          )}

          {/* Control handles */}
          {points.map((pt, idx) => (
            <g key={idx}>
              <circle
                cx={toSvgX(pt.x)} cy={toSvgY(pt.y)} r={HANDLE_RADIUS}
                fill={draggingIdx === idx ? '#7c3aed' : '#1a1a26'}
                stroke="#7c3aed" strokeWidth={2}
                style={{ cursor: 'grab' }}
                onPointerDown={e => handlePointPointerDown(e, idx)}
                onMouseEnter={() => setHoverIdx(idx)}
                onMouseLeave={() => setHoverIdx(null)}
              />
              {showInfoTips && (draggingIdx === idx || (hoverIdx === idx && draggingIdx === null)) && (
                <text x={toSvgX(pt.x)} y={toSvgY(pt.y) - HANDLE_RADIUS - 6}
                  textAnchor="middle" fill="#e2e8f0" fontSize={11} pointerEvents="none">
                  {Math.round(pt.y * 100)}
                </text>
              )}
            </g>
          ))}

          {/* Track energy dots */}
          {setTracks && setTracks.length > 1 && setTracks.map((t, i) => {
            const xPos = i / (setTracks.length - 1);
            return (
              <circle key={t.file} cx={toSvgX(xPos)} cy={toSvgY(t.energy)} r={2.5}
                fill={energyToColor(t.energy)} fillOpacity={0.7}
                stroke={t.locked ? '#fff' : 'none'} strokeWidth={t.locked ? 1 : 0}>
                <title>{t.title} — Energy: {Math.round(t.energy * 100)}% Target: {Math.round(t.targetEnergy * 100)}%{t.locked ? ' 🔒' : ''}</title>
              </circle>
            );
          })}

          {/* Draggable section boundaries */}
          {boundaries.map((bx, bi) => {
            const sx = toSvgX(bx);
            const isHovered = hoverBoundary === bi;
            const isActive = draggingBoundary.current === bi;
            const pct = Math.round(bx * 100);
            return (
              <g key={bi}>
                {/* Visible line */}
                <line
                  x1={sx} y1={PADDING.top} x2={sx} y2={SVG_HEIGHT - PADDING.bottom}
                  stroke={isActive || isHovered ? '#7c3aed' : '#3b3b5e'}
                  strokeWidth={isActive || isHovered ? 2 : 1}
                  strokeDasharray="4 3"
                  pointerEvents="none"
                />
                {/* Percentage label */}
                <text
                  x={sx} y={PADDING.top - 4}
                  textAnchor="middle" fill={isActive || isHovered ? '#a78bfa' : '#3b3b5e'}
                  fontSize={9} pointerEvents="none"
                >
                  {pct}%
                </text>
                {/* Wide invisible hit target */}
                <rect
                  x={sx - 6} y={PADDING.top}
                  width={12} height={SVG_HEIGHT - PADDING.top - PADDING.bottom}
                  fill="transparent"
                  style={{ cursor: 'col-resize' }}
                  onPointerDown={e => handleBoundaryPointerDown(e, bi as 0 | 1)}
                  onMouseEnter={() => setHoverBoundary(bi as 0 | 1)}
                  onMouseLeave={() => setHoverBoundary(null)}
                />
              </g>
            );
          })}

          {/* X-axis section labels */}
          <text x={toSvgX(boundaries[0] / 2)} y={SVG_HEIGHT - 4}
            textAnchor="middle" fill="#334155" fontSize={9}>START</text>
          <text x={toSvgX((boundaries[0] + boundaries[1]) / 2)} y={SVG_HEIGHT - 4}
            textAnchor="middle" fill="#334155" fontSize={9}>MIDDLE</text>
          <text x={toSvgX((boundaries[1] + 1) / 2)} y={SVG_HEIGHT - 4}
            textAnchor="middle" fill="#334155" fontSize={9}>END</text>
        </svg>
      </div>

      {/* Per-section controls */}
      <div className="grid grid-cols-3 gap-2">
        {sections.map((section) => {
          const presets = SECTION_PRESETS[section.label];
          const activePreset = activeSectionPresets[section.label];
          const count = getSectionPointCount(points, section.xStart, section.xEnd);
          const pctStart = Math.round(section.xStart * 100);
          const pctEnd = Math.round(section.xEnd * 100);
          return (
            <div key={section.label} className="bg-[#0d0d14] border border-[#1e1e2e] rounded-lg p-2.5 flex flex-col gap-2">
              {/* Section header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-[#4b5568]">
                    {section.label}
                  </span>
                  <span className="text-[9px] text-[#2a2a3a] tabular-nums">
                    {pctStart}–{pctEnd}%
                  </span>
                </div>
                {section.label === 'Start' && (
                  <button onClick={handleReset} title="Reset all"
                    className="text-[#2a2a3a] hover:text-[#475569] transition-colors cursor-pointer text-xs leading-none">
                    ↺
                  </button>
                )}
              </div>

              {/* Preset pills */}
              <div className="flex flex-wrap gap-1">
                {Object.entries(presets).map(([name, yValues]) => (
                  <button
                    key={name}
                    onClick={() => handleSectionPreset(section, name, yValues)}
                    className={`px-2 py-0.5 text-[10px] rounded border transition-colors cursor-pointer whitespace-nowrap ${
                      activePreset === name
                        ? 'border-[#7c3aed] bg-[#7c3aed]/15 text-[#e2e8f0]'
                        : 'border-[#2a2a3a] text-[#64748b] hover:border-[#7c3aed] hover:text-[#e2e8f0]'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>

              {/* Point count */}
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-[#2a2a3a] uppercase tracking-wider flex-shrink-0">pts</span>
                {[2, 3, 4, 5, 6].map(n => (
                  <button
                    key={n}
                    onClick={() => { if (count !== n) handleSectionCount(section, n); }}
                    className={`w-6 h-5 text-[10px] rounded border transition-colors flex-shrink-0 ${
                      count === n
                        ? 'border-[#7c3aed] bg-[#7c3aed]/20 text-[#e2e8f0] cursor-default'
                        : 'border-[#1e1e2e] text-[#475569] hover:border-[#7c3aed] hover:text-[#e2e8f0] cursor-pointer'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
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
