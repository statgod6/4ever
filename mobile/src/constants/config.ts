import { Platform } from 'react-native'

// Auto-detect API URL based on platform
// - Android emulator: 10.0.2.2 maps to host machine localhost
// - iOS simulator: localhost works
// - Physical device: use your PC's local IP (update DEV_MACHINE_IP)
// Your PC's local network IP — used for physical devices via Expo Go
const DEV_MACHINE_IP = '192.168.31.212'

// For physical devices, localhost won't work — we always use the LAN IP.
// Constants.expoGoConfig exists only inside Expo Go on a real device.
import Constants from 'expo-constants'
const isExpoGo = !!Constants.expoGoConfig

function getHost(): string {
  if (__DEV__) {
    if (isExpoGo) {
      // Physical device via Expo Go — must use LAN IP
      return DEV_MACHINE_IP
    }
    if (Platform.OS === 'android') {
      return '10.0.2.2' // Android emulator maps to host
    }
    return 'localhost' // iOS simulator
  }
  return 'api.4ever.app'
}

function getApiUrl(): string {
  const host = getHost()
  const scheme = __DEV__ ? 'http' : 'https'
  return `${scheme}://${host}:3001/api`
}

function getWsUrl(): string {
  const host = getHost()
  const scheme = __DEV__ ? 'http' : 'https'
  return `${scheme}://${host}:3001/ws`
}

function getBaseUrl(): string {
  const host = getHost()
  const scheme = __DEV__ ? 'http' : 'https'
  return `${scheme}://${host}:3001`
}

export const API_URL = getApiUrl()
export const WS_URL = getWsUrl()
export const BASE_URL = getBaseUrl()
