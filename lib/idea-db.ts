/**
 * lib/idea-db.ts
 * Row ↔ model mappers for `ideas` and `automations` tables (migration 010).
 *
 * Snake-case in Postgres, camelCase in the app — this file is the only place
 * where the two worlds meet.
 */

import type { IdeaCard, IdeaStep, IdeaTool, SavedAutomation } from '@/lib/types'

// ── Ideas ─────────────────────────────────────────────────────────────────────
export interface IdeaRow {
  id:                      string
  user_id:                 string
  mode:                    'remodel' | 'description'
  description:             string
  inspiration_url:         string | null
  twist:                   string | null
  setup_budget_usd:        number | null
  how_it_makes_money:      string
  approx_monthly_revenue:  number
  approx_setup_cost:       number
  approx_monthly_cost:     number
  automation_percent:      number
  profitable_verdict:      'likely' | 'unlikely' | 'uncertain'
  profitable_reasoning:    string
  steps:                   IdeaStep[]
  tools:                   IdeaTool[]
  sources:                 Array<{ url: string; title: string }>
  created_at:              string
}

export function rowToIdeaCard(row: IdeaRow): IdeaCard {
  return {
    id:                       row.id,
    createdAt:                row.created_at,
    mode:                     row.mode,
    description:              row.description,
    inspirationUrl:           row.inspiration_url  ?? undefined,
    twist:                    row.twist            ?? undefined,
    setupBudgetUsd:           row.setup_budget_usd ?? undefined,
    howItMakesMoney:          row.how_it_makes_money,
    approxMonthlyRevenueUsd:  row.approx_monthly_revenue,
    approxSetupCostUsd:       row.approx_setup_cost,
    approxMonthlyCostUsd:     row.approx_monthly_cost,
    automationPercent:        row.automation_percent,
    profitableVerdict:        row.profitable_verdict,
    profitableReasoning:      row.profitable_reasoning,
    steps:                    row.steps ?? [],
    tools:                    row.tools ?? [],
  }
}

export function ideaCardToRow(
  card: Omit<IdeaCard, 'id' | 'createdAt'> & { sources?: Array<{ url: string; title: string }> },
  userId: string,
): Omit<IdeaRow, 'id' | 'created_at'> {
  return {
    user_id:                 userId,
    mode:                    card.mode,
    description:             card.description,
    inspiration_url:         card.inspirationUrl        ?? null,
    twist:                   card.twist                 ?? null,
    setup_budget_usd:        card.setupBudgetUsd        ?? null,
    how_it_makes_money:      card.howItMakesMoney,
    approx_monthly_revenue:  card.approxMonthlyRevenueUsd,
    approx_setup_cost:       card.approxSetupCostUsd,
    approx_monthly_cost:     card.approxMonthlyCostUsd,
    automation_percent:      card.automationPercent,
    profitable_verdict:      card.profitableVerdict,
    profitable_reasoning:    card.profitableReasoning,
    steps:                   card.steps,
    tools:                   card.tools,
    sources:                 card.sources ?? [],
  }
}

// ── Automations ───────────────────────────────────────────────────────────────
export interface AutomationRow {
  id:             string
  user_id:        string
  idea_id:        string | null
  name:           string
  workflow_type:  'build' | 'maintain'
  workflow_json:  unknown     // stored as jsonb
  checklist:      string[]
  explanation:    string
  imported_id:    string | null
  import_error:   string | null
  created_at:     string
}

export function rowToAutomation(row: AutomationRow): SavedAutomation {
  return {
    id:            row.id,
    ideaId:        row.idea_id ?? undefined,
    name:          row.name,
    createdAt:     row.created_at,
    workflowType:  row.workflow_type,
    workflowJson:  typeof row.workflow_json === 'string'
                     ? row.workflow_json
                     : JSON.stringify(row.workflow_json, null, 2),
    checklist:     row.checklist ?? [],
    explanation:   row.explanation,
    importedId:    row.imported_id ?? undefined,
    importError:   row.import_error ?? undefined,
  }
}

export function automationToRow(
  auto: Omit<SavedAutomation, 'id' | 'createdAt'>,
  userId: string,
): Omit<AutomationRow, 'id' | 'created_at'> {
  let workflowObj: unknown
  try {
    workflowObj = JSON.parse(auto.workflowJson)
  } catch {
    workflowObj = { raw: auto.workflowJson }
  }
  return {
    user_id:       userId,
    idea_id:       auto.ideaId ?? null,
    name:          auto.name,
    workflow_type: auto.workflowType,
    workflow_json: workflowObj,
    checklist:     auto.checklist ?? [],
    explanation:   auto.explanation ?? '',
    imported_id:   auto.importedId  ?? null,
    import_error:  auto.importError ?? null,
  }
}
