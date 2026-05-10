// Neon border + glow helper — GLOBALLY DISABLED.
// The neon treatment is now only applied directly in CoreChatScreen; every other
// screen still calls these helpers, but they return `{}` so light/dark mode look
// like the classic (pre-neon) UI outside of Core chat.
import type { ColorTokens } from './colors'

export type NeonHue = 'sky' | 'violet' | 'amber' | 'green' | 'red'

const HUE_HEX: Record<NeonHue, string> = {
  sky: '#38BDF8',
  violet: '#A78BFA',
  amber: '#F59E0B',
  green: '#22C55E',
  red: '#F87171',
}

// No-op: returns an empty style object regardless of theme. Kept so existing
// `...neonCard(colors, isDark)` spreads across screens remain valid but have
// no visual effect.
export const neonCard = (
  _colors: ColorTokens,
  _isDark: boolean,
  _hue: NeonHue = 'sky',
) => {
  return {}
}

// No-op: softer variant, also disabled globally.
export const neonSoft = (
  _colors: ColorTokens,
  _isDark: boolean,
  _hue: NeonHue = 'sky',
) => {
  return {}
}

export const NeonPalette = HUE_HEX
