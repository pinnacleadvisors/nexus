import KpiGrid from '@/components/dashboard/KpiGrid'
import RevenueChart from '@/components/dashboard/RevenueChart'
import AgentTable from '@/components/dashboard/AgentTable'
import { KPI_DATA, REVENUE_DATA, AGENT_ROWS } from '@/lib/mock-data'

export default function DashboardPage() {
  return (
    <div className="p-6 space-y-6 min-h-full" style={{ backgroundColor: '#050508' }}>
      <div>
        <h1 className="text-xl font-bold" style={{ color: '#e8e8f0' }}>
          Operations Dashboard
        </h1>
        <p className="text-sm mt-0.5" style={{ color: '#9090b0' }}>
          Live performance across all agents and businesses
        </p>
      </div>

      <KpiGrid cards={KPI_DATA} />
      <RevenueChart data={REVENUE_DATA} />
      <AgentTable agents={AGENT_ROWS} />
    </div>
  )
}
