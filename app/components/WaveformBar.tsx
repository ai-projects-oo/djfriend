import { useEffect, useRef } from 'react';
import type { FrequencyWaveform } from '../types';

interface Props {
  waveform: number[];
  frequencyWaveform?: FrequencyWaveform;
  height?: number;
  className?: string;
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
    const bw   = Math.max(1, barW - 0.8);

    for (let i = 0; i < n; i++) {
      const v    = waveform[i];
      const barH = Math.max(1, v * h * 0.95);
      ctx.globalAlpha = 0.88 + v * 0.12;

      if (frequencyWaveform) {
        const bass = frequencyWaveform.bass[i] ?? 0;
        const mid  = frequencyWaveform.mid[i]  ?? 0;
        const high = frequencyWaveform.high[i] ?? 0;
        const total = bass + mid + high + 1e-6;
        const bassH = (bass / total) * barH;
        const midH  = (mid  / total) * barH;
        const highH = Math.max(0, barH - bassH - midH);
        const x = i * barW;

        if (bassH > 0.5) { ctx.fillStyle = '#ff4400'; ctx.fillRect(x, h - bassH, bw, bassH); }
        if (midH  > 0.5) { ctx.fillStyle = '#44dd55'; ctx.fillRect(x, h - bassH - midH, bw, midH); }
        if (highH > 0.5) { ctx.fillStyle = '#00bbff'; ctx.fillRect(x, h - barH, bw, highH); }
      } else {
        ctx.fillStyle = v < 0.25 ? '#00bbff' : v < 0.45 ? '#44dd55' : '#ff4400';
        ctx.fillRect(i * barW, h - barH, bw, barH);
      }
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
