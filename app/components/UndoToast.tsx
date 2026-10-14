import { useEffect } from "react";
import type { PlaylistNotice } from "../hooks/usePlaylists";

const SHOW_MS = 6000;

interface Props {
  notice: PlaylistNotice;
  onUndo: () => void;
  onDismiss: () => void;
}

/** Bottom-centre notice after a playlist edit ("Removed 3 tracks from “Warmup”  Undo"). */
export default function UndoToast({ notice, onUndo, onDismiss }: Props) {
  useEffect(() => {
    const t = setTimeout(onDismiss, SHOW_MS);
    return () => clearTimeout(t);
  }, [notice.nonce, onDismiss]);

  return (
    <div role="status" aria-live="polite"
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[120] flex items-center gap-3 px-4 py-2.5 rounded-xl border border-[#363650] bg-[#20202e] shadow-2xl text-xs text-[#e2e8f0] max-w-[90vw]">
      <span className="truncate">{notice.text}</span>
      {notice.canUndo && (
        <button type="button" onClick={() => { onUndo(); }} className="font-semibold text-[#a78bfa] hover:text-white cursor-pointer flex-shrink-0">
          Undo <span className="text-[10px] text-[#64748b] font-normal">⌘Z</span>
        </button>
      )}
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-[#64748b] hover:text-[#e2e8f0] cursor-pointer flex-shrink-0">✕</button>
    </div>
  );
}
