import { io, Socket } from 'socket.io-client'
import { WS_URL } from '../constants/config'

let socket: Socket | null = null

export function getSocket(): Socket | null {
  return socket
}

export function connectSocket(token: string) {
  if (socket?.connected) return socket

  if (!token) return null

  socket = io(WS_URL, {
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
