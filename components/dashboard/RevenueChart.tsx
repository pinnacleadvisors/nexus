'use client'

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import type { RevenueDataPoint, DateRange } from '@/lib/types'

function formatDollar(value: number) {
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}k`
  return `$${value}`
}

const RANGE_LABELS: Record<DateRange, string> = {
  '7d':  '7-day window',
  '30d': '30-day rolling',
  '90d': '90-day rolling',
  'all': 'All time',
}

interface Props {
  data: RevenueDataPoint[]
  range?: DateRange
}

export default function RevenueChart({ data, range = '30d' }: Props) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold" style={{ color: '#e8e8f0' }}>
            Revenue vs Cost
          </h2>
          <p className="text-xs mt-0.5" style={{ color: '#9090b0' }}>
            {RANGE_LABELS[range]}
          </p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="#1a1a2e" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={{ fill: '#55556a', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={formatDollar} tick={{ fill: '#55556a', fontSize: 12 }} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #24243e', borderRadius: '8px', color: '#e8e8f0', fontSize: 12 }}
            formatter={(value) => `$${Number(value).toLocaleString()}`}
            labelStyle={{ color: '#9090b0', marginBottom: 4 }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: '#9090b0', paddingTop: 8 }} />
          <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#22c55e" strokeWidth={2} fill="url(#gradRevenue)" dot={false} activeDot={{ r: 4, fill: '#22c55e' }} />
          <Area type="monotone" dataKey="cost"    name="Cost"    stroke="#ef4444" strokeWidth={2} fill="url(#gradCost)"    dot={false} activeDot={{ r: 4, fill: '#ef4444' }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
