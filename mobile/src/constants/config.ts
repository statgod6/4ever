import { Platform } from 'react-native'
import Constants from 'expo-constants'

/**
 * API URL resolution — order of precedence (highest wins):
 *
 *   1.  `EXPO_PUBLIC_API_URL` env var  (preferred — baked into the bundle by
 *       `eas build`, `expo export`, or `.env` at dev-server start). This is
 *       how production/staging builds talk to `https://api.4ever.app/api`.
 *
 *   2.  Dev auto-detect — only used when no env var is provided AND we're in
 *       a development build (`__DEV__ === true`). We pick the right host for
 *       the current runtime so the same checkout works on:
 *         • Expo Go on a physical device  → LAN IP  (DEV_MACHINE_IP)
 *         • Android emulator              → 10.0.2.2 (maps to host loopback)
 *         • iOS simulator                 → localhost
 *
 *   3.  Production build without env var → we fail loud instead of silently
 *       pointing at a stale hardcoded host. Shipping a store build with the
 *       wrong API origin is unrecoverable once users install it.
 *
 * Expo only exposes env vars that begin with `EXPO_PUBLIC_` to client code;
 * this variable is therefore safe to reference here and is embedded in the
 * JS bundle at build time (NOT fetched at runtime).
 */

// LAN IP used ONLY when EXPO_PUBLIC_API_URL is unset and we're running Expo Go
// on a physical device against a local backend. Engineers change this (or, far
// better, set EXPO_PUBLIC_API_URL in `.env`) to point at their own laptop.
const DEV_MACHINE_IP = '192.168.31.212'
const DEV_PORT = 3001

const isExpoGo = !!Constants.expoGoConfig

/** Root URL including `/api` prefix. Every HTTP call must use this. */
function resolveApiUrl(): string {
  const fromEnv = (process.env.EXPO_PUBLIC_API_URL || '').trim()
  if (fromEnv) {
    // Normalize: strip trailing slash so callers can safely concat `/foo`
    return fromEnv.replace(/\/+$/, '')
  }

  if (!__DEV__) {
    // Production build without a configured API URL is a bug — refuse to run.
    // Surfacing this as a thrown error triggers the Expo red-box so QA catches
    // it before the build reaches TestFlight / Play Internal.
    throw new Error(
      '[config] EXPO_PUBLIC_API_URL is not set. Production builds must set this ' +
        'at build time (e.g. via eas.json env or a .env file). Refusing to default ' +
        'to a hardcoded host.',
    )
  }

  // Dev-only auto-detect
  let host: string
  if (isExpoGo) {
    host = DEV_MACHINE_IP
  } else if (Platform.OS === 'android') {
    host = '10.0.2.2'
  } else {
    host = 'localhost'
  }
  return `http://${host}:${DEV_PORT}/api`
}

/**
 * Derive the scheme+host origin from API_URL so WS / BASE never drift.
 * Example: `https://api.4ever.app/api` → `https://api.4ever.app`
 */
function deriveOrigin(apiUrl: string): string {
  try {
    const u = new URL(apiUrl)
    return `${u.protocol}//${u.host}`
  } catch {
    // Legacy fallback — shouldn't happen, but don't crash the bundle.
    return apiUrl.replace(/\/api\/?$/, '')
  }
}

export const API_URL = resolveApiUrl()
export const BASE_URL = deriveOrigin(API_URL)
// WS endpoint lives on the same origin; scheme follows API scheme
// (ws for http, wss for https). We keep it explicit for clarity.
export const WS_URL = `${BASE_URL.replace(/^http/, 'ws')}/ws`
