import { useEffect, useRef } from 'react';
import type { FrequencyWaveform } from '../types';

interface Props {
  waveform: number[];
  frequencyWaveform?: FrequencyWaveform;
  height?: number;
  className?: string;
}

function bandColor(bass: number, mid: number, high: number): string {
  const total = bass + mid + high + 1e-6;
  const b = bass / total, m = mid / total, h = high / total;
  const r = Math.round(255 * b +  68 * m +   0 * h);
  const g = Math.round( 68 * b + 210 * m + 170 * h);
  const c = Math.round(  0 * b +  68 * m + 255 * h);
  return `rgb(${r},${g},${c})`;
}

function amplitudeColor(v: number): string {
  if (v < 0.22) return '#33ccff';
  if (v < 0.42) return '#44ee88';
  return `rgb(${Math.round(200 + 55 * v)},${Math.round(68 + 20 * v)},0)`;
}

export default function WaveformBar({ waveform, frequencyWaveform, height = 28, className = '' }: Props) {
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
    const gap  = barW > 2 ? 0.8 : 0.3;

    for (let i = 0; i < n; i++) {
      const v    = waveform[i];
      const barH = Math.max(1, v * h * 0.95);

      ctx.globalAlpha = 0.85 + v * 0.15;
      ctx.fillStyle   = frequencyWaveform
        ? bandColor(frequencyWaveform.bass[i] ?? 0, frequencyWaveform.mid[i] ?? 0, frequencyWaveform.high[i] ?? 0)
        : amplitudeColor(v);
      ctx.fillRect(i * barW, h - barH, Math.max(1, barW - gap), barH);
    }

    ctx.globalAlpha = 1;
  }, [waveform, frequencyWaveform, height]);

  return (
    <canvas
      ref={canvasRef}
      height={height}
      className={`w-full block rounded-sm ${className}`}
      style={{ height }}
    />
  );
}
