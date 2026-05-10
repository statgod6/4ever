import apiClient from './client'

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

  getMe: async () => {
    const response = await apiClient.get('/users/me')
    return response.data
  },
}
