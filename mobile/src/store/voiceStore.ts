import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'

const VOICE_STORAGE_KEY = '4ever.coreVoice'

export type CoreVoiceId =
  | 'nova'
  | 'shimmer'
  | 'coral'
  | 'sage'
  | 'alloy'
  | 'echo'
  | 'onyx'
  | 'ash'
  | 'ballad'
  | 'fable'
  | 'verse'

export interface CoreVoiceOption {
  id: CoreVoiceId
  label: string
  gender: 'feminine' | 'masculine' | 'neutral'
  description: string
}

export const CORE_VOICE_OPTIONS: CoreVoiceOption[] = [
  { id: 'nova',    label: 'Nova',    gender: 'feminine',  description: 'Clear & energetic' },
  { id: 'shimmer', label: 'Shimmer', gender: 'feminine',  description: 'Soft & breathy' },
  { id: 'coral',   label: 'Coral',   gender: 'feminine',  description: 'Warm & friendly' },
  { id: 'sage',    label: 'Sage',    gender: 'feminine',  description: 'Calm & thoughtful' },
  { id: 'fable',   label: 'Fable',   gender: 'neutral',   description: 'Storyteller' },
  { id: 'alloy',   label: 'Alloy',   gender: 'masculine', description: 'Neutral balanced' },
  { id: 'echo',    label: 'Echo',    gender: 'masculine', description: 'Smooth masc' },
  { id: 'onyx',    label: 'Onyx',    gender: 'masculine', description: 'Deep & resonant' },
  { id: 'ash',     label: 'Ash',     gender: 'masculine', description: 'Crisp masc' },
  { id: 'ballad',  label: 'Ballad',  gender: 'masculine', description: 'Melodic masc' },
  { id: 'verse',   label: 'Verse',   gender: 'neutral',   description: 'Expressive' },
]

interface VoiceState {
  voice: CoreVoiceId
  loaded: boolean
  load: () => Promise<void>
  setVoice: (v: CoreVoiceId) => Promise<void>
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  voice: 'nova',
  loaded: false,

  load: async () => {
    if (get().loaded) return
    try {
      const stored = await AsyncStorage.getItem(VOICE_STORAGE_KEY)
      if (stored && CORE_VOICE_OPTIONS.some((o) => o.id === stored)) {
        set({ voice: stored as CoreVoiceId, loaded: true })
        return
      }
    } catch {}
    set({ loaded: true })
  },

  setVoice: async (v) => {
    set({ voice: v, loaded: true })
    try {
      await AsyncStorage.setItem(VOICE_STORAGE_KEY, v)
    } catch {}
  },
}))
