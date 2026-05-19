import { useEffect, useRef, useCallback } from 'react';

interface Props {
  waveform: number[];
  progress: number;      // 0–1
  height?: number;
  onSeek?: (progress: number) => void;
  className?: string;
}

// Pick bar color based on amplitude — mimics Rekordbox frequency-zone tinting
function barGradient(ctx: CanvasRenderingContext2D, h: number, v: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, h, 0, 0);
  if (v < 0.22) {
    // Sparse / transient-only → cyan (hi-hat zone)
    g.addColorStop(0, '#006688');
    g.addColorStop(1, '#33ccff');
  } else if (v < 0.42) {
    // Mid energy → green-teal
    g.addColorStop(0, '#116644');
    g.addColorStop(1, '#44ee99');
  } else {
    // Full energy → warm orange/salmon (bass dominant)
    g.addColorStop(0,    '#cc2200');
    g.addColorStop(0.35, '#ff5500');
    g.addColorStop(0.70, '#ff8844');
    g.addColorStop(1,    '#ffbb77');
  }
  return g;
}

export default function WaveformSeeker({ waveform, progress, height = 56, onSeek, className = '' }: Props) {
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

    // Near-black background
    ctx.fillStyle = '#090910';
    ctx.fillRect(0, 0, w, h);

    const barW = w / waveform.length;
    const gap  = barW > 2 ? 0.8 : 0.3;
    const px   = progressRef.current * w;

    waveform.forEach((v, i) => {
      const x      = i * barW;
      const barH   = Math.max(2, v * h * 0.95);
      const played = x < px;

      ctx.globalAlpha = played ? 0.28 : 0.9;
      ctx.fillStyle   = barGradient(ctx, h, v);
      ctx.fillRect(x, h - barH, Math.max(1, barW - gap), barH);
    });

    ctx.globalAlpha = 1;

    // Playhead — thin white line
    if (px > 0 && px < w) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
  }, [waveform, height]);

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
