'use client'

import { X, Brain, Zap } from 'lucide-react'
import type { ModelConfig, ModelOption } from '@/lib/types'
import { ADVISOR_MODELS, EXECUTOR_MODELS } from '@/lib/types'

interface Props {
  config: ModelConfig
  onChange: (config: ModelConfig) => void
  onClose: () => void
}

function CostBadge({ model }: { model: ModelOption }) {
  // Show relative cost: input / output per 1M
  return (
    <span className="text-xs ml-auto" style={{ color: '#55556a' }}>
      ${model.costInput}/${model.costOutput} /1M
    </span>
  )
}

function ModelDropdown({
  label,
  icon: Icon,
  value,
  options,
  onChange,
}: {
  label: string
  icon: typeof Brain
  value: string
  options: ModelOption[]
  onChange: (id: string) => void
}) {
  const selected = options.find(m => m.id === value) ?? options[0]

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon size={13} style={{ color: '#6c63ff' }} />
        <span className="text-xs font-semibold" style={{ color: '#9090b0' }}>
          {label}
        </span>
      </div>

      <div
        className="rounded-lg overflow-hidden"
        style={{ border: '1px solid #24243e' }}
      >
        {options.map(m => {
          const isSelected = m.id === value
          return (
            <button
              key={m.id}
              onClick={() => onChange(m.id)}
              className="w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors"
              style={{
                backgroundColor: isSelected ? '#1a1a2e' : 'transparent',
                borderBottom: '1px solid #24243e',
              }}
            >
              <div
                className="mt-0.5 w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0"
                style={{
                  borderColor: isSelected ? '#6c63ff' : '#55556a',
                  backgroundColor: isSelected ? '#6c63ff' : 'transparent',
                }}
              >
                {isSelected && (
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#fff' }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold" style={{ color: isSelected ? '#e8e8f0' : '#9090b0' }}>
                    {m.label}
                  </span>
                  <CostBadge model={m} />
                </div>
                <p className="text-xs mt-0.5" style={{ color: '#55556a' }}>
                  {m.note}
                </p>
              </div>
            </button>
          )
        })}
      </div>

      {/* Cost summary */}
      <p className="text-xs mt-1.5" style={{ color: '#55556a' }}>
        Selected: <span style={{ color: '#9090b0' }}>{selected.label}</span>
        {' '}· ~${((selected.costInput * 0.7 + selected.costOutput * 0.3) / 10).toFixed(3)} per ~10k tokens
      </p>
    </div>
  )
}

export default function ModelSelector({ config, onChange, onClose }: Props) {
  // Savings vs using Opus for everything
  const opusCost = ADVISOR_MODELS.find(m => m.id === 'claude-opus-4-6')!
  const execModel = EXECUTOR_MODELS.find(m => m.id === config.executorModel) ?? EXECUTOR_MODELS[0]
  const savingPct = Math.round((1 - (execModel.costInput / opusCost.costInput)) * 100)

  return (
    <div
      className="absolute top-12 right-2 z-50 w-80 rounded-xl shadow-2xl"
      style={{
        backgroundColor: '#0d0d14',
        border: '1px solid #24243e',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid #24243e' }}
      >
        <span className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
          Model Configuration
        </span>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded"
          style={{ color: '#55556a' }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#e8e8f0')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#55556a')}
        >
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="p-4 space-y-5">
        <ModelDropdown
          label="Advisor model"
          icon={Brain}
          value={config.advisorModel}
          options={ADVISOR_MODELS}
          onChange={id => onChange({ ...config, advisorModel: id })}
        />

        <ModelDropdown
          label="Executor model"
          icon={Zap}
          value={config.executorModel}
          options={EXECUTOR_MODELS}
          onChange={id => onChange({ ...config, executorModel: id })}
        />

        {/* Savings indicator */}
        {savingPct > 0 && (
          <div
            className="rounded-lg px-3 py-2.5"
            style={{ backgroundColor: '#0a1a0a', border: '1px solid #22c55e33' }}
          >
            <p className="text-xs" style={{ color: '#22c55e' }}>
              Executor saves ~{savingPct}% vs using Opus for all tasks.
              Advisor handles strategy; executor handles implementation.
            </p>
          </div>
        )}

        <p className="text-xs" style={{ color: '#55556a' }}>
          Prices are approximate. Prompt caching is enabled — repeated system prompts are cached at ~10% of input cost.
        </p>
      </div>
    </div>
  )
}
