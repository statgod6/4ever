import { io, Socket } from 'socket.io-client'
import { useAuthStore } from '../store/authStore'

let socket: Socket | null = null

export function getSocket(): Socket | null {
  return socket
}

export function connectSocket() {
  if (socket?.connected) return socket

  const token = useAuthStore.getState().token
  if (!token) return null

  socket = io('/ws', {
    auth: { token },
    transports: ['websocket', 'polling'],
  })

  socket.on('connect', () => {
    console.log('[WS] Connected')
  })

  socket.on('disconnect', () => {
    console.log('[WS] Disconnected')
  })

  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
