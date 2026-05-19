import { useEffect, useRef, useCallback } from 'react';

interface Props {
  waveform: number[];
  progress: number;      // 0–1
  height?: number;
  onSeek?: (progress: number) => void;
  className?: string;
}

export default function WaveformSeeker({ waveform, progress, height = 40, onSeek, className = '' }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const frameRef   = useRef<number>(0);
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
    ctx.clearRect(0, 0, w, h);

    const barW = w / waveform.length;
    const mid  = h / 2;
    const px   = progressRef.current * w;

    // Frequency gradient (bass→highs)
    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0.00, '#ff5500');
    grad.addColorStop(0.35, '#ffcc00');
    grad.addColorStop(0.65, '#44dd88');
    grad.addColorStop(1.00, '#00aaff');

    // Dim gradient for played portion
    const dimGrad = ctx.createLinearGradient(0, h, 0, 0);
    dimGrad.addColorStop(0.00, '#ff5500');
    dimGrad.addColorStop(0.35, '#ffcc00');
    dimGrad.addColorStop(0.65, '#44dd88');
    dimGrad.addColorStop(1.00, '#00aaff');

    waveform.forEach((v, i) => {
      const x    = i * barW;
      const half = Math.max(1, v * mid);
      const played = x < px;
      ctx.globalAlpha = played ? 0.3 + v * 0.25 : 0.55 + v * 0.45;
      ctx.fillStyle   = played ? dimGrad : grad;
      ctx.fillRect(x, mid - half, Math.max(1, barW - 0.5), half * 2);
    });

    ctx.globalAlpha = 1;

    // Playhead line
    if (px > 0 && px < w) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
  }, [waveform, height]);

  // Redraw whenever progress changes (called from animation frame loop)
  useEffect(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(draw);
  }, [progress, draw]);

  // Initial draw + resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => { draw(); });
    ro.observe(canvas);
    draw();
    return () => { ro.disconnect(); cancelAnimationFrame(frameRef.current); };
  }, [draw]);

  const handlePointer = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(frac);
  }, [onSeek]);

  return (
    <canvas
      ref={canvasRef}
      height={height}
      onClick={handlePointer}
      className={`w-full block ${onSeek ? 'cursor-pointer' : ''} ${className}`}
      style={{ height }}
    />
  );
}
