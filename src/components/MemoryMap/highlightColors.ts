export type HighlightKind
  = | 'lhs'
    | 'rhs'
    | 'changed'
    | 'hover'
    | 'selected'
    /** Pointer hover: the allocation containing the pointer itself (arrow tail). */
    | 'pointer-source'
    /** Pointer hover: the allocation the pointer is currently pointing at (arrow head). */
    | 'pointer-target'

interface SvgStyle {
  fill: string | null
  stroke: string
  strokeWidth: number
  opacity: number
}

export const SVG_STYLES: Record<HighlightKind, SvgStyle> = {
  'lhs': { fill: 'rgb(59 130 246 / 0.15)', stroke: 'rgb(59 130 246)', strokeWidth: 2, opacity: 1 },
  'rhs': { fill: 'rgb(34 197 94 / 0.15)', stroke: 'rgb(34 197 94)', strokeWidth: 2, opacity: 1 },
  'changed': { fill: 'rgb(251 191 36 / 0.15)', stroke: 'rgb(251 191 36)', strokeWidth: 2, opacity: 1 },
  'hover': { fill: null, stroke: 'rgb(96 165 250)', strokeWidth: 2, opacity: 1 },
  'selected': { fill: null, stroke: 'rgb(96 165 250)', strokeWidth: 3, opacity: 1 },
  // Violet for the pointer itself (source), amber for where it points (target);
  // complementary enough that you can tell two ends of an arrow apart even
  // when the line is occluded.
  'pointer-source': { fill: 'rgb(168 85 247 / 0.18)', stroke: 'rgb(168 85 247)', strokeWidth: 2, opacity: 1 },
  'pointer-target': { fill: 'rgb(251 146 60 / 0.18)', stroke: 'rgb(251 146 60)', strokeWidth: 2, opacity: 1 },
}

/**
 * Stroke + line colors for pointer arrows, keyed by emphasis tier. Primary
 * picks up the pointer-source highlight color (violet) so the arrow and its
 * tail rectangle read as one connected thing. Ambient uses AddressLink green
 * (text-green-400) so a show-all-arrows view shares a palette with the link
 * text the arrows originate from. Alphas are tuned so heavy overlap (e.g.
 * show-all toggle on a linked list) still reads.
 */
export const ARROW_STYLES = {
  primary: {
    stroke: 'rgb(168 85 247 / 0.8)',
    width: 1.75,
    headFill: 'rgb(168 85 247 / 0.95)',
  },
  ambient: {
    stroke: 'rgb(74 222 128 / 0.55)',
    width: 1.25,
    headFill: 'rgb(74 222 128 / 0.75)',
  },
} as const

export const BOOST_STROKE = 'rgb(96 165 250 / 0.4)'
export const BOOST_WIDTH = 2
