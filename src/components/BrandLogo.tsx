/**
 * BrandLogo — the official Anush Finserv logo, rendered as inline SVG.
 *
 * The artwork is the real master geometry (see `brandPaths.ts`, extracted from
 * the supplied `Main-logo.svg`), split so each part can be coloured correctly:
 * the mark and "ANUSH" follow `currentColor`, while "FINSERV" and the triangle
 * in the A keep the fixed brand cyan. Because it is inline SVG (not an <img>),
 * one component serves light and dark themes — an external asset could not
 * inherit the text colour.
 *
 * Supersedes the old `/logo-mark.png` + `/anush-text.svg` pair, which were
 * traced from a JPEG and carried a baked-in purple plate off-brand from the
 * logo's deep blue.
 *
 * Brand palette:
 *   #022999  deep brand blue — mark + ANUSH on light surfaces
 *   #0AA8F8  brand cyan      — FINSERV + triangle (fixed, never themed)
 *
 * `tone`:
 *   'onDark'  — white artwork, for the blue/dark plate
 *   'onLight' — brand-blue artwork, for white/surface cards
 *   'auto'    — blue in light mode, white in dark mode
 */

import {
  MARK_PATHS, WORDMARK_PATHS, DIVIDER_PATHS, CYAN_PATHS,
  LOCKUP_VIEWBOX, MARK_VIEWBOX,
} from './brandPaths';

export type LogoTone = 'onDark' | 'onLight' | 'auto';

export const BRAND_BLUE = '#022999';
export const BRAND_CYAN = '#0AA8F8';

/** Tone → the text colour that the artwork's `currentColor` resolves to. */
function toneClass(tone: LogoTone): string {
  return tone === 'onDark'
    ? 'text-white'
    : tone === 'onLight'
      ? 'text-[#022999]'
      : 'text-[#022999] dark:text-white';
}

/**
 * The AF monogram alone — for tight spaces (collapsed sidebar, avatar slots)
 * where the wordmark would be unreadable.
 *
 * Sized by the square box you give it, e.g. `className="h-8 w-8"`.
 */
export function BrandMark({
  className = 'h-11 w-11',
  tone = 'auto',
}: {
  className?: string;
  tone?: LogoTone;
}) {
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      className={`${className} shrink-0 ${toneClass(tone)}`}
      fill="none"
      role="img"
      aria-label="Anush Finserv"
    >
      {MARK_PATHS.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

/**
 * The full horizontal lockup — the logo exactly as supplied. Preferred wherever
 * there is room, so the brand reads as it does on the master artwork.
 *
 * Sized by HEIGHT: the SVG preserves its ~4.1:1 aspect ratio, so pass a height
 * (e.g. `className="h-12"`) and the width follows automatically.
 */
export default function BrandLogo({
  className = 'h-12',
  tone = 'auto',
}: {
  className?: string;
  tone?: LogoTone;
}) {
  return (
    <svg
      viewBox={LOCKUP_VIEWBOX}
      className={`${className} w-auto shrink-0 ${toneClass(tone)}`}
      fill="none"
      role="img"
      aria-label="Anush Finserv"
    >
      {/* Mark + ANUSH — theme-coloured. */}
      {MARK_PATHS.map((d, i) => (
        <path key={`m${i}`} d={d} fill="currentColor" />
      ))}
      {WORDMARK_PATHS.map((d, i) => (
        <path key={`w${i}`} d={d} fill="currentColor" />
      ))}
      {/* Divider rule — theme-coloured, softened so it reads as a separator. */}
      <g opacity="0.55">
        {DIVIDER_PATHS.map((d, i) => (
          <path key={`d${i}`} d={d} fill="currentColor" />
        ))}
      </g>
      {/* FINSERV, its rules, and the triangle — fixed brand cyan. */}
      {CYAN_PATHS.map((d, i) => (
        <path key={`c${i}`} d={d} fill={BRAND_CYAN} />
      ))}
    </svg>
  );
}
