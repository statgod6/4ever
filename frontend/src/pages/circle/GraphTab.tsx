import { Network } from 'lucide-react'
import { RelationshipPerson } from '../../api/relationships'

const LOVE_LANGUAGES = [
  { value: 'words_of_affirmation', label: 'Words of Affirmation', emoji: '💬' },
  { value: 'acts_of_service', label: 'Acts of Service', emoji: '🧰' },
  { value: 'receiving_gifts', label: 'Receiving Gifts', emoji: '🎁' },
  { value: 'quality_time', label: 'Quality Time', emoji: '⌛' },
  { value: 'physical_touch', label: 'Physical Touch', emoji: '🤗' },
]

interface Props {
  people: RelationshipPerson[]
  onPersonClick: (id: string) => void
}

export default function GraphTab({ people, onPersonClick }: Props) {
  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Network className="w-5 h-5 text-indigo-500" /> Relationship Network
      </h2>
      {people.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-100 to-blue-100 flex items-center justify-center mx-auto mb-5">
            <Network className="w-8 h-8 text-indigo-400" />
          </div>
          <p className="text-gray-500">Add people to your circle to see the network graph.</p>
        </div>
      ) : (
        <div className="flex justify-center">
          <svg viewBox="0 0 600 600" className="w-full max-w-lg" style={{ maxHeight: '500px' }}>
            {/* Connection lines */}
            {people.map((person, i) => {
              const angle = (2 * Math.PI * i) / people.length - Math.PI / 2
              const radius = 200
              const x = 300 + radius * Math.cos(angle)
              const y = 300 + radius * Math.sin(angle)
              return (
                <line
                  key={`line-${person.id}`}
                  x1={300} y1={300} x2={x} y2={y}
                  stroke="#e5e7eb" strokeWidth={2}
                  strokeDasharray={person.lastInteractionAt ? 'none' : '6,4'}
                />
              )
            })}
            {/* People nodes */}
            {people.map((person, i) => {
              const angle = (2 * Math.PI * i) / people.length - Math.PI / 2
              const radius = 200
              const x = 300 + radius * Math.cos(angle)
              const y = 300 + radius * Math.sin(angle)
              const daysSince = person.lastInteractionAt
                ? Math.floor((Date.now() - new Date(person.lastInteractionAt).getTime()) / 86400000)
                : 999
              const healthColor = daysSince <= 3 ? '#10b981' : daysSince <= 7 ? '#34d399' : daysSince <= 14 ? '#fbbf24' : daysSince <= 30 ? '#f97316' : '#ef4444'
              const nodeRadius = Math.min(35, 20 + person.interactionCount * 1.5)
              const relColor = ['Parent', 'Sibling', 'Partner', 'Spouse', 'Child'].includes(person.relationship)
                ? '#f43f5e' : ['Friend', 'Close Friend'].includes(person.relationship)
                ? '#8b5cf6' : ['Colleague', 'Boss'].includes(person.relationship)
                ? '#3b82f6' : '#6b7280'
              return (
                <g key={`node-${person.id}`} className="cursor-pointer" onClick={() => onPersonClick(person.id)}>
                  <circle cx={x} cy={y} r={nodeRadius} fill={healthColor} opacity={0.15} />
                  <circle cx={x} cy={y} r={nodeRadius - 4} fill="white" stroke={healthColor} strokeWidth={3} />
                  <text x={x} y={y - nodeRadius - 8} textAnchor="middle" className="text-xs font-semibold" fill="#374151" style={{ fontSize: '12px' }}>
                    {person.name.length > 10 ? person.name.substring(0, 9) + '…' : person.name}
                  </text>
                  <text x={x} y={y + 4} textAnchor="middle" style={{ fontSize: '10px', fill: relColor, fontWeight: 600 }}>
                    {person.relationship.length > 8 ? person.relationship.substring(0, 7) + '…' : person.relationship}
                  </text>
                  {person.loveLanguage && (
                    <text x={x} y={y + 16} textAnchor="middle" style={{ fontSize: '12px' }}>
                      {LOVE_LANGUAGES.find((l) => l.value === person.loveLanguage)?.emoji}
                    </text>
                  )}
                </g>
              )
            })}
            {/* Center node (You) */}
            <circle cx={300} cy={300} r={30} fill="#f43f5e" opacity={0.1} />
            <circle cx={300} cy={300} r={26} fill="white" stroke="#f43f5e" strokeWidth={3} />
            <text x={300} y={305} textAnchor="middle" style={{ fontSize: '14px', fill: '#f43f5e', fontWeight: 700 }}>You</text>
          </svg>
        </div>
      )}
      {people.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" /> Recent (≤3d)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-amber-400 inline-block" /> Fading (7-14d)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Drifting (30d+)</span>
          <span className="flex items-center gap-1.5">Node size = interaction count</span>
        </div>
      )}
    </div>
  )
}
