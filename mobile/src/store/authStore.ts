import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { setCachedToken, setLogoutFn } from '../api/client'

// ── DEV BYPASS ──────────────────────────────────────────────────────
// Set to true to skip authentication during development.
// Remember to set back to false before shipping!
const DEV_AUTH_BYPASS = __DEV__ && true
const DEV_USER: User = {
  id: 'f2ebbf1e-7e07-4448-b21d-0b926f7674cd',
  phoneNumber: '+0studentteachaicom',
  name: 'Abhinav',
}
const DEV_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmMmViYmYxZS03ZTA3LTQ0NDgtYjIxZC0wYjkyNmY3Njc0Y2QiLCJwaG9uZSI6Iiswc3R1ZGVudHRlYWNoYWljb20iLCJpYXQiOjE3ODI5NjgwMzgsImV4cCI6MTc4NTU2MDAzOH0.dH9jMdljV_WsdDwNzhhZFjnZBEFNBlIW0CnK_IWQ_2Q'
// ────────────────────────────────────────────────────────────────────

interface User {
  id: string
  phoneNumber: string
  name: string
  avatarUrl?: string | null
}

interface AuthState {
  token: string | null
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  setAuth: (token: string, user: User) => void
  updateUser: (partial: Partial<User>) => void
  logout: () => void
  setLoading: (loading: boolean) => void
  hydrate: () => Promise<void>
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,

  setAuth: async (token: string, user: User) => {
    await SecureStore.setItemAsync('auth-token', token)
    await AsyncStorage.setItem('auth-user', JSON.stringify(user))
    setCachedToken(token)
    set({ token, user, isAuthenticated: true })
  },

  updateUser: async (partial: Partial<User>) => {
    const current = get().user
    if (!current) return
    const updated = { ...current, ...partial }
    await AsyncStorage.setItem('auth-user', JSON.stringify(updated))
    set({ user: updated })
  },

  logout: async () => {
    await SecureStore.deleteItemAsync('auth-token')
    await AsyncStorage.removeItem('auth-user')
    setCachedToken(null)
    set({ token: null, user: null, isAuthenticated: false })
  },

  setLoading: (loading: boolean) => set({ isLoading: loading }),

  hydrate: async () => {
    // Dev bypass: auto-login with dev user when flag is set
    if (DEV_AUTH_BYPASS) {
      setCachedToken(DEV_TOKEN)
      set({ token: DEV_TOKEN, user: DEV_USER, isAuthenticated: true, isLoading: false })
      return
    }
    try {
      const token = await SecureStore.getItemAsync('auth-token')
      const userStr = await AsyncStorage.getItem('auth-user')
      if (token && userStr) {
        const user = JSON.parse(userStr)
        setCachedToken(token)
        set({ token, user, isAuthenticated: true, isLoading: false })
      } else {
        set({ isLoading: false })
      }
    } catch {
      set({ isLoading: false })
    }
  },
}))

// Register logout function with API client to handle 401s
setLogoutFn(() => useAuthStore.getState().logout())
