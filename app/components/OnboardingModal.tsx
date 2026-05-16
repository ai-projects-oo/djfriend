import { useState } from "react";

interface Props {
  isElectron: boolean;
  isMacOS: boolean;
  hasSpotifyCredentials: boolean;
  onScanAppleMusic: () => void;
  onImportM3U: () => void;
  onImportRekordbox: () => void;
  onUploadFolder: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
}

interface ImportOption {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  action: () => void;
  primary?: boolean;
}

export default function OnboardingModal({
  isElectron,
  isMacOS,
  hasSpotifyCredentials,
  onScanAppleMusic,
  onImportM3U,
  onImportRekordbox,
  onUploadFolder,
  onOpenSettings,
  onDismiss,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  const electronOptions: ImportOption[] = [
    ...(isMacOS ? [{
      id: "apple",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
        </svg>
      ),
      title: "Scan Apple Music",
      description: "Analyze your playlists directly from the Apple Music app",
      action: onScanAppleMusic,
      primary: true,
    }] : []),
    {
      id: "rekordbox",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>
          <line x1="12" y1="3" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="21"/>
        </svg>
      ),
      title: "Import Rekordbox XML",
      description: "Load your collection and playlists from Rekordbox",
      action: onImportRekordbox,
      primary: !isMacOS,
    },
    {
      id: "m3u",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="8" y1="13" x2="16" y2="13"/>
          <line x1="8" y1="17" x2="13" y2="17"/>
        </svg>
      ),
      title: "Import M3U / TXT playlist",
      description: "Load a playlist file exported from any DJ software",
      action: onImportM3U,
    },
  ];

  const webOptions: ImportOption[] = [
    {
      id: "upload",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 15v4c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2v-4M17 8l-5-5-5 5M12 3v12"/>
        </svg>
      ),
      title: "Upload a folder",
      description: "Drop a folder of MP3/FLAC files — analyzed in your browser",
      action: onUploadFolder,
      primary: true,
    },
    {
      id: "rekordbox",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>
          <line x1="12" y1="3" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="21"/>
        </svg>
      ),
      title: "Import Rekordbox XML",
      description: "Load your collection and playlists from Rekordbox",
      action: onImportRekordbox,
    },
    {
      id: "m3u",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="8" y1="13" x2="16" y2="13"/>
          <line x1="8" y1="17" x2="13" y2="17"/>
        </svg>
      ),
      title: "Import M3U / TXT playlist",
      description: "Load a playlist file exported from any DJ software",
      action: onImportM3U,
    },
  ];

  const options = isElectron ? electronOptions : webOptions;

  return (
    <div className="fixed inset-0 z-50 bg-[#0d0d14]/95 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <img src="/icon.png" alt="" width={32} height={32} className="rounded-md" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <span className="text-2xl font-bold tracking-tight text-[#e2e8f0]">DJFriend</span>
          </div>
          <p className="text-[#64748b] text-sm leading-relaxed">
            Generate perfect DJ sets from your music library.<br/>
            <span className="text-[#475569]">Start by loading your tracks.</span>
          </p>
        </div>

        {/* Import options */}
        <div className="flex flex-col gap-2 mb-6">
          {options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => { opt.action(); onDismiss(); }}
              onMouseEnter={() => setHovered(opt.id)}
              onMouseLeave={() => setHovered(null)}
              className="flex items-center gap-4 w-full text-left px-4 py-3.5 rounded-xl border transition-all cursor-pointer"
              style={{
                backgroundColor: opt.primary
                  ? hovered === opt.id ? '#7c3aed22' : '#7c3aed11'
                  : hovered === opt.id ? '#1e1e2e' : '#12121a',
                borderColor: opt.primary
                  ? hovered === opt.id ? '#7c3aed88' : '#7c3aed44'
                  : hovered === opt.id ? '#2a2a3a' : '#1e1e2e',
              }}
            >
              <span
                className="flex-shrink-0"
                style={{ color: opt.primary ? '#a78bfa' : '#475569' }}
              >
                {opt.icon}
              </span>
              <div className="min-w-0">
                <div
                  className="text-sm font-medium leading-snug"
                  style={{ color: opt.primary ? '#e2e8f0' : '#94a3b8' }}
                >
                  {opt.title}
                </div>
                <div className="text-[11px] text-[#334155] leading-snug mt-0.5">
                  {opt.description}
                </div>
              </div>
              {opt.primary && (
                <svg className="ml-auto flex-shrink-0 text-[#7c3aed]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[11px] text-[#334155] px-1">
          <div className="flex items-center gap-2">
            {!hasSpotifyCredentials && (
              <button
                onClick={() => { onOpenSettings(); onDismiss(); }}
                className="hover:text-[#64748b] transition-colors cursor-pointer"
              >
                Connect Spotify →
              </button>
            )}
          </div>
          <button
            onClick={onDismiss}
            className="hover:text-[#64748b] transition-colors cursor-pointer"
          >
            Skip for now →
          </button>
        </div>
      </div>
    </div>
  );
}
