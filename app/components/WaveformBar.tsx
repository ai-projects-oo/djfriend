import { useEffect, useRef } from 'react';
import type { FrequencyWaveform } from '../types';

interface CueMark { name: string; time: number; num: number; }

interface Props {
  waveform: number[];
  frequencyWaveform?: FrequencyWaveform;
  vocalTimeline?: number[];
  cuePoints?: CueMark[];
  duration?: number;
  height?: number;
  className?: string;
}

const CUE_COLOR = '#39ff14';
const CUE_LETTERS = ['A','B','C','D','E','F','G','H'];

function interp(arr: number[], n: number): number[] {
  if (!arr.length) return new Array(n).fill(0);
  return Array.from({ length: n }, (_, i) => {
    const pos = (i / (n - 1)) * (arr.length - 1);
    const lo = Math.floor(pos), hi = Math.min(arr.length - 1, lo + 1);
    return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
  });
}

export default function WaveformBar({ waveform, frequencyWaveform, vocalTimeline, cuePoints, duration, height = 28, className = '' }: Props) {
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

    const n    = waveform.length;
    const barW = w / n;
    const bw   = Math.max(1, barW * 0.55);
    const vocalInterp = vocalTimeline && vocalTimeline.length > 0 ? interp(vocalTimeline, n) : null;

    for (let i = 0; i < n; i++) {
      const v    = waveform[i];
      const barH = Math.max(1, v * h * 0.95);
      const x    = i * barW;
      ctx.globalAlpha = 0.88 + v * 0.12;

      if (frequencyWaveform) {
        const baseA = 0.88 + v * 0.12;
        const bassH = Math.max(1, (frequencyWaveform.bass[i] ?? 0) * h * 0.95);
        const midH  = Math.max(1, (frequencyWaveform.mid[i]  ?? 0) * h * 0.95);
        const highH = Math.max(1, (frequencyWaveform.high[i] ?? 0) * h * 0.95);
        ctx.globalAlpha = baseA;          ctx.fillStyle = '#ff0000'; ctx.fillRect(x, h - bassH, bw, bassH);
        ctx.globalAlpha = baseA * 0.72;   ctx.fillStyle = '#00e040'; ctx.fillRect(x, h - midH,  bw, midH);
        ctx.globalAlpha = baseA * 0.58;   ctx.fillStyle = '#0088ff'; ctx.fillRect(x, h - highH, bw, highH);
      } else {
        ctx.fillStyle = v < 0.25 ? '#0088ff' : v < 0.45 ? '#00e040' : '#ff0000';
        ctx.fillRect(x, h - barH, bw, barH);
      }

      if (vocalInterp) {
        const vp = vocalInterp[i];
        if (vp > 0.2) {
          ctx.globalAlpha = (vp - 0.2) * 0.7;
          ctx.fillStyle = '#dd66ff';
          ctx.fillRect(x, h - barH, bw, barH);
        }
      }
    }

    ctx.globalAlpha = 1;

    // Cue point markers
    if (cuePoints && cuePoints.length > 0 && duration && duration > 0) {
      const fontSize = Math.max(6, Math.round(h * 0.32));
      const pad = 1;
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.textBaseline = 'top';
      for (const cue of cuePoints) {
        const cx = (cue.time / duration) * w;
        if (cx < 0 || cx > w) continue;
        const letter = CUE_LETTERS[cue.num % CUE_LETTERS.length];

        // Tick line
        ctx.strokeStyle = CUE_COLOR;
        ctx.lineWidth = 0.8;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, h);
        ctx.stroke();

        // Label box
        const lw = fontSize * 0.7 + pad * 2;
        const lh = fontSize + pad * 2;
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = CUE_COLOR;
        ctx.fillRect(cx, 0, lw, lh);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#000';
        ctx.fillText(letter, cx + pad, pad);
      }
      ctx.globalAlpha = 1;
    }
  }, [waveform, frequencyWaveform, vocalTimeline, cuePoints, duration, height]);

  return (
    <canvas
      ref={canvasRef}
      height={height}
      className={`w-full block rounded-sm ${className}`}
      style={{ height }}
    />
  );
}
