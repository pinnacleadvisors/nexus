import ToolsGrid from '@/components/tools/ToolsGrid'
import { TOOLS } from '@/lib/mock-data'

export default function ToolsPage() {
  return (
    <div className="p-6 min-h-full" style={{ backgroundColor: '#050508' }}>
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: '#e8e8f0' }}>
          Tools &amp; Integrations
        </h1>
        <p className="text-sm mt-0.5" style={{ color: '#9090b0' }}>
          Every platform connected to your Nexus workspace. Click a card to open the tool.
        </p>
      </div>

      <ToolsGrid tools={TOOLS} />
    </div>
  )
}
