import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Save,
  Loader2,
  User,
  MapPin,
  Briefcase,
  Target,
  Heart,
  HelpCircle,
  FileText,
  Lightbulb,
  GraduationCap,
  FolderOpen,
} from 'lucide-react'
import { userContextApi, type UserContext } from '../api/userContext'
import { toast } from '../components/Toast'

interface FieldConfig {
  key: keyof UserContext
  label: string
  placeholder: string
  icon: React.ElementType
  type: 'input' | 'textarea'
  hint: string
}

const fields: FieldConfig[] = [
  {
    key: 'name',
    label: 'Name',
    placeholder: 'e.g., Alex Chen',
    icon: User,
    type: 'input',
    hint: 'How personas should address you',
  },
  {
    key: 'age',
    label: 'Age / Life Stage',
    placeholder: 'e.g., 28 years old, early career',
    icon: User,
    type: 'input',
    hint: 'Helps personas calibrate advice to your life stage',
  },
  {
    key: 'location',
    label: 'Location',
    placeholder: 'e.g., San Francisco, CA',
    icon: MapPin,
    type: 'input',
    hint: 'Market context, timezone, cultural context',
  },
  {
    key: 'role',
    label: 'Role / Occupation',
    placeholder: 'e.g., Senior Software Engineer at a fintech startup',
    icon: Briefcase,
    type: 'input',
    hint: 'What you do day-to-day',
  },
  {
    key: 'background',
    label: 'Background',
    placeholder: 'e.g., CS degree, 5 years in backend engineering, previously worked at AWS...',
    icon: GraduationCap,
    type: 'textarea',
    hint: 'Education, experience, expertise areas',
  },
  {
    key: 'currentProjects',
    label: 'Current Projects',
    placeholder: 'e.g., Building a SaaS tool for freelancer invoicing, side project in EdTech...',
    icon: FolderOpen,
    type: 'textarea',
    hint: 'What you are actively working on right now',
  },
  {
    key: 'goals',
    label: 'Goals',
    placeholder: 'e.g., Launch MVP by Q3, grow to $10K MRR, transition to full-time founder...',
    icon: Target,
    type: 'textarea',
    hint: 'Short-term and long-term goals',
  },
  {
    key: 'situation',
    label: 'Current Situation',
    placeholder: 'e.g., Still employed full-time, $50K savings, considering quitting in 6 months...',
    icon: Lightbulb,
    type: 'textarea',
    hint: 'Financial position, constraints, timeline, life circumstances',
  },
  {
    key: 'values',
    label: 'Values & Priorities',
    placeholder: 'e.g., Work-life balance over maximizing income, prefer bootstrapping over VC...',
    icon: Heart,
    type: 'textarea',
    hint: 'What matters most to you — guides how personas frame advice',
  },
  {
    key: 'pendingDecisions',
    label: 'Pending Decisions',
    placeholder: 'e.g., Whether to quit my job, which market to target first, pricing strategy...',
    icon: HelpCircle,
    type: 'textarea',
    hint: 'Active decisions you are working through',
  },
  {
    key: 'freeformContext',
    label: 'Anything Else',
    placeholder: 'Anything else personas should know about you, your thinking style, preferences...',
    icon: FileText,
    type: 'textarea',
    hint: 'Free-form — add whatever context matters',
  },
]

export default function MyContextPage() {
  const navigate = useNavigate()
  const [context, setContext] = useState<UserContext>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    loadContext()
  }, [])

  const loadContext = async () => {
    try {
      const data = await userContextApi.get()
      setContext(data)
    } catch (err) {
      console.error('Failed to load context:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleChange = (key: keyof UserContext, value: string) => {
    setContext((prev) => ({ ...prev, [key]: value }))
    setHasChanges(true)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const saved = await userContextApi.update(context)
      setContext(saved)
      setHasChanges(false)
      toast.success('Context saved', 'Every persona will now use this as their briefing.')
    } catch (err: any) {
      toast.error('Save failed', err.response?.data?.message || 'Could not save context.')
    } finally {
      setIsSaving(false)
    }
  }

  const filledCount = fields.filter(
    (f) => context[f.key] && (context[f.key] as string).trim().length > 0
  ).length

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="w-5 h-5" />
          Back
        </button>
        <button
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className="btn-primary flex items-center gap-2 disabled:opacity-50"
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Save Context
        </button>
      </div>

      <div className="max-w-3xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">My Context</h1>
          <p className="text-gray-600 mt-1">
            This is your universal briefing — every persona reads this before responding.
            The more you fill in, the more personalized and relevant their advice becomes.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 bg-gray-200 rounded-full h-2">
              <div
                className="bg-primary-600 h-2 rounded-full transition-all"
                style={{ width: `${(filledCount / fields.length) * 100}%` }}
              />
            </div>
            <span className="text-sm text-gray-500 font-medium">
              {filledCount}/{fields.length} fields
            </span>
          </div>
        </div>

        <div className="space-y-5">
          {fields.map((field) => {
            const Icon = field.icon
            return (
              <div key={field.key} className="card p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon className="w-4 h-4 text-primary-600" />
                  <label className="text-sm font-semibold text-gray-800">
                    {field.label}
                  </label>
                </div>
                <p className="text-xs text-gray-400 mb-2">{field.hint}</p>
                {field.type === 'input' ? (
                  <input
                    type="text"
                    value={(context[field.key] as string) || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="input py-2 text-sm"
                  />
                ) : (
                  <textarea
                    value={(context[field.key] as string) || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="textarea text-sm"
                    rows={3}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Sticky save bar when changes exist */}
        {hasChanges && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-xl shadow-xl flex items-center gap-4 z-50">
            <span className="text-sm">You have unsaved changes</span>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
