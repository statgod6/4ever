## Overview

The 4Ever AI Life OS Platform implements a **dual-platform styling architecture** that maintains visual consistency across web (React + Vite) and mobile (React Native + Expo) clients through shared design tokens and platform-appropriate styling methodologies.

---

## Web Frontend: Tailwind CSS Utility-First Approach

### Technology Stack
- **Tailwind CSS v3** for utility-first styling
- **PostCSS** with `autoprefixer` plugin
- **Custom component classes** defined via `@layer components`
- **No CSS-in-JS libraries** — pure Tailwind utilities and custom CSS

### Design Tokens (`frontend/tailwind.config.js`)
A single primary color palette based on **sky blue** (`#0ea5e9` at 500):
```js
colors: {
  primary: {
    50: '#f0f9ff',  // lightest
    500: '#0ea5e9', // base
    900: '#0c4a6e', // darkest
  }
}
```

### Component Class System (`frontend/src/index.css`)
Reusable semantic classes abstract common UI patterns:
- `.btn-primary` / `.btn-secondary` — button variants with hover transitions
- `.card` — white background, rounded corners, subtle shadow and border
- `.input` / `.textarea` — form controls with focus ring on primary color

### Animation System
Six custom keyframe animations for micro-interactions:
- `fade-in`, `scale-in`, `slide-up` — entry animations with cubic-bezier easing
- `shimmer` — loading skeleton effect (2s infinite linear)
- `float` — gentle vertical oscillation (3s ease-in-out)
- `pulse-soft` — opacity pulsing for attention cues

Stagger delays (`.stagger-1` through `.stagger-5`) enable sequenced list animations.

### Visual Effects
- `.glass` — backdrop blur (12px) for frosted glass overlays
- `.gradient-text` — purple-to-indigo gradient text clip

### Layout Pattern
The `Layout.tsx` component demonstrates consistent use of:
- Flexbox-based responsive layout (`flex`, `flex-col`, `flex-1`)
- Fixed sidebar with collapsible state (68px collapsed, 256px expanded)
- Mobile overlay pattern with `bg-black/50` backdrop
- Consistent spacing via Tailwind's default scale (`p-4`, `gap-2`, etc.)

---

## Mobile Client: React Native Theme Context + Design Tokens

### Technology Stack
- **React Native StyleSheet** for component-scoped styles
- **Custom ThemeContext** with system/light/dark mode support
- **AsyncStorage persistence** for user theme preference
- **expo-linear-gradient** for gradient backgrounds
- **No third-party UI library** — hand-crafted components

### Shared Color Palette (`mobile/src/constants/colors.ts`)
The mobile app mirrors the web app's sky blue primary palette exactly, ensuring cross-platform brand consistency:
```ts
primary: {
  50: '#f0f9ff',
  500: '#0ea5e9',
  900: '#0c4a6e',
}
```

Additional semantic color groups:
- `gray` — 9-step neutral scale for text hierarchy
- `green`, `red`, `amber`, `purple` — status/semantic colors with light/dark variants

### Dark Mode Implementation
Full dark mode support via `ThemeContext`:
- Reads system preference via `useColorScheme()`
- Persists user override (`'system' | 'light' | 'dark'`) in AsyncStorage
- Provides `colors` token object and `isDark` boolean to all consumers
- Dark palette inverts grays while preserving primary hue saturation

### Design Token Exports
Beyond colors, the constants module exports:
- `Spacing` — 7-step scale (4px to 40px): `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `3xl`, `4xl`
- `FontSize` — 7-step typography scale (12px to 30px)
- `BorderRadius` — 5-step radius scale (6px to 9999px for full circles)

### Style Creation Pattern
Components use a **factory function pattern** to inject theme-aware colors:
```tsx
const { colors, isDark } = useTheme()
const styles = createStyles(colors, isDark)
// ...
const createStyles = (colors: ColorTokens, isDark: boolean) => StyleSheet.create({
  container: { backgroundColor: colors.background },
})
```

This enables dynamic theming without re-render overhead since `StyleSheet.create` is memoized per theme state.

### Neon Styles (Disabled)
The `neonStyles.ts` module previously provided glow/border effects for a "neon" aesthetic but is now **globally disabled** (returns empty style objects). The neon treatment survives only in `CoreChatScreen` where it's applied directly. This indicates a deliberate design decision to revert to a cleaner, classic UI outside the core chat experience.

---

## Cross-Platform Conventions

### Shared API Layer Structure
Both platforms mirror each other's API client structure (`frontend/src/api/` and `mobile/src/api/`), suggesting coordinated feature development.

### State Management Parity
Both platforms use **Zustand** stores with identical naming:
- `authStore`, `messagingStore`, `personaStore`, `subscriptionStore`, `thoughtStore`
- Mobile adds `voiceStore` for voice-specific features

### Responsive Strategy
- **Web**: Tailwind's responsive prefixes (`lg:`, `md:`) with mobile-first breakpoints
- **Mobile**: Platform-specific adaptations via `react-native-safe-area-context` and `useSafeAreaInsets`

### Component Architecture
- **Web**: Reusable components in `components/` directory (Layout, Toast, ConfirmModal, Markdown, ErrorBoundary)
- **Mobile**: Similar component set plus mobile-specific patterns (`LifeWheel`, `PersonaPickerSheet`, `UserAvatar`, `LoadingState`)

---

## Rules Developers Should Follow

1. **Use semantic component classes on web** — prefer `.btn-primary`, `.card`, `.input` over raw utility combinations for consistency
2. **Always consume colors via theme context on mobile** — never hardcode hex values; use `useTheme().colors.primary[500]`
3. **Maintain color parity** — any new color token added to `tailwind.config.js` should have a corresponding entry in `mobile/src/constants/colors.ts`
4. **Use design token scales** — spacing, font sizes, and border radii should come from the exported constants, not arbitrary pixel values
5. **Respect the animation naming convention** — new animations should follow the `animate-{name}` class pattern with matching `@keyframes` definition
6. **Dark mode must be opt-in compatible** — ensure new screens work in both light and dark modes by using `colors.background`, `colors.text`, etc. instead of hardcoded whites/blacks
7. **Avoid inline styles on web** — use Tailwind utilities or `@layer components` classes; inline styles break the utility-first convention
8. **Neon effects are deprecated** — do not reintroduce `neonCard` or `neonSoft` helpers unless explicitly scoped to Core Chat