import { useEffect, useState } from "react";

export const STATUS_FADE_MS = 220;

interface LoaderStatusProps {
  label: string;
  detail?: string;
}

/** Status line for the startup overlay — cross-fades whenever `label` changes; `detail` updates in place. */
export default function LoaderStatus({ label, detail }: LoaderStatusProps) {
  const [shown, setShown] = useState(label);
  const [visible, setVisible] = useState(false);

  // Fade in on first mount
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Fade out → swap text → fade in
  useEffect(() => {
    if (label === shown) return;
    const out = requestAnimationFrame(() => setVisible(false));
    const swap = setTimeout(() => {
      setShown(label);
      setVisible(true);
    }, STATUS_FADE_MS);
    return () => {
      cancelAnimationFrame(out);
      clearTimeout(swap);
    };
  }, [label, shown]);

  return (
    <p
      className="text-xs text-[#b6c2d0] h-4 transition-opacity ease-in-out"
      style={{ opacity: visible ? 1 : 0, transitionDuration: `${STATUS_FADE_MS}ms` }}
      aria-live="polite"
    >
      {shown}
      {detail && shown === label && <span className="text-[#8d9aab]"> · {detail}</span>}
    </p>
  );
}
