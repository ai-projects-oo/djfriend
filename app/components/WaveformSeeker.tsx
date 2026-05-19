import { useEffect, useRef, useCallback } from 'react';
import type { FrequencyWaveform } from '../types';

interface Props {
  waveform: number[];
  frequencyWaveform?: FrequencyWaveform;
  vocalTimeline?: number[];
  progress: number;      // 0–1
  height?: number;
  onSeek?: (progress: number) => void;
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

export default function WaveformSeeker({ waveform, frequencyWaveform, vocalTimeline, progress, height = 56, onSeek, className = '' }: Props) {
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

    const n    = waveform.length;
    const barW = w / n;
    const bw   = Math.max(1, barW - 0.8);
    const px   = progressRef.current * w;
    const vocalInterp = vocalTimeline && vocalTimeline.length > 0 ? interp(vocalTimeline, n) : null;

    for (let i = 0; i < n; i++) {
      const v      = waveform[i];
      const x      = i * barW;
      const barH   = Math.max(2, v * h * 0.95);
      const played = x < px;
      const alpha  = played ? 0.25 : 0.88 + v * 0.12;

      ctx.globalAlpha = alpha;

      if (frequencyWaveform) {
        const bass = frequencyWaveform.bass[i] ?? 0;
        const mid  = frequencyWaveform.mid[i]  ?? 0;
        const high = frequencyWaveform.high[i] ?? 0;
        const total = bass + mid + high + 1e-6;
        const bassH = (bass / total) * barH;
        const midH  = (mid  / total) * barH;
        const highH = Math.max(0, barH - bassH - midH);

        if (bassH > 0.5) { ctx.fillStyle = '#ff4400'; ctx.fillRect(x, h - bassH, bw, bassH); }
        if (midH  > 0.5) { ctx.fillStyle = '#44dd55'; ctx.fillRect(x, h - bassH - midH, bw, midH); }
        if (highH > 0.5) { ctx.fillStyle = '#00bbff'; ctx.fillRect(x, h - barH, bw, highH); }
      } else {
        ctx.fillStyle = v < 0.25 ? '#00bbff' : v < 0.45 ? '#44dd55' : '#ff4400';
        ctx.fillRect(x, h - barH, bw, barH);
      }

      // Vocal overlay — drawn on top of frequency layers
      if (vocalInterp) {
        const vp = vocalInterp[i];
        if (vp > 0.2) {
          ctx.globalAlpha = played
            ? (vp - 0.2) * 0.25
            : (vp - 0.2) * 0.7;
          ctx.fillStyle = '#dd66ff';
          ctx.fillRect(x, h - barH, bw, barH);
        }
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
  }, [waveform, frequencyWaveform, vocalTimeline, height]);

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
