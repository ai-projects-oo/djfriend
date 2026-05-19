import { useEffect, useRef } from 'react';

interface Props {
  waveform: number[];
  height?: number;
  className?: string;
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

    ctx.clearRect(0, 0, w, h);

    const barW = w / waveform.length;
    const mid  = h / 2;

    // Vertical gradient: bass (bottom) → mids → highs (top)
    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0.00, '#ff5500'); // bass — orange-red
    grad.addColorStop(0.35, '#ffcc00'); // low-mids — yellow
    grad.addColorStop(0.65, '#44dd88'); // upper-mids — green
    grad.addColorStop(1.00, '#00aaff'); // highs — cyan-blue

    waveform.forEach((v, i) => {
      const half  = Math.max(1, v * mid);
      const alpha = 0.35 + v * 0.65;
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = grad;
      ctx.fillRect(i * barW, mid - half, Math.max(1, barW - 0.5), half * 2);
    });

    ctx.globalAlpha = 1;
  }, [waveform, height]);

  return (
    <canvas
      ref={canvasRef}
      height={height}
      className={`w-full block ${className}`}
      style={{ height }}
    />
  );
}
