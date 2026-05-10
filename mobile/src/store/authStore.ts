import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { setCachedToken, setLogoutFn } from '../api/client'

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
