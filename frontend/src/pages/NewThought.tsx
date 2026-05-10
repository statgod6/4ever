import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Sparkles, Zap, Plus } from 'lucide-react'
import { thoughtsApi } from '../api/thoughts'
import { personasApi } from '../api/personas'
import { orchestrationApi } from '../api/orchestration'
import { useThoughtStore } from '../store/thoughtStore'
import { toast } from '../components/Toast'
import type { Persona } from '../store/personaStore'

const thoughtTypes = [
  { value: 'business idea', label: 'Business Idea' },
  { value: 'personal decision', label: 'Personal Decision' },
  { value: 'career concern', label: 'Career Concern' },
  { value: 'emotional situation', label: 'Emotional Situation' },
  { value: 'relationship issue', label: 'Relationship Issue' },
  { value: 'research thought', label: 'Research Thought' },
  { value: 'content idea', label: 'Content Idea' },
  { value: 'ethical dilemma', label: 'Ethical Dilemma' },
  { value: 'startup plan', label: 'Startup Plan' },
  { value: 'life choice', label: 'Life Choice' },
  { value: 'general reflection', label: 'General Reflection' },
]

// Persona recommendations by thought type keyword matching
const personaRecommendations: Record<string, string[]> = {
  'business idea': ['entrepreneur', 'business', 'strategic', 'investor', 'market'],
  'personal decision': ['mentor', 'wise', 'friend', 'practical', 'counselor'],
  'career concern': ['mentor', 'career', 'strategic', 'practical', 'coach'],
  'emotional situation': ['friend', 'empathetic', 'counselor', 'mentor', 'wise'],
  'relationship issue': ['friend', 'counselor', 'wise', 'empathetic', 'mentor'],
  'research thought': ['analyst', 'scientist', 'critic', 'academic', 'devil'],
  'content idea': ['creative', 'entrepreneur', 'audience', 'marketing', 'writer'],
  'ethical dilemma': ['philosopher', 'devil', 'wise', 'mentor', 'ethicist'],
  'startup plan': ['entrepreneur', 'investor', 'devil', 'business', 'strategic'],
  'life choice': ['mentor', 'wise', 'practical', 'friend', 'counselor'],
  'general reflection': ['mentor', 'wise', 'friend', 'philosopher'],
}

function isPersonaRecommended(persona: Persona, thoughtType: string): boolean {
  const keywords = personaRecommendations[thoughtType] || []
  const nameAndDesc = `${persona.name} ${persona.description || ''} ${persona.systemPrompt}`.toLowerCase()
  return keywords.some((kw) => nameAndDesc.includes(kw))
}

export default function NewThought() {
  const navigate = useNavigate()
  const { addThought } = useThoughtStore()
  const [isLoading, setIsLoading] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [personas, setPersonas] = useState<Persona[]>([])
  const [selectedPersonas, setSelectedPersonas] = useState<string[]>([])
  const [formData, setFormData] = useState({
    title: '',
    rawText: '',
    thoughtType: 'general reflection',
  })

  // Inline persona creation state
  const [showInlineCreate, setShowInlineCreate] = useState(false)
  const [inlinePersona, setInlinePersona] = useState({ name: '', description: '', systemPrompt: '' })
  const [isCreatingPersona, setIsCreatingPersona] = useState(false)

  useEffect(() => {
    loadPersonas()
  }, [])

  const loadPersonas = async () => {
    try {
      const data = await personasApi.getActive()
      setPersonas(data)
    } catch (err) {
      console.error('Failed to load personas:', err)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const thought = await thoughtsApi.create(formData)
      addThought(thought)

      // If personas selected, analyze immediately
      if (selectedPersonas.length > 0) {
        setIsAnalyzing(true)
        await orchestrationApi.analyzeThought(thought.id, selectedPersonas)
        toast.success('Thought analyzed', `${selectedPersonas.length} persona(s) have responded.`)
      } else {
        toast.success('Thought saved', 'Your thought has been recorded.')
      }

      navigate(`/thought/${thought.id}`)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create thought')
      setIsLoading(false)
      setIsAnalyzing(false)
    }
  }

  const togglePersona = (personaId: string) => {
    setSelectedPersonas((prev) =>
      prev.includes(personaId)
        ? prev.filter((id) => id !== personaId)
        : [...prev, personaId]
    )
  }

  const handleInlineCreate = async () => {
    if (!inlinePersona.name.trim() || !inlinePersona.systemPrompt.trim()) return
    setIsCreatingPersona(true)
    try {
      const created = await personasApi.create({
        name: inlinePersona.name,
        description: inlinePersona.description,
        systemPrompt: inlinePersona.systemPrompt,
        modelName: 'deepseek/deepseek-v3.2',
      })
      setPersonas((prev) => [...prev, created])
      setSelectedPersonas((prev) => [...prev, created.id])
      setInlinePersona({ name: '', description: '', systemPrompt: '' })
      setShowInlineCreate(false)
      toast.success('Persona created & selected', `${created.name} is ready.`)
    } catch (err: any) {
      toast.error('Create failed', err.response?.data?.message || 'Could not create persona.')
    } finally {
      setIsCreatingPersona(false)
    }
  }

  return (
    <div>
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="w-5 h-5" />
        Back
      </button>

      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          New Thought
        </h1>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              className="input"
              placeholder="Give your thought a title"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Type
            </label>
            <select
              value={formData.thoughtType}
              onChange={(e) =>
                setFormData({ ...formData, thoughtType: e.target.value })
              }
              className="input"
            >
              {thoughtTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Your Thought
            </label>
            <textarea
              value={formData.rawText}
              onChange={(e) =>
                setFormData({ ...formData, rawText: e.target.value })
              }
              className="textarea"
              rows={8}
              placeholder="Write your thought, idea, concern, or plan here..."
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">
                Select Personas to Analyze (optional)
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowInlineCreate(!showInlineCreate)}
                  className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 px-2 py-1 rounded hover:bg-primary-50 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {showInlineCreate ? 'Cancel' : 'Create New'}
                </button>
              </div>
            </div>

            {/* Inline Persona Create Form */}
            {showInlineCreate && (
              <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-3">
                <h4 className="text-sm font-semibold text-gray-800">Quick Create Persona</h4>
                <input
                  type="text"
                  value={inlinePersona.name}
                  onChange={(e) => setInlinePersona({ ...inlinePersona, name: e.target.value })}
                  placeholder="Persona name (e.g. Marketing Guru)"
                  className="input py-1.5 text-sm"
                />
                <input
                  type="text"
                  value={inlinePersona.description}
                  onChange={(e) => setInlinePersona({ ...inlinePersona, description: e.target.value })}
                  placeholder="Short description"
                  className="input py-1.5 text-sm"
                />
                <textarea
                  value={inlinePersona.systemPrompt}
                  onChange={(e) => setInlinePersona({ ...inlinePersona, systemPrompt: e.target.value })}
                  placeholder="System prompt — define how this persona thinks and responds..."
                  className="textarea text-sm"
                  rows={3}
                />
                <button
                  type="button"
                  onClick={handleInlineCreate}
                  disabled={!inlinePersona.name.trim() || !inlinePersona.systemPrompt.trim() || isCreatingPersona}
                  className="btn-primary text-sm py-1.5 flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isCreatingPersona ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Create & Select
                </button>
              </div>
            )}

            {personas.length === 0 ? (
              <p className="text-gray-500 text-sm">
                No active personas.{' '}
                <button
                  type="button"
                  onClick={() => navigate('/personas')}
                  className="text-primary-600 hover:underline"
                >
                  Create personas first
                </button>
              </p>
            ) : (
              <>
                {personas.some((p) => isPersonaRecommended(p, formData.thoughtType)) && (
                  <div className="mb-3 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <Zap className="w-4 h-4 flex-shrink-0" />
                    <span>Recommended personas for <strong>{thoughtTypes.find(t => t.value === formData.thoughtType)?.label}</strong> are highlighted</span>
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {personas.map((persona) => {
                    const isRecommended = isPersonaRecommended(persona, formData.thoughtType)
                    return (
                      <button
                        key={persona.id}
                        type="button"
                        onClick={() => togglePersona(persona.id)}
                        className={`p-3 rounded-lg border-2 text-left transition-all relative ${
                          selectedPersonas.includes(persona.id)
                            ? 'border-primary-500 bg-primary-50'
                            : isRecommended
                            ? 'border-amber-300 bg-amber-50/50 hover:border-amber-400'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {isRecommended && !selectedPersonas.includes(persona.id) && (
                          <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-amber-400 rounded-full flex items-center justify-center">
                            <Zap className="w-3 h-3 text-white" />
                          </span>
                        )}
                        <div className="font-medium text-gray-900">
                          {persona.name}
                        </div>
                        {persona.description && (
                          <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                            {persona.description}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-4 pt-4">
            <button
              type="submit"
              disabled={isLoading || isAnalyzing}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Analyzing...
                </>
              ) : isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  {selectedPersonas.length > 0
                    ? `Analyze with ${selectedPersonas.length} persona${
                        selectedPersonas.length === 1 ? '' : 's'
                      }`
                    : 'Save Thought'}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
