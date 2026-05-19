import { useEffect, useRef, useCallback } from 'react';
import type { FrequencyWaveform } from '../types';

interface CueMark { name: string; time: number; num: number; }

interface Props {
  waveform: number[];
  frequencyWaveform?: FrequencyWaveform;
  vocalTimeline?: number[];
  progress: number;      // 0–1
  duration?: number;     // seconds — required for cue point rendering
  cuePoints?: CueMark[];
  height?: number;
  onSeek?: (progress: number) => void;
  className?: string;
}

// Cue slot colours A–H (green → yellow → orange → red gradient like Rekordbox)
const CUE_COLOR = '#39ff14'; // neon green — same for all cue points, matching Rekordbox
const CUE_LETTERS = ['A','B','C','D','E','F','G','H'];

function interp(arr: number[], n: number): number[] {
  if (!arr.length) return new Array(n).fill(0);
  return Array.from({ length: n }, (_, i) => {
    const pos = (i / (n - 1)) * (arr.length - 1);
    const lo = Math.floor(pos), hi = Math.min(arr.length - 1, lo + 1);
    return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
  });
}

// Downsample to at most one bar per `targetBarPx` pixels — max-pool for peaks
function adaptWaveform(arr: number[], canvasW: number, targetBarPx = 1): number[] {
  const maxBars = Math.max(1, Math.floor(canvasW / targetBarPx));
  if (arr.length <= maxBars) return arr;
  const ratio = arr.length / maxBars;
  return Array.from({ length: maxBars }, (_, i) => {
    const lo = Math.floor(i * ratio);
    const hi = Math.min(arr.length - 1, Math.floor((i + 1) * ratio) - 1);
    let mx = 0;
    for (let j = lo; j <= hi; j++) if (arr[j] > mx) mx = arr[j];
    return mx;
  });
}

function adaptFreq(fw: { bass: number[]; mid: number[]; high: number[] }, canvasW: number, targetBarPx = 1) {
  const maxBars = Math.max(1, Math.floor(canvasW / targetBarPx));
  if (fw.bass.length <= maxBars) return fw;
  const ratio = fw.bass.length / maxBars;
  const bass = new Array(maxBars), mid = new Array(maxBars), high = new Array(maxBars);
  for (let i = 0; i < maxBars; i++) {
    const lo = Math.floor(i * ratio);
    const hi = Math.min(fw.bass.length - 1, Math.floor((i + 1) * ratio) - 1);
    let mb = 0, mm = 0, mh = 0;
    for (let j = lo; j <= hi; j++) {
      if (fw.bass[j] > mb) mb = fw.bass[j];
      if (fw.mid[j]  > mm) mm = fw.mid[j];
      if (fw.high[j] > mh) mh = fw.high[j];
    }
    bass[i] = mb; mid[i] = mm; high[i] = mh;
  }
  return { bass, mid, high };
}


export default function WaveformSeeker({ waveform, frequencyWaveform, vocalTimeline, progress, duration, cuePoints, height = 56, onSeek, className = '' }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const frameRef    = useRef<number>(0);
  const progressRef = useRef(progress);

  progressRef.current = progress;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveform.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w   = canvas.offsetWidth;
    const h   = height;

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#090910';
    ctx.fillRect(0, 0, w, h);
    // Red baseline floor
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, h - 1, w, 1);
    ctx.globalAlpha = 1;

    const wf   = adaptWaveform(waveform, w);
    const fw   = frequencyWaveform ? adaptFreq(frequencyWaveform, w) : null;
    const n    = wf.length;
    const barW = w / n;
    const bw   = Math.min(2, Math.max(1, barW - 1));
    const px   = progressRef.current * w;
    const vocalInterp = vocalTimeline && vocalTimeline.length > 0 ? interp(vocalTimeline, n) : null;

    for (let i = 0; i < n; i++) {
      const v      = wf[i];
      const x      = i * barW;
      const played = x < px;
      const alpha  = played ? 0.25 : 0.88 + v * 0.12;

      ctx.globalAlpha = alpha;

      if (fw) {
        // All bands start from bottom, overlapping — same as Rekordbox
        const bassH = Math.max(1, (fw.bass[i] ?? 0) * h * 0.95);
        const midH  = Math.max(1, (fw.mid[i]  ?? 0) * h * 0.95);
        const highH = Math.max(1, (fw.high[i] ?? 0) * h * 0.95);
        ctx.globalAlpha = alpha;          ctx.fillStyle = '#ff0000'; ctx.fillRect(x, h - bassH, bw, bassH);
        ctx.globalAlpha = alpha * 0.72;   ctx.fillStyle = '#00e040'; ctx.fillRect(x, h - midH,  bw, midH);
        ctx.globalAlpha = alpha * 0.58;   ctx.fillStyle = '#0088ff'; ctx.fillRect(x, h - highH, bw, highH);
      } else {
        const barH = Math.max(2, v * h * 0.95);
        ctx.fillStyle = v < 0.25 ? '#0088ff' : v < 0.45 ? '#00e040' : '#ff0000';
        ctx.fillRect(x, h - barH, bw, barH);
      }

      // Vocal overlay — on top of frequency layers
      if (vocalInterp) {
        const vp = vocalInterp[i];
        if (vp > 0.2) {
          const barH = fw
            ? Math.max(fw.bass[i] ?? 0, fw.mid[i] ?? 0, fw.high[i] ?? 0) * h * 0.95
            : v * h * 0.95;
          ctx.globalAlpha = played ? (vp - 0.2) * 0.25 : (vp - 0.2) * 0.7;
          ctx.fillStyle = '#dd66ff';
          ctx.fillRect(x, h - Math.max(2, barH), bw, Math.max(2, barH));
        }
      }
    }

    ctx.globalAlpha = 1;

    // Cue point markers
    if (cuePoints && cuePoints.length > 0 && duration && duration > 0) {
      ctx.font = `bold ${Math.max(8, Math.round(height * 0.22))}px monospace`;
      ctx.textBaseline = 'top';
      for (const cue of cuePoints) {
        const cx = (cue.time / duration) * w;
        if (cx < 0 || cx > w) continue;
        const color = CUE_COLOR;
        const letter = CUE_LETTERS[cue.num % CUE_LETTERS.length];

        // Vertical tick line
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, h);
        ctx.stroke();

        // Label box
        const fontSize = Math.max(8, Math.round(height * 0.22));
        const pad = 2;
        const lw = fontSize * 0.72 + pad * 2;
        const lh = fontSize + pad * 2;
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = color;
        ctx.fillRect(cx, 0, lw, lh);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#000';
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.fillText(letter, cx + pad, pad);
      }
    }

    ctx.globalAlpha = 1;

    // Playhead
    if (px > 0 && px < w) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
  }, [waveform, frequencyWaveform, vocalTimeline, cuePoints, duration, height]);

  useEffect(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(draw);
  }, [progress, draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    draw();
    return () => { ro.disconnect(); cancelAnimationFrame(frameRef.current); };
  }, [draw]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  }, [onSeek]);

  return (
    <canvas
      ref={canvasRef}
      height={height}
      onClick={handleClick}
      className={`w-full block rounded-sm ${onSeek ? 'cursor-pointer' : ''} ${className}`}
      style={{ height }}
    />
  );
}
