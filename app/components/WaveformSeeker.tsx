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

// Draw one bar as vertically stacked frequency bands (bass bottom → high top)
function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number, barW: number, h: number,
  barH: number,
  bass: number, mid: number, high: number,
  alpha: number,
) {
  const total = bass + mid + high + 1e-6;
  const bassH = (bass / total) * barH;
  const midH  = (mid  / total) * barH;
  const highH = Math.max(0, barH - bassH - midH);
  const bw    = Math.max(1, barW - 0.8);

  ctx.globalAlpha = alpha;

  // Bass — orange/red at the bottom
  if (bassH > 0.5) {
    ctx.fillStyle = '#ff4400';
    ctx.fillRect(x, h - bassH, bw, bassH);
  }
  // Mid — green above bass
  if (midH > 0.5) {
    ctx.fillStyle = '#44dd55';
    ctx.fillRect(x, h - bassH - midH, bw, midH);
  }
  // High — cyan at the top
  if (highH > 0.5) {
    ctx.fillStyle = '#00bbff';
    ctx.fillRect(x, h - barH, bw, highH);
  }
}

// Amplitude fallback: single gradient bar
function drawBarAmplitude(
  ctx: CanvasRenderingContext2D,
  x: number, barW: number, h: number,
  barH: number, v: number, alpha: number,
) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = v < 0.25 ? '#00bbff' : v < 0.45 ? '#44dd55' : '#ff4400';
  ctx.fillRect(x, h - barH, Math.max(1, barW - 0.8), barH);
}

// Interpolate a short array (e.g. vocalTimeline) to n points
function interp(arr: number[], n: number): number[] {
  if (!arr.length) return new Array(n).fill(0);
  return Array.from({ length: n }, (_, i) => {
    const pos = (i / (n - 1)) * (arr.length - 1);
    const lo = Math.floor(pos), hi = Math.min(arr.length - 1, lo + 1);
    return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
  });
}

const VOCAL_STRIP_H = 5; // px reserved at top for vocal presence strip

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
    const px   = progressRef.current * w;

    // Waveform area starts below the vocal strip
    const waveTop = vocalTimeline && vocalTimeline.length > 0 ? VOCAL_STRIP_H + 1 : 0;
    const waveH   = h - waveTop;

    for (let i = 0; i < n; i++) {
      const v     = waveform[i];
      const x     = i * barW;
      const barH  = Math.max(2, v * waveH * 0.95);
      const played = x < px;
      const alpha  = played ? 0.25 : 0.88 + v * 0.12;

      // Offset bars down so they sit below the vocal strip
      const ctxShifted = { ...ctx };
      void ctxShifted;

      if (frequencyWaveform) {
        // Temporarily translate for the bar area
        ctx.save();
        ctx.translate(0, waveTop);
        drawBar(ctx, x, barW, waveH, barH,
          frequencyWaveform.bass[i] ?? 0,
          frequencyWaveform.mid[i]  ?? 0,
          frequencyWaveform.high[i] ?? 0,
          alpha);
        ctx.restore();
      } else {
        ctx.save();
        ctx.translate(0, waveTop);
        drawBarAmplitude(ctx, x, barW, waveH, barH, v, alpha);
        ctx.restore();
      }
    }

    ctx.globalAlpha = 1;

    // Vocal presence strip
    if (vocalTimeline && vocalTimeline.length > 0) {
      const vocalInterp = interp(vocalTimeline, n);
      for (let i = 0; i < n; i++) {
        const v = vocalInterp[i];
        if (v < 0.25) continue; // below threshold — leave dark
        const x = i * barW;
        const played = x < px;
        ctx.globalAlpha = played ? (v - 0.25) * 0.4 : (v - 0.25) * 1.3;
        ctx.fillStyle = '#dd88ff'; // soft purple
        ctx.fillRect(x, 0, Math.max(1, barW - 0.5), VOCAL_STRIP_H);
      }
      ctx.globalAlpha = 1;
    }

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
