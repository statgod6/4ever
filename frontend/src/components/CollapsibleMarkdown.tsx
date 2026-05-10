import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import Markdown from './Markdown'

interface CollapsibleMarkdownProps {
  content: string
  className?: string
  /** Start sections collapsed (default: false = all expanded) */
  defaultCollapsed?: boolean
}

interface Section {
  heading: string
  level: number
  body: string
}

function parseSections(content: string): { preamble: string; sections: Section[] } {
  const lines = content.split('\n')
  let preamble = ''
  const sections: Section[] = []
  let current: Section | null = null

  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)$/)
    if (match) {
      if (current) sections.push(current)
      current = { heading: match[2], level: match[1].length, body: '' }
    } else if (current) {
      current.body += line + '\n'
    } else {
      preamble += line + '\n'
    }
  }
  if (current) sections.push(current)

  return { preamble: preamble.trimEnd(), sections }
}

function CollapsibleSection({ section, defaultCollapsed }: { section: Section; defaultCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const Icon = collapsed ? ChevronRight : ChevronDown

  const headingSize =
    section.level === 1
      ? 'text-xl font-bold'
      : section.level === 2
      ? 'text-lg font-semibold'
      : 'text-base font-semibold'

  return (
    <div className="border-l-2 border-gray-100 hover:border-primary-200 transition-colors">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full text-left py-1.5 px-2 rounded-r-lg hover:bg-gray-50 transition-colors group"
      >
        <Icon className="w-4 h-4 text-gray-400 group-hover:text-primary-500 flex-shrink-0 transition-colors" />
        <span className={`${headingSize} text-gray-900`}>{section.heading}</span>
      </button>
      {!collapsed && (
        <div className="pl-8 pr-2 pb-2 animate-fadeIn">
          <Markdown content={section.body.trim()} />
        </div>
      )}
    </div>
  )
}

export default function CollapsibleMarkdown({ content, className = '', defaultCollapsed = false }: CollapsibleMarkdownProps) {
  const { preamble, sections } = parseSections(content)

  // If there's only 0-1 sections, just render normally (no point collapsing)
  if (sections.length <= 1) {
    return <Markdown content={content} className={className} />
  }

  return (
    <div className={`space-y-1 ${className}`}>
      {preamble && <Markdown content={preamble} />}
      {sections.map((section, i) => (
        <CollapsibleSection key={i} section={section} defaultCollapsed={defaultCollapsed} />
      ))}
    </div>
  )
}
