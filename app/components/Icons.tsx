/** Small brand + action SVG icons used across the app. */

interface IconProps {
  size?: number;
  className?: string;
}

export function SpotifyIcon({ size = 16, className = '' }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="currentColor"
      className={className} aria-hidden="true"
    >
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.623.623 0 01-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.623.623 0 01-.277-1.215c3.809-.87 7.076-.496 9.712 1.115a.623.623 0 01.207.857zm1.223-2.722a.78.78 0 01-1.072.257C14.1 12.186 10.679 11.7 7.49 12.625a.78.78 0 01-.453-1.492c3.584-1.088 7.427-.561 10.266 1.497a.78.78 0 01.506 1.072zm.105-2.835c-3.223-1.914-8.54-2.09-11.618-1.156a.936.936 0 11-.543-1.79c3.532-1.073 9.404-.866 13.115 1.337a.936.936 0 01-.954 1.609z"/>
    </svg>
  );
}

export function RekordboxIcon({ size = 16, className = '' }: IconProps) {
  // Official Rekordbox logo — hexagon with circle/pin mark
  return (
    <svg
      width={size} height={size} viewBox="0 0 100 100" fill="currentColor"
      className={className} aria-hidden="true"
    >
      <path d="M50 2 L93 26 L93 74 L50 98 L7 74 L7 26 Z" fillOpacity="0"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M50 4.5 L91 27.25 L91 72.75 L50 95.5 L9 72.75 L9 27.25 Z M50 28 C38.954 28 30 36.954 30 48 C30 55.168 33.86 61.42 39.6 64.8 L39.6 76 L45 76 L45 67.6 C46.6 67.87 48.284 68 50 68 C61.046 68 70 59.046 70 48 C70 36.954 61.046 28 50 28 Z M50 36 C56.627 36 62 41.373 62 48 C62 54.627 56.627 60 50 60 C43.373 60 38 54.627 38 48 C38 41.373 43.373 36 50 36 Z M50 42 C46.686 42 44 44.686 44 48 C44 51.314 46.686 54 50 54 C53.314 54 56 51.314 56 48 C56 44.686 53.314 42 50 42 Z"/>
    </svg>
  );
}

export function GroqIcon({ size = 16, className = '' }: IconProps) {
  // Groq "G" lettermark — bold G shape
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="currentColor"
      className={className} aria-hidden="true"
    >
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5h-1.5v-1.26C10.17 15.69 9 14.47 9 13v-2c0-1.65 1.35-3 3-3h2v1.5h-2c-.83 0-1.5.67-1.5 1.5v2c0 .83.67 1.5 1.5 1.5H13v-1.5h1.5V16c0 .28-.22.5-.5.5z"/>
    </svg>
  );
}

export function M3UIcon({ size = 16, className = '' }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="8" y1="13" x2="16" y2="13"/>
      <line x1="8" y1="17" x2="16" y2="17"/>
      <line x1="10" y1="9" x2="8" y2="9"/>
    </svg>
  );
}

export function CopyIcon({ size = 16, className = '' }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
    </svg>
  );
}

export function DiscogsIcon({ size = 16, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 2.4c5.302 0 9.6 4.298 9.6 9.6s-4.298 9.6-9.6 9.6S2.4 17.302 2.4 12 6.698 2.4 12 2.4zm0 3.6a6 6 0 100 12A6 6 0 0012 6zm0 2.4a3.6 3.6 0 110 7.2A3.6 3.6 0 0112 8.4zm0 2.4a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z"/>
    </svg>
  );
}

export function BeatportIcon({ size = 16, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 1036 1200" fill="currentColor" className={className} aria-hidden="true">
      <path d="M817.7,763.3c0,120-95.8,217-217,217c-120,0-215.8-94.6-215.8-217c0-57.6,21.8-108.5,56.4-146.7L294.6,763.3l-77-77 l165.5-163.7c22.4-22.4,33.9-51.5,33.9-83.6V233.6h108.5V439c0,63-22.4,116.4-66.1,160l-4.9,4.8c38.2-35.2,90.3-56.4,146.1-56.4 C723.8,547.5,817.7,645.1,817.7,763.3z M719.5,763.3c0-64.3-53.3-116.4-118.8-116.4c-66.1,0-117.6,54.6-117.6,116.4 c0,63.6,52.1,117.6,117.6,117.6C668.6,880.9,719.5,825.8,719.5,763.3z"/>
    </svg>
  );
}

export function TraxsourceIcon({ size = 16, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4 7.5h-3V17h-2V9.5H8V8h8v1.5z"/>
    </svg>
  );
}

export function ImageIcon({ size = 16, className = '' }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  );
}
