import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react'
import { useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { LightColors, DarkColors, type ColorTokens } from '../constants/colors'

export type ThemeMode = 'system' | 'light' | 'dark'

interface ThemeContextValue {
  colors: ColorTokens
  isDark: boolean
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  colors: LightColors,
  isDark: false,
  themeMode: 'system',
  setThemeMode: () => {},
})

const THEME_STORAGE_KEY = 'theme-mode'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme()
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setThemeModeState(stored)
      }
      setLoaded(true)
    })
  }, [])

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode)
    AsyncStorage.setItem(THEME_STORAGE_KEY, mode).catch(() => {})
  }, [])

  const isDark = useMemo(() => {
    if (themeMode === 'system') return systemScheme === 'dark'
    return themeMode === 'dark'
  }, [themeMode, systemScheme])

  const colors = useMemo(() => (isDark ? DarkColors : LightColors), [isDark])

  const value = useMemo(() => ({ colors, isDark, themeMode, setThemeMode }), [colors, isDark, themeMode, setThemeMode])

  // Don't render until we've loaded the stored preference
  if (!loaded) return null

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}
