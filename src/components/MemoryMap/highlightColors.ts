export type HighlightKind = 'lhs' | 'rhs' | 'changed' | 'hover' | 'selected'

interface SvgStyle {
  fill: string | null
  stroke: string
  strokeWidth: number
  opacity: number
}

export const SVG_STYLES: Record<HighlightKind, SvgStyle> = {
  lhs: { fill: 'rgb(59 130 246 / 0.15)', stroke: 'rgb(59 130 246)', strokeWidth: 2, opacity: 1 },
  rhs: { fill: 'rgb(34 197 94 / 0.15)', stroke: 'rgb(34 197 94)', strokeWidth: 2, opacity: 1 },
  changed: { fill: 'rgb(251 191 36 / 0.15)', stroke: 'rgb(251 191 36)', strokeWidth: 2, opacity: 1 },
  hover: { fill: null, stroke: 'rgb(96 165 250)', strokeWidth: 2, opacity: 1 },
  selected: { fill: null, stroke: 'rgb(96 165 250)', strokeWidth: 3, opacity: 1 },
}

export const BOOST_STROKE = 'rgb(96 165 250 / 0.4)'
export const BOOST_WIDTH = 2
