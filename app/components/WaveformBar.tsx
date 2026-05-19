import { useEffect, useRef } from 'react';
import type { FrequencyWaveform } from '../types';

interface Props {
  waveform: number[];
  frequencyWaveform?: FrequencyWaveform;
  vocalTimeline?: number[];
  height?: number;
  className?: string;
}

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


export default function WaveformBar({ waveform, frequencyWaveform, vocalTimeline, height = 28, className = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveform.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth;
    const h = height;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#090910';
    ctx.fillRect(0, 0, w, h);
    // Green baseline floor
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#00e040';
    ctx.fillRect(0, h - 1, w, 1);
    ctx.globalAlpha = 1;

    const wf   = adaptWaveform(waveform, w);
    const fw   = frequencyWaveform ? adaptFreq(frequencyWaveform, w) : null;
    const n    = wf.length;
    const barW = w / n;
    const bw   = Math.min(2, Math.max(1, barW - 1));
    const vocalInterp = vocalTimeline && vocalTimeline.length > 0 ? interp(vocalTimeline, n) : null;

    for (let i = 0; i < n; i++) {
      const v    = wf[i];
      const barH = Math.max(1, v * h * 0.95);
      const x    = i * barW;

      if (fw) {
        const r = Math.min(255, Math.round((fw.bass[i] ?? 0) * 520));
        const g = Math.min(255, Math.round((fw.mid[i]  ?? 0) * 340));
        const b = Math.min(255, Math.round((fw.high[i] ?? 0) * 340));
        ctx.globalAlpha = 0.88 + v * 0.12;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, h - barH, bw, barH);
      } else {
        ctx.globalAlpha = 0.88 + v * 0.12;
        ctx.fillStyle = v < 0.25 ? '#0088ff' : v < 0.45 ? '#00e040' : '#ff0000';
        ctx.fillRect(x, h - barH, bw, barH);
      }

      if (vocalInterp) {
        const vp = vocalInterp[i];
        if (vp > 0.2) {
          ctx.globalAlpha = (vp - 0.2) * 0.55;
          ctx.fillStyle = '#cc44ff';
          ctx.fillRect(x, h - barH, bw, barH);
        }
      }
    }

    ctx.globalAlpha = 1;
  }, [waveform, frequencyWaveform, vocalTimeline, height]);

  return (
    <canvas
      ref={canvasRef}
      height={height}
      className={`w-full block rounded-sm ${className}`}
      style={{ height }}
    />
  );
}
