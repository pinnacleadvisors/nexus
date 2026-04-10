/**
 * Supabase database schema types — matches supabase/migrations/*.sql
 * Run `npx supabase gen types typescript --local` after schema changes.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      agents: {
        Row: {
          id: string
          name: string
          status: 'active' | 'idle' | 'error'
          tasks_completed: number
          tokens_used: number
          cost_usd: number
          error_count: number
          last_active: string
          created_at: string
        }
        Insert: {
          id: string
          name: string
          status?: 'active' | 'idle' | 'error'
          tasks_completed?: number
          tokens_used?: number
          cost_usd?: number
          error_count?: number
          last_active?: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          status?: 'active' | 'idle' | 'error'
          tasks_completed?: number
          tokens_used?: number
          cost_usd?: number
          error_count?: number
          last_active?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          created_at?: string
        }
        Update: {
          name?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          id: string
          project_id: string | null
          title: string
          description: string
          column_id: 'backlog' | 'in-progress' | 'review' | 'completed'
          assignee: string | null
          priority: 'low' | 'medium' | 'high'
          asset_url: string | null
          revision_note: string | null
          milestone_id: string | null
          position: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id?: string | null
          title: string
          description?: string
          column_id?: 'backlog' | 'in-progress' | 'review' | 'completed'
          assignee?: string | null
          priority?: 'low' | 'medium' | 'high'
          asset_url?: string | null
          revision_note?: string | null
          milestone_id?: string | null
          position?: number
          created_at?: string
        }
        Update: {
          project_id?: string | null
          title?: string
          description?: string
          column_id?: 'backlog' | 'in-progress' | 'review' | 'completed'
          assignee?: string | null
          priority?: 'low' | 'medium' | 'high'
          asset_url?: string | null
          revision_note?: string | null
          milestone_id?: string | null
          position?: number
        }
        Relationships: []
      }
      revenue_events: {
        Row: {
          id: string
          amount_usd: number
          source: 'stripe' | 'manual'
          description: string | null
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          amount_usd: number
          source?: 'stripe' | 'manual'
          description?: string | null
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          amount_usd?: number
          source?: 'stripe' | 'manual'
          description?: string | null
          metadata?: Json | null
        }
        Relationships: []
      }
      token_events: {
        Row: {
          id: string
          agent_id: string | null
          model: string
          input_tokens: number
          output_tokens: number
          cost_usd: number
          created_at: string
        }
        Insert: {
          id?: string
          agent_id?: string | null
          model: string
          input_tokens: number
          output_tokens: number
          cost_usd: number
          created_at?: string
        }
        Update: {
          agent_id?: string | null
          model?: string
          input_tokens?: number
          output_tokens?: number
          cost_usd?: number
        }
        Relationships: []
      }
      alert_thresholds: {
        Row: {
          id: string
          metric: 'daily_cost' | 'error_rate' | 'agent_down'
          threshold: number
          channel: 'email' | 'slack'
          destination: string
          enabled: boolean
          created_at: string
        }
        Insert: {
          id?: string
          metric: 'daily_cost' | 'error_rate' | 'agent_down'
          threshold: number
          channel: 'email' | 'slack'
          destination: string
          enabled?: boolean
          created_at?: string
        }
        Update: {
          metric?: 'daily_cost' | 'error_rate' | 'agent_down'
          threshold?: number
          channel?: 'email' | 'slack'
          destination?: string
          enabled?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      increment_agent_cost: {
        Args: { p_agent_id: string; p_tokens: number; p_cost: number }
        Returns: undefined
      }
      set_updated_at: {
        Args: Record<never, never>
        Returns: undefined
      }
    }
  }
}
