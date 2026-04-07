import type { Tool, ToolCategory } from '@/lib/types'
import ToolCard, { CATEGORY_ORDER } from './ToolCard'

interface Props {
  tools: Tool[]
}

export default function ToolsGrid({ tools }: Props) {
  const grouped = tools.reduce<Record<ToolCategory, Tool[]>>((acc, tool) => {
    if (!acc[tool.category]) acc[tool.category] = []
    acc[tool.category].push(tool)
    return acc
  }, {} as Record<ToolCategory, Tool[]>)

  return (
    <div className="space-y-8">
      {CATEGORY_ORDER.filter(cat => grouped[cat]?.length > 0).map(category => (
        <section key={category}>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#55556a' }}>
            {category}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {grouped[category].map(tool => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
