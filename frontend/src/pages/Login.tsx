import { useState, useRef, useEffect } from 'react'
import { Brain, Loader2, Phone, Shield, User } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { authApi } from '../api/auth'

type Step = 'phone' | 'otp' | 'name'

export default function Login() {
  const [step, setStep] = useState<Step>('phone')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [name, setName] = useState('')
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { setAuth } = useAuthStore()

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const startCountdown = () => {
    setCountdown(60)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!phoneNumber.trim()) return
    setIsLoading(true)
    setError('')

    try {
      await authApi.requestOtp({ phoneNumber: phoneNumber.trim() })
      setStep('otp')
      startCountdown()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to send OTP')
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (otpCode.length !== 6) return
    setIsLoading(true)
    setError('')

    try {
      const response = await authApi.verifyOtp({
        phoneNumber: phoneNumber.trim(),
        code: otpCode,
      })

      if (response.isNewUser) {
        // Store token temporarily, show name step
        localStorage.setItem('temp-token', response.access_token)
        localStorage.setItem('temp-user', JSON.stringify(response.user))
        setStep('name')
      } else {
        setAuth(response.access_token, response.user)
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Invalid OTP')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSetName = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setIsLoading(true)
    setError('')

    try {
      const token = localStorage.getItem('temp-token')!
      const tempUser = JSON.parse(localStorage.getItem('temp-user')!)
      // Set the token so the API client can use it
      setAuth(token, tempUser)
      const updatedUser = await authApi.setName({ name: name.trim() })
      setAuth(token, updatedUser)
      localStorage.removeItem('temp-token')
      localStorage.removeItem('temp-user')
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to set name')
    } finally {
      setIsLoading(false)
    }
  }

  const handleResendOtp = async () => {
    if (countdown > 0) return
    setIsLoading(true)
    setError('')
    try {
      await authApi.requestOtp({ phoneNumber: phoneNumber.trim() })
      startCountdown()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to resend OTP')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-2xl mb-4">
            <Brain className="w-8 h-8 text-primary-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">4Ever</h1>
          <p className="text-gray-600 mt-2">
            Your AI-Powered Life OS
          </p>
        </div>

        <div className="card">
          {/* Step indicators */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className={`w-2 h-2 rounded-full ${step === 'phone' ? 'bg-primary-500 w-6' : 'bg-gray-300'} transition-all`} />
            <div className={`w-2 h-2 rounded-full ${step === 'otp' ? 'bg-primary-500 w-6' : 'bg-gray-300'} transition-all`} />
            <div className={`w-2 h-2 rounded-full ${step === 'name' ? 'bg-primary-500 w-6' : 'bg-gray-300'} transition-all`} />
          </div>

          <h2 className="text-xl font-semibold text-gray-900 mb-1 text-center">
            {step === 'phone' && 'Enter your phone number'}
            {step === 'otp' && 'Verify your number'}
            {step === 'name' && 'What should we call you?'}
          </h2>
          <p className="text-gray-500 text-sm text-center mb-6">
            {step === 'phone' && 'We\'ll send you a verification code'}
            {step === 'otp' && `Code sent to ${phoneNumber}`}
            {step === 'name' && 'This is how you\'ll appear to your connections'}
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          {/* Phone Step */}
          {step === 'phone' && (
            <form onSubmit={handleRequestOtp} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone Number
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="input pl-10"
                    placeholder="+919876543210"
                    required
                    autoFocus
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">Include country code (e.g., +91 for India, +1 for US)</p>
              </div>

              <button
                type="submit"
                disabled={isLoading || !phoneNumber.trim()}
                className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send Verification Code'}
              </button>
            </form>
          )}

          {/* OTP Step */}
          {step === 'otp' && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Verification Code
                </label>
                <div className="relative">
                  <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="input pl-10 text-center text-2xl tracking-[0.5em] font-mono"
                    placeholder="------"
                    required
                    autoFocus
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading || otpCode.length !== 6}
                className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify'}
              </button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={countdown > 0 || isLoading}
                  className="text-primary-600 hover:text-primary-700 text-sm font-medium disabled:text-gray-400"
                >
                  {countdown > 0 ? `Resend code in ${countdown}s` : 'Resend code'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => { setStep('phone'); setOtpCode(''); setError('') }}
                className="w-full text-gray-500 text-sm hover:text-gray-700"
              >
                Change phone number
              </button>
            </form>
          )}

          {/* Name Step */}
          {step === 'name' && (
            <form onSubmit={handleSetName} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Your Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="input pl-10"
                    placeholder="Enter your name"
                    required
                    autoFocus
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading || !name.trim()}
                className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Continue'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
