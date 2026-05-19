import { useEffect, useRef } from 'react';

interface Props {
  waveform: number[];
  height?: number;
  className?: string;
}

function barGradient(ctx: CanvasRenderingContext2D, h: number, v: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, h, 0, 0);
  if (v < 0.22) {
    g.addColorStop(0, '#006688');
    g.addColorStop(1, '#33ccff');
  } else if (v < 0.42) {
    g.addColorStop(0, '#116644');
    g.addColorStop(1, '#44ee99');
  } else {
    g.addColorStop(0,    '#cc2200');
    g.addColorStop(0.35, '#ff5500');
    g.addColorStop(0.70, '#ff8844');
    g.addColorStop(1,    '#ffbb77');
  }
  return g;
}

export default function WaveformBar({ waveform, height = 28, className = '' }: Props) {
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

    const barW = w / waveform.length;
    const gap  = barW > 2 ? 0.8 : 0.3;

    waveform.forEach((v, i) => {
      const barH = Math.max(1, v * h * 0.95);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle   = barGradient(ctx, h, v);
      ctx.fillRect(i * barW, h - barH, Math.max(1, barW - gap), barH);
    });

    ctx.globalAlpha = 1;
  }, [waveform, height]);

  return (
    <canvas
      ref={canvasRef}
      height={height}
      className={`w-full block rounded-sm ${className}`}
      style={{ height }}
    />
  );
}
