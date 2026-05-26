export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_actions: {
        Row: {
          action: string
          agent_id: string
          created_at: string
          description: string | null
          id: string
          metadata: Json
          tokens_used: number
          user_id: string
        }
        Insert: {
          action: string
          agent_id: string
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          tokens_used?: number
          user_id: string
        }
        Update: {
          action?: string
          agent_id?: string
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          tokens_used?: number
          user_id?: string
        }
        Relationships: []
      }
      agent_library: {
        Row: {
          created_at: string
          description: string
          env_vars: string[]
          hooks: Json
          id: string
          inject_platform_brief: boolean
          model: string
          name: string
          slug: string
          source_path: string | null
          system_prompt: string
          tools: string[]
          transferable: boolean
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          description: string
          env_vars?: string[]
          hooks?: Json
          id?: string
          inject_platform_brief?: boolean
          model?: string
          name: string
          slug: string
          source_path?: string | null
          system_prompt: string
          tools?: string[]
          transferable?: boolean
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          description?: string
          env_vars?: string[]
          hooks?: Json
          id?: string
          inject_platform_brief?: boolean
          model?: string
          name?: string
          slug?: string
          source_path?: string | null
          system_prompt?: string
          tools?: string[]
          transferable?: boolean
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      agent_roles: {
        Row: {
          assigned_agent_slug: string | null
          assigned_user_id: string | null
          business_slug: string | null
          created_at: string
          id: string
          parent_role_id: string | null
          reports_to_summary: string | null
          responsibilities: string | null
          role_title: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          assigned_agent_slug?: string | null
          assigned_user_id?: string | null
          business_slug?: string | null
          created_at?: string
          id?: string
          parent_role_id?: string | null
          reports_to_summary?: string | null
          responsibilities?: string | null
          role_title: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          assigned_agent_slug?: string | null
          assigned_user_id?: string | null
          business_slug?: string | null
          created_at?: string
          id?: string
          parent_role_id?: string | null
          reports_to_summary?: string | null
          responsibilities?: string | null
          role_title?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_roles_business_slug_fkey"
            columns: ["business_slug"]
            isOneToOne: false
            referencedRelation: "business_operators"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "agent_roles_parent_role_id_fkey"
            columns: ["parent_role_id"]
            isOneToOne: false
            referencedRelation: "agent_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_templates: {
        Row: {
          auto_extracted: boolean
          avg_quality_score: number
          constraints: string[]
          created_at: string
          example_output: string | null
          id: string
          model: string
          name: string
          output_format: string
          role: string
          system_prompt: string
          tags: string[]
          updated_at: string
          usage_count: number
          user_id: string
          version: number
        }
        Insert: {
          auto_extracted?: boolean
          avg_quality_score?: number
          constraints?: string[]
          created_at?: string
          example_output?: string | null
          id?: string
          model?: string
          name: string
          output_format?: string
          role: string
          system_prompt: string
          tags?: string[]
          updated_at?: string
          usage_count?: number
          user_id: string
          version?: number
        }
        Update: {
          auto_extracted?: boolean
          avg_quality_score?: number
          constraints?: string[]
          created_at?: string
          example_output?: string | null
          id?: string
          model?: string
          name?: string
          output_format?: string
          role?: string
          system_prompt?: string
          tags?: string[]
          updated_at?: string
          usage_count?: number
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      agents: {
        Row: {
          business_id: string | null
          cost_usd: number
          created_at: string
          current_task: string | null
          error_count: number
          id: string
          last_active: string
          last_active_at: string | null
          layer: number
          model: string
          name: string
          parent_agent_id: string | null
          project_id: string | null
          status: string
          swarm_id: string | null
          tasks_completed: number
          tokens_used: number
          user_id: string | null
        }
        Insert: {
          business_id?: string | null
          cost_usd?: number
          created_at?: string
          current_task?: string | null
          error_count?: number
          id: string
          last_active?: string
          last_active_at?: string | null
          layer?: number
          model?: string
          name: string
          parent_agent_id?: string | null
          project_id?: string | null
          status?: string
          swarm_id?: string | null
          tasks_completed?: number
          tokens_used?: number
          user_id?: string | null
        }
        Update: {
          business_id?: string | null
          cost_usd?: number
          created_at?: string
          current_task?: string | null
          error_count?: number
          id?: string
          last_active?: string
          last_active_at?: string | null
          layer?: number
          model?: string
          name?: string
          parent_agent_id?: string | null
          project_id?: string | null
          status?: string
          swarm_id?: string | null
          tasks_completed?: number
          tokens_used?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agents_parent_agent_id_fkey"
            columns: ["parent_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_thresholds: {
        Row: {
          channel: string
          created_at: string
          destination: string
          enabled: boolean
          id: string
          metric: string
          threshold: number
        }
        Insert: {
          channel?: string
          created_at?: string
          destination: string
          enabled?: boolean
          id?: string
          metric: string
          threshold: number
        }
        Update: {
          channel?: string
          created_at?: string
          destination?: string
          enabled?: boolean
          id?: string
          metric?: string
          threshold?: number
        }
        Relationships: []
      }
      approvals: {
        Row: {
          business_slug: string
          created_at: string
          created_by_agent: string | null
          decided_at: string | null
          decided_by_user: string | null
          decision_note: string | null
          id: string
          payload: Json
          status: string
          type: string
        }
        Insert: {
          business_slug: string
          created_at?: string
          created_by_agent?: string | null
          decided_at?: string | null
          decided_by_user?: string | null
          decision_note?: string | null
          id?: string
          payload?: Json
          status?: string
          type: string
        }
        Update: {
          business_slug?: string
          created_at?: string
          created_by_agent?: string | null
          decided_at?: string | null
          decided_by_user?: string | null
          decision_note?: string | null
          id?: string
          payload?: Json
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_business_slug_fkey"
            columns: ["business_slug"]
            isOneToOne: false
            referencedRelation: "business_operators"
            referencedColumns: ["slug"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          ip: string | null
          metadata: Json | null
          pinned: boolean
          resource: string
          resource_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json | null
          pinned?: boolean
          resource: string
          resource_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json | null
          pinned?: boolean
          resource?: string
          resource_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      automations: {
        Row: {
          checklist: Json
          created_at: string
          explanation: string
          id: string
          idea_id: string | null
          import_error: string | null
          imported_id: string | null
          name: string
          user_id: string
          workflow_json: Json
          workflow_type: string
        }
        Insert: {
          checklist?: Json
          created_at?: string
          explanation?: string
          id?: string
          idea_id?: string | null
          import_error?: string | null
          imported_id?: string | null
          name: string
          user_id: string
          workflow_json: Json
          workflow_type: string
        }
        Update: {
          checklist?: Json
          created_at?: string
          explanation?: string
          id?: string
          idea_id?: string | null
          import_error?: string | null
          imported_id?: string | null
          name?: string
          user_id?: string
          workflow_json?: Json
          workflow_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      background_tasks: {
        Row: {
          cancelled_at: string | null
          chat_session_id: string | null
          created_at: string
          description: string | null
          error: string | null
          finished_at: string | null
          id: string
          kind: string
          parent_id: string | null
          payload: Json
          result: Json | null
          scope: string
          started_at: string | null
          status: string
          title: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          chat_session_id?: string | null
          created_at?: string
          description?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          parent_id?: string | null
          payload?: Json
          result?: Json | null
          scope: string
          started_at?: string | null
          status?: string
          title: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          chat_session_id?: string | null
          created_at?: string
          description?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          parent_id?: string | null
          payload?: Json
          result?: Json | null
          scope?: string
          started_at?: string | null
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "background_tasks_chat_session_id_fkey"
            columns: ["chat_session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "background_tasks_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "background_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      bug_hunt_findings: {
        Row: {
          branch: string | null
          category: string
          created_at: string
          detail: string | null
          id: string
          iteration: number
          pr_url: string | null
          resolved_at: string | null
          session_id: string
          severity: string
          source_path: string | null
          status: string
          title: string
        }
        Insert: {
          branch?: string | null
          category: string
          created_at?: string
          detail?: string | null
          id?: string
          iteration: number
          pr_url?: string | null
          resolved_at?: string | null
          session_id: string
          severity?: string
          source_path?: string | null
          status?: string
          title: string
        }
        Update: {
          branch?: string | null
          category?: string
          created_at?: string
          detail?: string | null
          id?: string
          iteration?: number
          pr_url?: string | null
          resolved_at?: string | null
          session_id?: string
          severity?: string
          source_path?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "bug_hunt_findings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "bug_hunt_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      bug_hunt_sessions: {
        Row: {
          budget_usd: number | null
          codex_window_share_pct: number | null
          created_at: string
          ended_at: string | null
          force_plan_window: boolean | null
          id: string
          iteration_count: number | null
          max_iterations: number | null
          plan_window_share_pct: number | null
          scope: string
          spent_usd: number | null
          status: string
          user_id: string
        }
        Insert: {
          budget_usd?: number | null
          codex_window_share_pct?: number | null
          created_at?: string
          ended_at?: string | null
          force_plan_window?: boolean | null
          id: string
          iteration_count?: number | null
          max_iterations?: number | null
          plan_window_share_pct?: number | null
          scope: string
          spent_usd?: number | null
          status?: string
          user_id: string
        }
        Update: {
          budget_usd?: number | null
          codex_window_share_pct?: number | null
          created_at?: string
          ended_at?: string | null
          force_plan_window?: boolean | null
          id?: string
          iteration_count?: number | null
          max_iterations?: number | null
          plan_window_share_pct?: number | null
          scope?: string
          spent_usd?: number | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      build_research: {
        Row: {
          created_at: string
          duration_ms: number
          id: string
          queries_run: Json
          raw_search_count: number
          run_at: string
          stack_issues: Json
          suggestions: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number
          id?: string
          queries_run?: Json
          raw_search_count?: number
          run_at?: string
          stack_issues?: Json
          suggestions?: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number
          id?: string
          queries_run?: Json
          raw_search_count?: number
          run_at?: string
          stack_issues?: Json
          suggestions?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      business_operators: {
        Row: {
          approval_gates: Json
          board_members: Json
          brand_voice: string | null
          created_at: string
          current_run_id: string | null
          daily_cron_local_hour: number
          kpi_targets: Json
          last_operator_at: string | null
          mission: string | null
          money_model: Json
          name: string
          niche: string
          parent_org_id: string | null
          simulation: boolean
          simulation_seed_at: string | null
          slack_channel: string | null
          slack_webhook_url: string | null
          slack_webhook_url_enc: string | null
          slug: string
          status: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approval_gates?: Json
          board_members?: Json
          brand_voice?: string | null
          created_at?: string
          current_run_id?: string | null
          daily_cron_local_hour?: number
          kpi_targets?: Json
          last_operator_at?: string | null
          mission?: string | null
          money_model?: Json
          name: string
          niche: string
          parent_org_id?: string | null
          simulation?: boolean
          simulation_seed_at?: string | null
          slack_channel?: string | null
          slack_webhook_url?: string | null
          slack_webhook_url_enc?: string | null
          slug: string
          status?: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approval_gates?: Json
          board_members?: Json
          brand_voice?: string | null
          created_at?: string
          current_run_id?: string | null
          daily_cron_local_hour?: number
          kpi_targets?: Json
          last_operator_at?: string | null
          mission?: string | null
          money_model?: Json
          name?: string
          niche?: string
          parent_org_id?: string | null
          simulation?: boolean
          simulation_seed_at?: string | null
          slack_channel?: string | null
          slack_webhook_url?: string | null
          slack_webhook_url_enc?: string | null
          slug?: string
          status?: string
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_operators_current_run_id_fkey"
            columns: ["current_run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_operators_parent_org_id_fkey"
            columns: ["parent_org_id"]
            isOneToOne: false
            referencedRelation: "business_operators"
            referencedColumns: ["slug"]
          },
        ]
      }
      businesses: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          metadata: Json
          role: string
          session_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          metadata?: Json
          role: string
          session_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          metadata?: Json
          role?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_permission_requests: {
        Row: {
          created_at: string
          decision: Json | null
          id: string
          job_id: string
          resolved_at: string | null
          status: string
          tool_input: Json
          tool_name: string
          tool_use_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          decision?: Json | null
          id?: string
          job_id: string
          resolved_at?: string | null
          status?: string
          tool_input?: Json
          tool_name: string
          tool_use_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          decision?: Json | null
          id?: string
          job_id?: string
          resolved_at?: string | null
          status?: string
          tool_input?: Json
          tool_name?: string
          tool_use_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      chat_sessions: {
        Row: {
          agent_slug: string
          created_at: string
          id: string
          last_message_at: string
          scope: string
          title: string | null
          user_id: string
        }
        Insert: {
          agent_slug?: string
          created_at?: string
          id?: string
          last_message_at?: string
          scope: string
          title?: string | null
          user_id: string
        }
        Update: {
          agent_slug?: string
          created_at?: string
          id?: string
          last_message_at?: string
          scope?: string
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      code_snippets: {
        Row: {
          auto_extracted: boolean
          avg_quality_score: number
          code: string
          created_at: string
          dependencies: string[]
          description: string | null
          id: string
          language: string
          purpose: string | null
          source_agent_run: string | null
          tags: string[]
          title: string
          updated_at: string
          usage_count: number
          user_id: string
        }
        Insert: {
          auto_extracted?: boolean
          avg_quality_score?: number
          code: string
          created_at?: string
          dependencies?: string[]
          description?: string | null
          id?: string
          language?: string
          purpose?: string | null
          source_agent_run?: string | null
          tags?: string[]
          title: string
          updated_at?: string
          usage_count?: number
          user_id: string
        }
        Update: {
          auto_extracted?: boolean
          avg_quality_score?: number
          code?: string
          created_at?: string
          dependencies?: string[]
          description?: string | null
          id?: string
          language?: string
          purpose?: string | null
          source_agent_run?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
          usage_count?: number
          user_id?: string
        }
        Relationships: []
      }
      connected_accounts: {
        Row: {
          business_slug: string | null
          composio_account_id: string | null
          created_at: string
          encrypted_api_key: string | null
          id: string
          last_used_at: string | null
          metadata: Json
          platform: string
          status: string
          user_id: string
        }
        Insert: {
          business_slug?: string | null
          composio_account_id?: string | null
          created_at?: string
          encrypted_api_key?: string | null
          id?: string
          last_used_at?: string | null
          metadata?: Json
          platform: string
          status?: string
          user_id: string
        }
        Update: {
          business_slug?: string | null
          composio_account_id?: string | null
          created_at?: string
          encrypted_api_key?: string | null
          id?: string
          last_used_at?: string | null
          metadata?: Json
          platform?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      coolify_audit_log: {
        Row: {
          action: string
          args_redacted: Json
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          job_id: string | null
          result: string
          scope: string
          target_uuid: string | null
          user_id: string
        }
        Insert: {
          action: string
          args_redacted?: Json
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          job_id?: string | null
          result: string
          scope?: string
          target_uuid?: string | null
          user_id: string
        }
        Update: {
          action?: string
          args_redacted?: Json
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          job_id?: string | null
          result?: string
          scope?: string
          target_uuid?: string | null
          user_id?: string
        }
        Relationships: []
      }
      coolify_kill_switch: {
        Row: {
          created_at: string
          revoked_at: string | null
          revoked_by: string | null
          revoked_reason: string | null
          singleton: boolean
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          singleton?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          singleton?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      cron_alerts_state: {
        Row: {
          id: number
          last_alert_at: string | null
          last_red_titles: string[]
          last_thread_ts: string | null
          updated_at: string
        }
        Insert: {
          id?: number
          last_alert_at?: string | null
          last_red_titles?: string[]
          last_thread_ts?: string | null
          updated_at?: string
        }
        Update: {
          id?: number
          last_alert_at?: string | null
          last_red_titles?: string[]
          last_thread_ts?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      daily_streaks: {
        Row: {
          current_streak: number
          freezes_available: number
          last_review_date: string | null
          longest_streak: number
          updated_at: string
          user_id: string
          xp_today: number
          xp_total: number
        }
        Insert: {
          current_streak?: number
          freezes_available?: number
          last_review_date?: string | null
          longest_streak?: number
          updated_at?: string
          user_id: string
          xp_today?: number
          xp_total?: number
        }
        Update: {
          current_streak?: number
          freezes_available?: number
          last_review_date?: string | null
          longest_streak?: number
          updated_at?: string
          user_id?: string
          xp_today?: number
          xp_total?: number
        }
        Relationships: []
      }
      departments_custom: {
        Row: {
          approval_gates: string[]
          created_at: string
          default_ecosystem_kinds: string[]
          id: string
          label: string
          purpose: string
          roles: string[]
          slug: string
          user_id: string
        }
        Insert: {
          approval_gates?: string[]
          created_at?: string
          default_ecosystem_kinds?: string[]
          id?: string
          label: string
          purpose: string
          roles?: string[]
          slug: string
          user_id: string
        }
        Update: {
          approval_gates?: string[]
          created_at?: string
          default_ecosystem_kinds?: string[]
          id?: string
          label?: string
          purpose?: string
          roles?: string[]
          slug?: string
          user_id?: string
        }
        Relationships: []
      }
      experiment_metrics: {
        Row: {
          business_slug: string
          id: string
          kind: string
          payload: Json
          ts: string
        }
        Insert: {
          business_slug: string
          id?: string
          kind: string
          payload?: Json
          ts?: string
        }
        Update: {
          business_slug?: string
          id?: string
          kind?: string
          payload?: Json
          ts?: string
        }
        Relationships: []
      }
      experiments: {
        Row: {
          confidence: number | null
          created_at: string
          decided_at: string | null
          hypothesis: string | null
          id: string
          run_id: string | null
          samples_a: number
          samples_b: number
          status: string
          successes_a: number
          successes_b: number
          updated_at: string
          user_id: string
          variant_a: Json
          variant_b: Json
          winner: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          decided_at?: string | null
          hypothesis?: string | null
          id?: string
          run_id?: string | null
          samples_a?: number
          samples_b?: number
          status?: string
          successes_a?: number
          successes_b?: number
          updated_at?: string
          user_id: string
          variant_a: Json
          variant_b: Json
          winner?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          decided_at?: string | null
          hypothesis?: string | null
          id?: string
          run_id?: string | null
          samples_a?: number
          samples_b?: number
          status?: string
          successes_a?: number
          successes_b?: number
          updated_at?: string
          user_id?: string
          variant_a?: Json
          variant_b?: Json
          winner?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "experiments_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      flashcard_reviews: {
        Row: {
          answer: string | null
          card_id: string
          created_at: string
          due_at_after: string
          duration_ms: number
          grade: number | null
          grade_feedback: string | null
          id: string
          new_state: string
          prev_state: string
          rating: string
          stability_after: number
          user_id: string
          xp: number
        }
        Insert: {
          answer?: string | null
          card_id: string
          created_at?: string
          due_at_after: string
          duration_ms?: number
          grade?: number | null
          grade_feedback?: string | null
          id?: string
          new_state: string
          prev_state: string
          rating: string
          stability_after: number
          user_id: string
          xp?: number
        }
        Update: {
          answer?: string | null
          card_id?: string
          created_at?: string
          due_at_after?: string
          duration_ms?: number
          grade?: number | null
          grade_feedback?: string | null
          id?: string
          new_state?: string
          prev_state?: string
          rating?: string
          stability_after?: number
          user_id?: string
          xp?: number
        }
        Relationships: [
          {
            foreignKeyName: "flashcard_reviews_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "flashcards"
            referencedColumns: ["id"]
          },
        ]
      }
      flashcards: {
        Row: {
          atom_slug: string
          back: string
          created_at: string
          crown: number
          difficulty: number
          due_at: string
          front: string
          id: string
          kind: string
          last_reviewed_at: string | null
          moc_slug: string | null
          options: Json | null
          reference_context: string | null
          retrievability: number
          source_sha: string
          stability: number
          stale_reason: string | null
          state: string
          streak_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          atom_slug: string
          back: string
          created_at?: string
          crown?: number
          difficulty?: number
          due_at?: string
          front: string
          id?: string
          kind: string
          last_reviewed_at?: string | null
          moc_slug?: string | null
          options?: Json | null
          reference_context?: string | null
          retrievability?: number
          source_sha: string
          stability?: number
          stale_reason?: string | null
          state?: string
          streak_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          atom_slug?: string
          back?: string
          created_at?: string
          crown?: number
          difficulty?: number
          due_at?: string
          front?: string
          id?: string
          kind?: string
          last_reviewed_at?: string | null
          moc_slug?: string | null
          options?: Json | null
          reference_context?: string | null
          retrievability?: number
          source_sha?: string
          stability?: number
          stale_reason?: string | null
          state?: string
          streak_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gateway_turns: {
        Row: {
          cost_estimate_usd: number | null
          created_at: string
          duration_ms: number | null
          id: string
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          plan: string
          session_tag: string | null
          tool_calls_count: number | null
          user_id: string
        }
        Insert: {
          cost_estimate_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          plan: string
          session_tag?: string | null
          tool_calls_count?: number | null
          user_id: string
        }
        Update: {
          cost_estimate_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          plan?: string
          session_tag?: string | null
          tool_calls_count?: number | null
          user_id?: string
        }
        Relationships: []
      }
      goals: {
        Row: {
          business_slug: string
          created_at: string
          id: string
          parent_goal_id: string | null
          status: string
          success_criteria: string | null
          title: string
          updated_at: string
        }
        Insert: {
          business_slug: string
          created_at?: string
          id?: string
          parent_goal_id?: string | null
          status?: string
          success_criteria?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          business_slug?: string
          created_at?: string
          id?: string
          parent_goal_id?: string | null
          status?: string
          success_criteria?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_business_slug_fkey"
            columns: ["business_slug"]
            isOneToOne: false
            referencedRelation: "business_operators"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "goals_parent_goal_id_fkey"
            columns: ["parent_goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      ideas: {
        Row: {
          approx_monthly_cost: number
          approx_monthly_revenue: number
          approx_setup_cost: number
          automation_percent: number
          created_at: string
          description: string
          how_it_makes_money: string
          id: string
          inspiration_url: string | null
          mode: string
          profitable_reasoning: string
          profitable_verdict: string
          setup_budget_usd: number | null
          sources: Json
          steps: Json
          tools: Json
          twist: string | null
          user_id: string
        }
        Insert: {
          approx_monthly_cost?: number
          approx_monthly_revenue?: number
          approx_setup_cost?: number
          automation_percent?: number
          created_at?: string
          description: string
          how_it_makes_money?: string
          id?: string
          inspiration_url?: string | null
          mode: string
          profitable_reasoning?: string
          profitable_verdict?: string
          setup_budget_usd?: number | null
          sources?: Json
          steps?: Json
          tools?: Json
          twist?: string | null
          user_id: string
        }
        Update: {
          approx_monthly_cost?: number
          approx_monthly_revenue?: number
          approx_setup_cost?: number
          automation_percent?: number
          created_at?: string
          description?: string
          how_it_makes_money?: string
          id?: string
          inspiration_url?: string | null
          mode?: string
          profitable_reasoning?: string
          profitable_verdict?: string
          setup_budget_usd?: number | null
          sources?: Json
          steps?: Json
          tools?: Json
          twist?: string | null
          user_id?: string
        }
        Relationships: []
      }
      issue_comments: {
        Row: {
          author_agent: string | null
          author_user: string | null
          body: string
          created_at: string
          id: string
          issue_id: string
        }
        Insert: {
          author_agent?: string | null
          author_user?: string | null
          body: string
          created_at?: string
          id?: string
          issue_id: string
        }
        Update: {
          author_agent?: string | null
          author_user?: string | null
          body?: string
          created_at?: string
          id?: string
          issue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_comments_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
      issues: {
        Row: {
          assignee_agent: string | null
          assignee_user: string | null
          body: string | null
          business_slug: string
          checkout_run_id: string | null
          created_at: string
          execution_run_id: string | null
          goal_id: string | null
          id: string
          parent_id: string | null
          status: string
          status_category: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_agent?: string | null
          assignee_user?: string | null
          body?: string | null
          business_slug: string
          checkout_run_id?: string | null
          created_at?: string
          execution_run_id?: string | null
          goal_id?: string | null
          id?: string
          parent_id?: string | null
          status?: string
          status_category?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_agent?: string | null
          assignee_user?: string | null
          body?: string | null
          business_slug?: string
          checkout_run_id?: string | null
          created_at?: string
          execution_run_id?: string | null
          goal_id?: string | null
          id?: string
          parent_id?: string | null
          status?: string
          status_category?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "issues_business_slug_fkey"
            columns: ["business_slug"]
            isOneToOne: false
            referencedRelation: "business_operators"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "issues_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
      kill_switches: {
        Row: {
          description: string
          enabled: boolean
          key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          description: string
          enabled?: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          description?: string
          enabled?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      learning_sessions: {
        Row: {
          avg_duration_ms: number
          cards_reviewed: number
          correct_count: number
          ended_at: string | null
          id: string
          started_at: string
          user_id: string
          xp_earned: number
        }
        Insert: {
          avg_duration_ms?: number
          cards_reviewed?: number
          correct_count?: number
          ended_at?: string | null
          id?: string
          started_at?: string
          user_id: string
          xp_earned?: number
        }
        Update: {
          avg_duration_ms?: number
          cards_reviewed?: number
          correct_count?: number
          ended_at?: string | null
          id?: string
          started_at?: string
          user_id?: string
          xp_earned?: number
        }
        Relationships: []
      }
      log_events: {
        Row: {
          created_at: string
          deployment_id: string | null
          duration_ms: number | null
          id: string
          level: string | null
          message: string
          raw_url: string | null
          request_id: string | null
          route: string | null
          status: number | null
        }
        Insert: {
          created_at?: string
          deployment_id?: string | null
          duration_ms?: number | null
          id?: string
          level?: string | null
          message?: string
          raw_url?: string | null
          request_id?: string | null
          route?: string | null
          status?: number | null
        }
        Update: {
          created_at?: string
          deployment_id?: string | null
          duration_ms?: number | null
          id?: string
          level?: string | null
          message?: string
          raw_url?: string | null
          request_id?: string | null
          route?: string | null
          status?: number | null
        }
        Relationships: []
      }
      memory_cache: {
        Row: {
          cached_at: string
          content: string
          path: string
          sha: string
        }
        Insert: {
          cached_at?: string
          content: string
          path: string
          sha: string
        }
        Update: {
          cached_at?: string
          content?: string
          path?: string
          sha?: string
        }
        Relationships: []
      }
      metric_samples: {
        Row: {
          agent_slug: string
          at: string
          id: string
          kind: string
          run_id: string | null
          user_id: string
          value: number
        }
        Insert: {
          agent_slug: string
          at?: string
          id?: string
          kind: string
          run_id?: string | null
          user_id: string
          value: number
        }
        Update: {
          agent_slug?: string
          at?: string
          id?: string
          kind?: string
          run_id?: string | null
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "metric_samples_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      milestones: {
        Row: {
          created_at: string
          description: string
          forge_id: string | null
          id: string
          phase: number
          project_id: string | null
          status: string
          target_date: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          forge_id?: string | null
          id?: string
          phase?: number
          project_id?: string | null
          status?: string
          target_date?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          forge_id?: string | null
          id?: string
          phase?: number
          project_id?: string | null
          status?: string
          target_date?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      mol_atoms: {
        Row: {
          body_md: string
          created_at: string
          embedding: string | null
          frontmatter: Json
          last_used_at: string | null
          path: string
          pinned: boolean
          salience: number
          scope_id: string
          sha: string
          slug: string
          superseded_by: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body_md?: string
          created_at?: string
          embedding?: string | null
          frontmatter?: Json
          last_used_at?: string | null
          path: string
          pinned?: boolean
          salience?: number
          scope_id: string
          sha: string
          slug: string
          superseded_by?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          body_md?: string
          created_at?: string
          embedding?: string | null
          frontmatter?: Json
          last_used_at?: string | null
          path?: string
          pinned?: boolean
          salience?: number
          scope_id?: string
          sha?: string
          slug?: string
          superseded_by?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      mol_edge: {
        Row: {
          confidence: number
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          dst_id: string
          dst_kind: string
          id: string
          pending_approval: boolean
          predicate: string
          scope_id: string
          source: string
          src_id: string
          src_kind: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          dst_id: string
          dst_kind: string
          id?: string
          pending_approval?: boolean
          predicate: string
          scope_id: string
          source: string
          src_id: string
          src_kind: string
        }
        Update: {
          confidence?: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          dst_id?: string
          dst_kind?: string
          id?: string
          pending_approval?: boolean
          predicate?: string
          scope_id?: string
          source?: string
          src_id?: string
          src_kind?: string
        }
        Relationships: []
      }
      mol_entities: {
        Row: {
          body_md: string
          created_at: string
          embedding: string | null
          entity_kind: string | null
          frontmatter: Json
          path: string
          scope_id: string
          sha: string
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          body_md?: string
          created_at?: string
          embedding?: string | null
          entity_kind?: string | null
          frontmatter?: Json
          path: string
          scope_id: string
          sha: string
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          body_md?: string
          created_at?: string
          embedding?: string | null
          entity_kind?: string | null
          frontmatter?: Json
          path?: string
          scope_id?: string
          sha?: string
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      mol_mocs: {
        Row: {
          body_md: string
          created_at: string
          frontmatter: Json
          path: string
          scope_id: string
          sha: string
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          body_md?: string
          created_at?: string
          frontmatter?: Json
          path: string
          scope_id: string
          sha: string
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          body_md?: string
          created_at?: string
          frontmatter?: Json
          path?: string
          scope_id?: string
          sha?: string
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      mol_sources: {
        Row: {
          body_md: string
          created_at: string
          frontmatter: Json
          path: string
          scope_id: string
          sha: string
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          body_md?: string
          created_at?: string
          frontmatter?: Json
          path: string
          scope_id: string
          sha: string
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          body_md?: string
          created_at?: string
          frontmatter?: Json
          path?: string
          scope_id?: string
          sha?: string
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      mol_synthesis: {
        Row: {
          body_md: string
          created_at: string
          frontmatter: Json
          path: string
          scope_id: string
          sha: string
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          body_md?: string
          created_at?: string
          frontmatter?: Json
          path: string
          scope_id: string
          sha: string
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          body_md?: string
          created_at?: string
          frontmatter?: Json
          path?: string
          scope_id?: string
          sha?: string
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      mol_temporal_node: {
        Row: {
          body: string
          created_at: string
          id: string
          level: number
          parent_id: string | null
          scope_id: string
          source_atom_ids: string[]
          superseded_by: string | null
          title: string
          ts_end: string
          ts_start: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          level: number
          parent_id?: string | null
          scope_id: string
          source_atom_ids?: string[]
          superseded_by?: string | null
          title: string
          ts_end: string
          ts_start: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          level?: number
          parent_id?: string | null
          scope_id?: string
          source_atom_ids?: string[]
          superseded_by?: string | null
          title?: string
          ts_end?: string
          ts_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "mol_temporal_node_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "mol_temporal_node"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mol_temporal_node_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "mol_temporal_node"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_notes: {
        Row: {
          body: string
          id: string
          scope: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string
          id?: string
          scope: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          id?: string
          scope?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      operator_tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          done: boolean
          due_at: string | null
          explanation: string | null
          explanation_generated_at: string | null
          id: string
          scope: string
          source: string
          source_session_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          done?: boolean
          due_at?: string | null
          explanation?: string | null
          explanation_generated_at?: string | null
          id?: string
          scope: string
          source?: string
          source_session_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          done?: boolean
          due_at?: string | null
          explanation?: string | null
          explanation_generated_at?: string | null
          id?: string
          scope?: string
          source?: string
          source_session_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_tasks_source_session_id_fkey"
            columns: ["source_session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      org_templates: {
        Row: {
          blueprint: Json
          created_at: string
          id: string
          name: string
          niche: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          blueprint: Json
          created_at?: string
          id?: string
          name: string
          niche?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          blueprint?: Json
          created_at?: string
          id?: string
          name?: string
          niche?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      plan_patterns: {
        Row: {
          created_at: string
          goal: string
          goal_keywords: string
          id: string
          outcome_score: number
          phase_count: number
          plan: Json
          run_id: string | null
          task_count: number
          token_cost_usd: number
          user_id: string
        }
        Insert: {
          created_at?: string
          goal: string
          goal_keywords: string
          id?: string
          outcome_score?: number
          phase_count?: number
          plan: Json
          run_id?: string | null
          task_count?: number
          token_cost_usd?: number
          user_id: string
        }
        Update: {
          created_at?: string
          goal?: string
          goal_keywords?: string
          id?: string
          outcome_score?: number
          phase_count?: number
          plan?: Json
          run_id?: string | null
          task_count?: number
          token_cost_usd?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_patterns_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          business_id: string | null
          created_at: string | null
          id: string
          status: string | null
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          business_id?: string | null
          created_at?: string | null
          id?: string
          status?: string | null
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          business_id?: string | null
          created_at?: string | null
          id?: string
          status?: string | null
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_templates: {
        Row: {
          avg_quality_score: number
          created_at: string
          description: string | null
          format: string
          id: string
          name: string
          neuro_score: number
          tags: string[]
          template: string
          updated_at: string
          usage_count: number
          user_id: string
          variables: string[]
        }
        Insert: {
          avg_quality_score?: number
          created_at?: string
          description?: string | null
          format?: string
          id?: string
          name: string
          neuro_score?: number
          tags?: string[]
          template: string
          updated_at?: string
          usage_count?: number
          user_id: string
          variables?: string[]
        }
        Update: {
          avg_quality_score?: number
          created_at?: string
          description?: string | null
          format?: string
          id?: string
          name?: string
          neuro_score?: number
          tags?: string[]
          template?: string
          updated_at?: string
          usage_count?: number
          user_id?: string
          variables?: string[]
        }
        Relationships: []
      }
      reasoning_patterns: {
        Row: {
          agent_role: string
          approved: boolean
          created_at: string
          duration_ms: number
          id: string
          model: string
          prompt_hash: string
          result_quality: number
          task_hash: string
          task_type: string
          tokens_used: number
        }
        Insert: {
          agent_role: string
          approved?: boolean
          created_at?: string
          duration_ms?: number
          id?: string
          model: string
          prompt_hash: string
          result_quality?: number
          task_hash: string
          task_type: string
          tokens_used?: number
        }
        Update: {
          agent_role?: string
          approved?: boolean
          created_at?: string
          duration_ms?: number
          id?: string
          model?: string
          prompt_hash?: string
          result_quality?: number
          task_hash?: string
          task_type?: string
          tokens_used?: number
        }
        Relationships: []
      }
      revenue_events: {
        Row: {
          amount_usd: number
          created_at: string
          description: string | null
          id: string
          metadata: Json | null
          source: string
        }
        Insert: {
          amount_usd: number
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          source?: string
        }
        Update: {
          amount_usd?: number
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          source?: string
        }
        Relationships: []
      }
      run_events: {
        Row: {
          created_at: string
          goal_id: string | null
          id: string
          issue_id: string | null
          kind: string
          payload: Json
          run_id: string
        }
        Insert: {
          created_at?: string
          goal_id?: string | null
          id?: string
          issue_id?: string | null
          kind: string
          payload?: Json
          run_id: string
        }
        Update: {
          created_at?: string
          goal_id?: string | null
          id?: string
          issue_id?: string | null
          kind?: string
          payload?: Json
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      runs: {
        Row: {
          created_at: string
          cursor: Json
          id: string
          idea_id: string | null
          metrics: Json
          phase: string
          project_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          cursor?: Json
          id?: string
          idea_id?: string | null
          metrics?: Json
          phase?: string
          project_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          cursor?: Json
          id?: string
          idea_id?: string | null
          metrics?: Json
          phase?: string
          project_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      schema_migrations: {
        Row: {
          applied_at: string
          filename: string
        }
        Insert: {
          applied_at?: string
          filename: string
        }
        Update: {
          applied_at?: string
          filename?: string
        }
        Relationships: []
      }
      signal_evaluations: {
        Row: {
          created_at: string
          id: string
          model: string | null
          reasoning: string
          role: string
          signal_id: string
          user_id: string
          verdict: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          model?: string | null
          reasoning: string
          role: string
          signal_id: string
          user_id: string
          verdict?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          model?: string | null
          reasoning?: string
          role?: string
          signal_id?: string
          user_id?: string
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signal_evaluations_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          body: string
          created_at: string
          decided_at: string | null
          decided_reason: string | null
          id: string
          kind: string
          status: string
          title: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          decided_at?: string | null
          decided_reason?: string | null
          id?: string
          kind: string
          status?: string
          title: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          decided_at?: string | null
          decided_reason?: string | null
          id?: string
          kind?: string
          status?: string
          title?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      skill_definitions: {
        Row: {
          avg_quality_score: number
          created_at: string
          description: string | null
          id: string
          input_schema: Json
          mcp_tool_name: string
          name: string
          output_schema: Json
          requires_openclaw: boolean
          risk_level: string
          tags: string[]
          updated_at: string
          usage_count: number
          user_id: string
        }
        Insert: {
          avg_quality_score?: number
          created_at?: string
          description?: string | null
          id?: string
          input_schema?: Json
          mcp_tool_name: string
          name: string
          output_schema?: Json
          requires_openclaw?: boolean
          risk_level?: string
          tags?: string[]
          updated_at?: string
          usage_count?: number
          user_id: string
        }
        Update: {
          avg_quality_score?: number
          created_at?: string
          description?: string | null
          id?: string
          input_schema?: Json
          mcp_tool_name?: string
          name?: string
          output_schema?: Json
          requires_openclaw?: boolean
          risk_level?: string
          tags?: string[]
          updated_at?: string
          usage_count?: number
          user_id?: string
        }
        Relationships: []
      }
      swarm_runs: {
        Row: {
          budget_usd: number | null
          completed_at: string | null
          consensus_type: string
          context: string | null
          created_at: string
          current_phase: number
          error: string | null
          goal: string
          id: string
          phases: Json
          queen_type: string
          status: string
          total_cost_usd: number
          total_tokens: number
          updated_at: string
        }
        Insert: {
          budget_usd?: number | null
          completed_at?: string | null
          consensus_type?: string
          context?: string | null
          created_at?: string
          current_phase?: number
          error?: string | null
          goal: string
          id?: string
          phases?: Json
          queen_type?: string
          status?: string
          total_cost_usd?: number
          total_tokens?: number
          updated_at?: string
        }
        Update: {
          budget_usd?: number | null
          completed_at?: string | null
          consensus_type?: string
          context?: string | null
          created_at?: string
          current_phase?: number
          error?: string | null
          goal?: string
          id?: string
          phases?: Json
          queen_type?: string
          status?: string
          total_cost_usd?: number
          total_tokens?: number
          updated_at?: string
        }
        Relationships: []
      }
      swarm_tasks: {
        Row: {
          created_at: string
          description: string
          duration_ms: number | null
          id: string
          model: string | null
          phase: number
          result: string | null
          role: string
          status: string
          swarm_id: string
          title: string
          tokens_used: number | null
          updated_at: string
          votes: Json | null
        }
        Insert: {
          created_at?: string
          description: string
          duration_ms?: number | null
          id?: string
          model?: string | null
          phase?: number
          result?: string | null
          role: string
          status?: string
          swarm_id: string
          title: string
          tokens_used?: number | null
          updated_at?: string
          votes?: Json | null
        }
        Update: {
          created_at?: string
          description?: string
          duration_ms?: number | null
          id?: string
          model?: string | null
          phase?: number
          result?: string | null
          role?: string
          status?: string
          swarm_id?: string
          title?: string
          tokens_used?: number | null
          updated_at?: string
          votes?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "swarm_tasks_swarm_id_fkey"
            columns: ["swarm_id"]
            isOneToOne: false
            referencedRelation: "swarm_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          asset_url: string | null
          assignee: string | null
          business_slug: string | null
          column_id: string
          created_at: string
          depends_on: string[]
          description: string
          id: string
          idea_id: string | null
          milestone_id: string | null
          position: number
          priority: string
          project_id: string | null
          revision_note: string | null
          run_id: string | null
          task_type: string
          title: string
          updated_at: string
        }
        Insert: {
          asset_url?: string | null
          assignee?: string | null
          business_slug?: string | null
          column_id?: string
          created_at?: string
          depends_on?: string[]
          description?: string
          id?: string
          idea_id?: string | null
          milestone_id?: string | null
          position?: number
          priority?: string
          project_id?: string | null
          revision_note?: string | null
          run_id?: string | null
          task_type?: string
          title: string
          updated_at?: string
        }
        Update: {
          asset_url?: string | null
          assignee?: string | null
          business_slug?: string | null
          column_id?: string
          created_at?: string
          depends_on?: string[]
          description?: string
          id?: string
          idea_id?: string | null
          milestone_id?: string | null
          position?: number
          priority?: string
          project_id?: string | null
          revision_note?: string | null
          run_id?: string | null
          task_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          agent_spec_path: string | null
          borrowed_from_team_id: string | null
          created_at: string
          ecosystem_overrides: Json
          id: string
          role_slug: string
          team_id: string
          tool_budget: string[]
          tool_budget_override: string[] | null
        }
        Insert: {
          agent_spec_path?: string | null
          borrowed_from_team_id?: string | null
          created_at?: string
          ecosystem_overrides?: Json
          id?: string
          role_slug: string
          team_id: string
          tool_budget?: string[]
          tool_budget_override?: string[] | null
        }
        Update: {
          agent_spec_path?: string | null
          borrowed_from_team_id?: string | null
          created_at?: string
          ecosystem_overrides?: Json
          id?: string
          role_slug?: string
          team_id?: string
          tool_budget?: string[]
          tool_budget_override?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "team_members_borrowed_from_team_id_fkey"
            columns: ["borrowed_from_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          business_slug: string | null
          created_at: string
          department_slug: string
          ecosystem_bindings: Json
          expires_at: string | null
          id: string
          parent_team_id: string | null
          status: string
          template_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          business_slug?: string | null
          created_at?: string
          department_slug: string
          ecosystem_bindings?: Json
          expires_at?: string | null
          id?: string
          parent_team_id?: string | null
          status?: string
          template_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          business_slug?: string | null
          created_at?: string
          department_slug?: string
          ecosystem_bindings?: Json
          expires_at?: string | null
          id?: string
          parent_team_id?: string | null
          status?: string
          template_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_parent_team_id_fkey"
            columns: ["parent_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "org_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      token_events: {
        Row: {
          agent_id: string | null
          business_slug: string | null
          cost_usd: number
          created_at: string
          id: string
          input_tokens: number
          model: string
          output_tokens: number
          user_id: string | null
        }
        Insert: {
          agent_id?: string | null
          business_slug?: string | null
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number
          model: string
          output_tokens?: number
          user_id?: string | null
        }
        Update: {
          agent_id?: string | null
          business_slug?: string | null
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "token_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_call_audit: {
        Row: {
          agent_slug: string | null
          approval_id: string | null
          args_redacted: Json | null
          business_slug: string | null
          goal_id: string | null
          id: string
          issue_id: string | null
          latency_ms: number | null
          mcp_server: string
          result_excerpt: string | null
          result_status: string | null
          run_id: string | null
          scope: string | null
          tool_name: string
          ts: string
          user_id: string | null
        }
        Insert: {
          agent_slug?: string | null
          approval_id?: string | null
          args_redacted?: Json | null
          business_slug?: string | null
          goal_id?: string | null
          id?: string
          issue_id?: string | null
          latency_ms?: number | null
          mcp_server: string
          result_excerpt?: string | null
          result_status?: string | null
          run_id?: string | null
          scope?: string | null
          tool_name: string
          ts?: string
          user_id?: string | null
        }
        Update: {
          agent_slug?: string | null
          approval_id?: string | null
          args_redacted?: Json | null
          business_slug?: string | null
          goal_id?: string | null
          id?: string
          issue_id?: string | null
          latency_ms?: number | null
          mcp_server?: string
          result_excerpt?: string | null
          result_status?: string | null
          run_id?: string | null
          scope?: string | null
          tool_name?: string
          ts?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_secrets: {
        Row: {
          created_at: string
          kind: string
          metadata: Json
          name: string
          updated_at: string
          user_id: string
          value: string
        }
        Insert: {
          created_at?: string
          kind: string
          metadata?: Json
          name: string
          updated_at?: string
          user_id: string
          value: string
        }
        Update: {
          created_at?: string
          kind?: string
          metadata?: Json
          name?: string
          updated_at?: string
          user_id?: string
          value?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          event_id: string
          metadata: Json | null
          processed_at: string
          source: string
        }
        Insert: {
          event_id: string
          metadata?: Json | null
          processed_at?: string
          source: string
        }
        Update: {
          event_id?: string
          metadata?: Json | null
          processed_at?: string
          source?: string
        }
        Relationships: []
      }
      workflow_changelog: {
        Row: {
          after_spec: string | null
          agent_slug: string | null
          applied_by: string
          before_spec: string | null
          created_at: string
          feedback_id: string | null
          id: string
          rationale: string | null
          target_path: string
          user_id: string
        }
        Insert: {
          after_spec?: string | null
          agent_slug?: string | null
          applied_by?: string
          before_spec?: string | null
          created_at?: string
          feedback_id?: string | null
          id?: string
          rationale?: string | null
          target_path: string
          user_id: string
        }
        Update: {
          after_spec?: string | null
          agent_slug?: string | null
          applied_by?: string
          before_spec?: string | null
          created_at?: string
          feedback_id?: string | null
          id?: string
          rationale?: string | null
          target_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_changelog_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "workflow_feedback"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_feedback: {
        Row: {
          agent_slug: string | null
          artifact_url: string | null
          card_id: string | null
          created_at: string
          feedback: string
          id: string
          resolved_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          agent_slug?: string | null
          artifact_url?: string | null
          card_id?: string | null
          created_at?: string
          feedback: string
          id?: string
          resolved_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          agent_slug?: string | null
          artifact_url?: string | null
          card_id?: string | null
          created_at?: string
          feedback?: string
          id?: string
          resolved_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_issue: {
        Args: {
          p_agent_slug?: string
          p_business_slug: string
          p_run_id: string
        }
        Returns: string
      }
      get_issue_ancestry: { Args: { p_issue_id: string }; Returns: Json }
      increment_agent_cost: {
        Args: { p_agent_id: string; p_cost: number; p_tokens: number }
        Returns: undefined
      }
      log_events_purge_older_than: { Args: { days: number }; Returns: number }
      mol_atoms_fts_search: {
        Args: {
          include_superseded?: boolean
          k: number
          q: string
          scope: string
        }
        Returns: {
          body_md: string
          last_used_at: string
          pinned: boolean
          rank: number
          salience: number
          scope_id: string
          slug: string
          title: string
        }[]
      }
      mol_atoms_vec_search: {
        Args: {
          embed: string
          include_superseded?: boolean
          k: number
          scope: string
        }
        Returns: {
          body_md: string
          distance: number
          last_used_at: string
          pinned: boolean
          salience: number
          scope_id: string
          slug: string
          title: string
        }[]
      }
      pg_exec: { Args: { p_params?: Json; p_sql: string }; Returns: Json }
      release_issue: {
        Args: { p_issue_id: string; p_run_id: string }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      webhook_events_purge_older_than: {
        Args: { days: number }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
