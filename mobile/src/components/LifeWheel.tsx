import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import Svg, { Polygon, Polyline, Circle, Line, Text as SvgText } from 'react-native-svg'
import {
  LIFE_DIMENSIONS,
  DIMENSION_LABELS,
  DIMENSION_COLORS,
  type LifeDimension,
} from '../constants/dimensions'
import { useTheme } from '../contexts/ThemeContext'

interface Props {
  /** Map of dimension code -> score (1-10). Missing dims are drawn at 0. */
  scores: Partial<Record<LifeDimension, number>>
  /** Optional second layer (e.g. self-ratings drawn in muted color). */
  secondaryScores?: Partial<Record<LifeDimension, number>>
  size?: number
  /** If true, show small dots on each vertex. */
  showDots?: boolean
}

/**
 * Radar chart for the 6-dimension Life Wheel.
 *
 * Uses an inscribed hexagon — each vertex is one dimension. Scores are scaled
 * from 0 at center to 10 at the outer ring. Drawn as a filled polygon with a
 * subtle gradient via two overlapping shapes.
 */
export function LifeWheel({
  scores,
  secondaryScores,
  size = 260,
  showDots = true,
}: Props) {
  const { colors } = useTheme()
  // Extra horizontal room so long labels (e.g. "Relationships", "Intellectual")
  // don't get clipped at the 0° and 180° positions.
  const sideMargin = 44
  const svgWidth = size + sideMargin * 2
  const svgHeight = size
  const center = svgWidth / 2
  const centerY = svgHeight / 2
  const radius = size / 2 - 28 // slightly smaller so labels fit vertically too
  const N = LIFE_DIMENSIONS.length

  // Vertex angles: start at top (12 o'clock) and go clockwise
  const angleFor = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / N

  const pointAt = (i: number, value: number) => {
    const r = (Math.max(0, Math.min(10, value)) / 10) * radius
    const a = angleFor(i)
    return { x: center + r * Math.cos(a), y: centerY + r * Math.sin(a) }
  }

  const labelAt = (i: number) => {
    const a = angleFor(i)
    const r = radius + 16
    return { x: center + r * Math.cos(a), y: centerY + r * Math.sin(a) }
  }

  const makePolygonPoints = (src: Partial<Record<LifeDimension, number>>) =>
    LIFE_DIMENSIONS.map((dim, i) => {
      const p = pointAt(i, src[dim] ?? 0)
      return `${p.x},${p.y}`
    }).join(' ')

  // Background rings (2, 4, 6, 8, 10)
  const rings = [2, 4, 6, 8, 10].map((level, idx) => {
    const points = LIFE_DIMENSIONS.map((_, i) => {
      const p = pointAt(i, level)
      return `${p.x},${p.y}`
    }).join(' ')
    return <Polygon key={idx} points={points} stroke={colors.border} strokeWidth={0.5} fill="none" />
  })

  // Radial spokes
  const spokes = LIFE_DIMENSIONS.map((_, i) => {
    const p = pointAt(i, 10)
    return (
      <Line
        key={i}
        x1={center}
        y1={centerY}
        x2={p.x}
        y2={p.y}
        stroke={colors.border}
        strokeWidth={0.5}
      />
    )
  })

  const observedPoints = makePolygonPoints(scores)
  const secondaryPoints = secondaryScores ? makePolygonPoints(secondaryScores) : null

  return (
    <View style={styles.wrapper}>
      <Svg width={svgWidth} height={svgHeight}>
        {rings}
        {spokes}

        {/* Secondary (self) as dashed outline */}
        {secondaryPoints && (
          <Polyline
            points={secondaryPoints + ' ' + secondaryPoints.split(' ')[0]}
            stroke={colors.textSecondary}
            strokeWidth={1.5}
            strokeDasharray="4,3"
            fill="none"
          />
        )}

        {/* Observed polygon (primary) */}
        <Polygon
          points={observedPoints}
          fill={colors.primary[500]}
          fillOpacity={0.22}
          stroke={colors.primary[500]}
          strokeWidth={2}
        />

        {/* Dots per dimension in its color */}
        {showDots &&
          LIFE_DIMENSIONS.map((dim, i) => {
            const p = pointAt(i, scores[dim] ?? 0)
            return <Circle key={dim} cx={p.x} cy={p.y} r={4} fill={DIMENSION_COLORS[dim]} />
          })}

        {/* Labels */}
        {LIFE_DIMENSIONS.map((dim, i) => {
          const l = labelAt(i)
          const anchor: 'start' | 'middle' | 'end' =
            l.x < center - 4 ? 'end' : l.x > center + 4 ? 'start' : 'middle'
          return (
            <SvgText
              key={`label-${dim}`}
              x={l.x}
              y={l.y}
              fontSize={11}
              fontWeight="600"
              fill={colors.textSecondary}
              textAnchor={anchor}
              alignmentBaseline="middle"
            >
              {DIMENSION_LABELS[dim]}
            </SvgText>
          )
        })}
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
})
