## Overview

The Memory Operating System employs a **dual-platform styling strategy** that maintains visual consistency across web (React + Vite) and mobile (React Native + Expo) through shared design tokens while leveraging platform-appropriate tooling.

---

## Web Frontend: Tailwind CSS Utility-First Approach

### Configuration

The web application uses **Tailwind CSS v3** with PostCSS for processing. The configuration (`frontend/tailwind.config.js`) extends the default theme with:

- **Custom color palette**: A `primary` scale based on sky blue (`#0ea5e9` at 500), providing 10 shades from 50 to 900
- **Custom animations**: `fadeIn`, `fade-in` keyframes for subtle entrance effects

### Styling Methodology

The codebase follows a **hybrid approach** combining:

1. **Utility-first classes** — Direct Tailwind utility classes applied inline in JSX (e.g., `className="flex items-center gap-3 rounded-lg transition-colors"`)
2. **Component-level abstractions** — Custom component classes defined in `frontend/src/index.css` using `@layer components`:
   - `.btn-primary` / `.btn-secondary` — Standardized button styles
   - `.card` — White background, rounded corners, subtle shadow and border
   - `.input` / `.textarea` — Form controls with focus ring using primary color

### Animation System

A rich set of **custom keyframe animations** is defined in `index.css`:

| Animation | Purpose |
|-----------|---------|
| `fade-in` | Simple opacity transition (0.2s) |
| `scale-in` | Scale + opacity entrance (0.25s) |
| `slide-up` | Vertical slide with cubic-bezier easing (0.4s) |
| `shimmer` | Loading skeleton effect (2s infinite) |
| `float` | Gentle vertical bobbing (3s infinite) |
| `pulse-soft` | Subtle opacity pulse |

Staggered animation delays (`.stagger-1` through `.stagger-5`) enable sequenced entrances.

### Visual Effects

- **Glass morphism**: `.glass` class applies `backdrop-filter: blur(12px)`
- **Gradient text**: `.gradient-text` uses a purple-to-indigo gradient clipped to text

### Base Styles

Global defaults set via `@layer base`:
- Body background: `bg-gray-50`
- Body text: `text-gray-900`

---

## Mobile: React Native Theme Context with Design Tokens

### Architecture

The mobile app uses a **React Context-based theming system** (`mobile/src/contexts/ThemeContext.tsx`) that provides:

- **Three theme modes**: `'system'` (follows OS), `'light'`, `'dark'`
- **Persistent preference**: Stored in AsyncStorage under key `'theme-mode'`
- **Dynamic resolution**: Combines user preference with `useColorScheme()` from React Native

### Design Tokens

All visual values are centralized in `mobile/src/constants/colors.ts`:

#### Color Palette

The mobile palette **mirrors the web Tailwind config** exactly for the `primary` scale, ensuring cross-platform visual parity:

```typescript
primary: {
  50: '#f0f9ff',  // ... through 900: '#0c4a6e'
}
```

Additional semantic scales: `gray`, `green`, `red`, `amber`, `purple` — each with light/dark variants.

#### Spacing, Typography, Border Radius

Numeric design tokens provide consistent sizing:

- **Spacing**: `xs: 4` through `4xl: 40` (pixels)
- **Font sizes**: `xs: 12` through `3xl: 30`
- **Border radius**: `sm: 6` through `full: 9999`

### Theme Hook Usage

Components consume styling via the `useTheme()` hook:

```typescript
const { colors, isDark } = useTheme()
// colors.primary[600], colors.background, colors.text, etc.
```

### Neon Styling (Disabled)

The `mobile/src/constants/neonStyles.ts` file contains placeholder helpers (`neonCard`, `neonSoft`) that previously provided glow/border effects. These are now **no-ops returning `{}`**, indicating a deliberate decision to remove neon aesthetics except in Core Chat.

---

## Cross-Platform Consistency Strategy

| Aspect | Web | Mobile | Alignment |
|--------|-----|--------|-----------|
| Primary color | Tailwind `primary-600` (#0284c7) | `LightColors.primary[600]` (#0284c7) | ✅ Identical hex values |
| Gray scale | Tailwind default gray | Explicit `gray` token object | ✅ Semantically equivalent |
| Background | `bg-gray-50` | `colors.background` (#f9fafb) | ✅ Near-identical |
| Card surface | `bg-white` | `colors.card` (#ffffff) | ✅ Identical |
| Border | `border-gray-200` | `colors.border` (#e5e7eb) | ✅ Identical |
| Dark mode | Not implemented | Full dark theme support | ⚠️ Web lacks dark mode |

---

## Developer Conventions

### Web (React + Tailwind)

1. **Prefer utility classes** over custom CSS for layout, spacing, and typography
2. **Use component classes** (`.btn-primary`, `.card`, `.input`) for reusable UI patterns
3. **Apply animation classes** (`.animate-fade-in`, `.animate-scale-in`) for entrance effects; use `.stagger-N` for sequenced lists
4. **Avoid inline styles** unless dynamic values require them
5. **Extend Tailwind config** for new design tokens rather than hardcoding values

### Mobile (React Native)

1. **Always use `useTheme()`** to access colors — never import `Colors` directly (legacy export marked for migration)
2. **Reference design tokens** from `colors.ts` for spacing, font sizes, and border radii
3. **Support both light and dark modes** by using `colors` object properties instead of hardcoded hex values
4. **Persist theme preference** through the context's `setThemeMode()` function

### Cross-Platform

1. **Keep color hex values synchronized** between `tailwind.config.js` and `colors.ts`
2. **Match semantic intent** — if web uses `primary-600` for CTAs, mobile should use `colors.primary[600]`
3. **Document visual changes** in both platforms when updating shared design decisions