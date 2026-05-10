import axios from 'axios'
import * as SecureStore from 'expo-secure-store'
import { API_URL, BASE_URL } from '../constants/config'

const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// We'll store a reference to logout function to avoid circular imports
let logoutFn: (() => void) | null = null
export function setLogoutFn(fn: () => void) {
  logoutFn = fn
}

// Token cache to avoid async SecureStore reads on every request
let cachedToken: string | null = null
export function setCachedToken(token: string | null) {
  cachedToken = token
}

apiClient.interceptors.request.use(async (config) => {
  const token = cachedToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      logoutFn?.()
    }
    return Promise.reject(error)
  }
)

export default apiClient

/**
 * Resolve a server-side avatar path (e.g. "/uploads/avatars/xyz.jpg") into a
 * fully-qualified URL the <Image> component can load.
 * - null / undefined / empty → returns null (caller should fall back to initials)
 * - already absolute (http[s]://) → returned unchanged
 * - otherwise → prepended with the API host (no /api suffix — static assets bypass it)
 */
export function resolveAvatarUrl(path: string | null | undefined): string | null {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) return path
  const prefix = path.startsWith('/') ? '' : '/'
  return `${BASE_URL}${prefix}${path}`
}
