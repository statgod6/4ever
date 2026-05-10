import { create } from 'zustand'
import { subscriptionApi, Subscription } from '../api/subscription'

interface SubscriptionState {
  tier: string
  expiresAt: string | null
  active: boolean
  loaded: boolean
  loading: boolean
  load: () => Promise<void>
  set: (s: Subscription) => void
  reset: () => void
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  tier: 'free',
  expiresAt: null,
  active: false,
  loaded: false,
  loading: false,

  load: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const s = await subscriptionApi.get()
      set({
        tier: s.tier,
        expiresAt: s.expiresAt,
        active: s.active,
        loaded: true,
        loading: false,
      })
    } catch {
      set({ tier: 'free', expiresAt: null, active: false, loaded: true, loading: false })
    }
  },

  set: (s) =>
    set({ tier: s.tier, expiresAt: s.expiresAt, active: s.active, loaded: true }),

  reset: () =>
    set({ tier: 'free', expiresAt: null, active: false, loaded: false, loading: false }),
}))
