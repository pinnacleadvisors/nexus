/**
 * lib/experiments/types.ts — C5
 */

export type ExperimentWinner = 'a' | 'b' | 'tie'
export type ExperimentStatus = 'running' | 'decided' | 'stopped'

export interface ExperimentVariant {
  id:         string
  label:      string
  content:    string
  /** Which agent produced this variant — used to file feedback on loss. */
  agentSlug?: string
}

export interface Experiment {
  id:           string
  runId?:       string
  userId:       string
  hypothesis?:  string
  variantA:     ExperimentVariant
  variantB:     ExperimentVariant
  samplesA:     number
  samplesB:     number
  successesA:   number
  successesB:   number
  winner?:      ExperimentWinner
  confidence?:  number
  status:       ExperimentStatus
  createdAt:    string
  updatedAt:    string
  decidedAt?:   string
}

export interface CreateExperimentInput {
  runId?:      string
  hypothesis?: string
  variantA:    ExperimentVariant
  variantB:    ExperimentVariant
}

export interface SampleInput {
  experimentId: string
  variant:      'a' | 'b'
  /** 1 for success (click/conversion), 0 for impression only. */
  success:      0 | 1
}
