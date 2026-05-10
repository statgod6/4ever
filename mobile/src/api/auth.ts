import apiClient from './client'

export interface User {
  id: string
  phoneNumber: string
  name: string
  avatarUrl?: string | null
  createdAt?: string
}

export interface RequestOtpData {
  phoneNumber: string
}

export interface VerifyOtpData {
  phoneNumber: string
  code: string
}

export interface SetNameData {
  name: string
}

export const authApi = {
  requestOtp: async (data: RequestOtpData) => {
    const response = await apiClient.post('/auth/request-otp', data)
    return response.data
  },

  verifyOtp: async (data: VerifyOtpData) => {
    const response = await apiClient.post('/auth/verify-otp', data)
    return response.data
  },

  setName: async (data: SetNameData) => {
    const response = await apiClient.post('/auth/set-name', data)
    return response.data
  },

  getMe: async (): Promise<User> => {
    const response = await apiClient.get('/users/me')
    return response.data
  },

  updateProfile: async (data: { name: string }): Promise<User> => {
    const response = await apiClient.patch('/users/profile', data)
    return response.data
  },

  /**
   * Upload a profile picture. Accepts a local file URI (e.g. from expo-image-picker).
   */
  uploadAvatar: async (localUri: string): Promise<User> => {
    const formData = new FormData()
    // Derive file extension → mime type
    const match = /\.(\w+)(?:\?.*)?$/.exec(localUri)
    const ext = (match?.[1] || 'jpg').toLowerCase()
    const mime =
      ext === 'png' ? 'image/png' :
      ext === 'webp' ? 'image/webp' :
      'image/jpeg'
    // React Native FormData accepts { uri, name, type }
    formData.append('avatar', {
      uri: localUri,
      name: `avatar.${ext}`,
      type: mime,
    } as any)
    const response = await apiClient.post('/users/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      transformRequest: (data) => data, // prevent axios from JSON-ifying FormData
    })
    return response.data
  },

  deleteAvatar: async (): Promise<User> => {
    const response = await apiClient.delete('/users/avatar')
    return response.data
  },
}
