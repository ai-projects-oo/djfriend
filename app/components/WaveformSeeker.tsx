import { useEffect, useRef, useCallback } from 'react';
import type { FrequencyWaveform } from '../types';

interface Props {
  waveform: number[];
  frequencyWaveform?: FrequencyWaveform;
  progress: number;      // 0–1
  height?: number;
  onSeek?: (progress: number) => void;
  className?: string;
}

// Blend bass/mid/high into a single RGB string
function bandColor(bass: number, mid: number, high: number): string {
  const total = bass + mid + high + 1e-6;
  const b = bass / total, m = mid / total, h = high / total;
  // Bass=orange-red, Mid=green, High=cyan-blue
  const r = Math.round(255 * b +  68 * m +   0 * h);
  const g = Math.round( 68 * b + 210 * m + 170 * h);
  const c = Math.round(  0 * b +  68 * m + 255 * h);
  return `rgb(${r},${g},${c})`;
}

// Amplitude-only fallback color
function amplitudeColor(v: number): string {
  if (v < 0.22) return '#33ccff';   // sparse → cyan
  if (v < 0.42) return '#44ee88';   // mid    → green
  return `rgb(${Math.round(200 + 55 * v)},${Math.round(68 + 20 * v)},0)`; // bass → orange-red
}

export default function WaveformSeeker({ waveform, frequencyWaveform, progress, height = 56, onSeek, className = '' }: Props) {
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
    const gap  = barW > 2 ? 0.8 : 0.3;
    const px   = progressRef.current * w;

    for (let i = 0; i < n; i++) {
      const v    = waveform[i];
      const x    = i * barW;
      const barH = Math.max(2, v * h * 0.95);

      // Color from real frequency data if available, else amplitude approximation
      const color = frequencyWaveform
        ? bandColor(frequencyWaveform.bass[i] ?? 0, frequencyWaveform.mid[i] ?? 0, frequencyWaveform.high[i] ?? 0)
        : amplitudeColor(v);

      ctx.globalAlpha = x < px ? 0.28 : 0.85 + v * 0.15;
      ctx.fillStyle   = color;
      ctx.fillRect(x, h - barH, Math.max(1, barW - gap), barH);
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
  }, [waveform, frequencyWaveform, height]);

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
