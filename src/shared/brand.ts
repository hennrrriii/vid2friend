/**
 * Single source of truth for the visual identity. Content script CSS, popup CSS
 * and the generated icons all derive from these values.
 */
export const BRAND = {
  primary: '#2467d4',
  accent: '#72a3f2',
  primaryDark: '#1b4fa5',
  accentSoft: 'rgba(114, 163, 242, 0.16)',
} as const

/**
 * The logo mark as an inline SVG string. Inlining avoids declaring
 * `web_accessible_resources`, which would otherwise be needed to load an image
 * file from inside a content script.
 */
export function logoMarkSvg(size = 20): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}" aria-hidden="true" focusable="false">
    <defs><linearGradient id="v2f-mark-${size}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BRAND.accent}"/><stop offset="1" stop-color="${BRAND.primary}"/>
    </linearGradient></defs>
    <rect width="128" height="128" rx="30" fill="url(#v2f-mark-${size})"/>
    <g opacity="0.5"><path d="M32 44 L32 84 L56 64 Z" fill="#fff" stroke="#fff" stroke-width="11" stroke-linejoin="round"/></g>
    <path d="M66 38 L66 90 L100 64 Z" fill="#fff" stroke="#fff" stroke-width="12" stroke-linejoin="round"/>
  </svg>`
}
