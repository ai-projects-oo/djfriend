/**
 * DJFriend Design Tokens — JS mirror of the CSS custom properties in app/index.css.
 *
 * USE THIS FILE for:
 *   - dynamic style props:  style={{ color: theme.text.primary }}
 *   - computed colors:      energyColor(), tagChip()
 *   - anywhere a color must be a JS string (canvas, SVG, charting)
 *
 * DO NOT duplicate color values here — if you change a color, change it in
 * index.css (:root) AND here. The CSS variables are the runtime source of
 * truth; this file is for TypeScript consumers.
 */

export const theme = {
  brand: {
    default: '#7c3aed',
    dark:    '#6d28d9',
    light:   '#a855f7',
    muted:   '#a78bfa',
  },

  bg: {
    base:     '#0a0a0f',
    surface:  '#12121a',
    input:    '#0d0d14',
    elevated: '#1a1a2e',
  },

  border: {
    default: '#1e1e2e',
    muted:   '#2a2a3a',
  },

  text: {
    primary:   '#e2e8f0',
    secondary: '#94a3b8',
    muted:     '#64748b',
    subtle:    '#475569',
    dim:       '#334155',
  },

  status: {
    success: '#22c55e',
    warning: '#f59e0b',
    error:   '#ef4444',
  },

  spotify: '#1db954',

  /** Semantic tag chip colors, keyed by tag category */
  tag: {
    vibe:  { bg: '#7c3aed22', text: '#a78bfa' },
    mood:  { bg: '#1d4ed822', text: '#60a5fa' },
    venue: { bg: '#06522022', text: '#34d399' },
    time:  { bg: '#92400e22', text: '#fbbf24' },
    vocal: { bg: '#4a044e22', text: '#e879f9' },
  },
} as const;

/**
 * Smooth green → yellow → red gradient for energy values (0–1).
 * Matches the CSS variable --dj-energy-saturation / --dj-energy-lightness.
 */
export function energyColor(energy: number): string {
  const hue = Math.round((1 - Math.max(0, Math.min(1, energy))) * 120);
  return `hsl(${hue}, 72%, 52%)`;
}
