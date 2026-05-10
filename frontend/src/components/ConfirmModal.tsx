import { useEffect, useRef } from 'react'
import { AlertTriangle, Trash2, X } from 'lucide-react'
import { create } from 'zustand'

// --- Confirm Store ---
interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'default'
}

interface ConfirmState {
  isOpen: boolean
  options: ConfirmOptions | null
  resolve: ((value: boolean) => void) | null
  open: (options: ConfirmOptions) => Promise<boolean>
  close: (result: boolean) => void
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  isOpen: false,
  options: null,
  resolve: null,
  open: (options) =>
    new Promise<boolean>((resolve) => {
      set({ isOpen: true, options, resolve })
    }),
  close: (result) => {
    const { resolve } = get()
    resolve?.(result)
    set({ isOpen: false, options: null, resolve: null })
  },
}))

// Helper for easy usage
export const confirm = (options: ConfirmOptions) =>
  useConfirmStore.getState().open(options)

// --- Confirm Modal Component ---
export default function ConfirmModal() {
  const { isOpen, options, close } = useConfirmStore()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (isOpen) {
      cancelRef.current?.focus()
      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close(false)
      }
      document.addEventListener('keydown', handleEsc)
      return () => document.removeEventListener('keydown', handleEsc)
    }
  }, [isOpen, close])

  if (!isOpen || !options) return null

  const variant = options.variant || 'danger'

  const iconColors = {
    danger: 'bg-red-100 text-red-600',
    warning: 'bg-amber-100 text-amber-600',
    default: 'bg-primary-100 text-primary-600',
  }

  const buttonColors = {
    danger: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
    warning: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500',
    default: 'bg-primary-600 hover:bg-primary-700 focus:ring-primary-500',
  }

  const icons = {
    danger: <Trash2 className="w-6 h-6" />,
    warning: <AlertTriangle className="w-6 h-6" />,
    default: <AlertTriangle className="w-6 h-6" />,
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in"
        onClick={() => close(false)}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden animate-scale-in">
        {/* Close button */}
        <button
          onClick={() => close(false)}
          className="absolute top-4 right-4 p-1 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6">
          {/* Icon */}
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${iconColors[variant]}`}
          >
            {icons[variant]}
          </div>

          {/* Content */}
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {options.title}
          </h3>
          <p className="text-gray-600 text-sm leading-relaxed">
            {options.message}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100">
          <button
            ref={cancelRef}
            onClick={() => close(false)}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300 transition-colors"
          >
            {options.cancelLabel || 'Cancel'}
          </button>
          <button
            onClick={() => close(true)}
            className={`flex-1 px-4 py-2.5 text-sm font-medium text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors ${buttonColors[variant]}`}
          >
            {options.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
