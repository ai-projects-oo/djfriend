import { useEffect, useRef } from 'react';

interface Props {
  waveform: number[];
  height?: number;
  color?: string;
  className?: string;
}

export default function WaveformBar({ waveform, height = 28, color = '#7c3aed', className = '' }: Props) {
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

    ctx.clearRect(0, 0, w, h);

    const barW = w / waveform.length;
    const mid = h / 2;

    waveform.forEach((v, i) => {
      const half = Math.max(1, v * mid);
      const alpha = 0.4 + v * 0.6;
      ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, '0');
      ctx.fillRect(i * barW, mid - half, Math.max(1, barW - 0.5), half * 2);
    });
  }, [waveform, height, color]);

  return (
    <canvas
      ref={canvasRef}
      height={height}
      className={`w-full block ${className}`}
      style={{ height }}
    />
  );
}
