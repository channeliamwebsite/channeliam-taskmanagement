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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: Database["public"]["Enums"]["activity_action"]
          created_at: string
          id: string
          new_value: Json | null
          old_value: Json | null
          project_id: string | null
          target_user_id: string | null
          task_id: string | null
          user_id: string | null
          workspace_id: string | null
        }
        ComputedFields: never
        Insert: {
          action: Database["public"]["Enums"]["activity_action"]
          created_at?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          project_id?: string | null
          target_user_id?: string | null
          task_id?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["activity_action"]
          created_at?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          project_id?: string | null
          target_user_id?: string | null
          task_id?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          id: number
          record_id: string | null
          record_type: string
          target_user_id: string | null
          workspace_id: string | null
        }
        ComputedFields: never
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: never
          record_id?: string | null
          record_type: string
          target_user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: never
          record_id?: string | null
          record_type?: string
          target_user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_audit_log_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_audit_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_breaks: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          session_id: string
          started_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          session_id: string
          started_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          session_id?: string
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_breaks_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_breaks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_sessions: {
        Row: {
          check_in_at: string
          check_out_at: string | null
          created_at: string
          id: string
          user_id: string
          work_date: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          check_in_at?: string
          check_out_at?: string | null
          created_at?: string
          id?: string
          user_id: string
          work_date: string
          workspace_id: string
        }
        Update: {
          check_in_at?: string
          check_out_at?: string | null
          created_at?: string
          id?: string
          user_id?: string
          work_date?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bug_reports: {
        Row: {
          created_at: string
          description: string
          id: string
          page: string | null
          reported_by: string
          status: string
          steps: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          description: string
          id?: string
          page?: string | null
          reported_by?: string
          status?: string
          steps?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          page?: string | null
          reported_by?: string
          status?: string
          steps?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bug_reports_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          updated_at: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_reports: {
        Row: {
          accomplishments: string | null
          blockers: string | null
          created_at: string
          evening_snapshot: Json | null
          evening_submitted_at: string | null
          id: string
          linked_task_ids: string[]
          morning_generated_at: string | null
          morning_plan: string | null
          morning_snapshot: Json | null
          morning_submitted_at: string | null
          planned_task_ids: string[]
          report_date: string
          reporter_team: string | null
          tasks_blocked: number
          tasks_completed: number
          tasks_in_progress: number
          tomorrow_plan: string | null
          total_hours: number
          updated_at: string
          user_id: string
          work_remaining: string | null
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          accomplishments?: string | null
          blockers?: string | null
          created_at?: string
          evening_snapshot?: Json | null
          evening_submitted_at?: string | null
          id?: string
          linked_task_ids?: string[]
          morning_generated_at?: string | null
          morning_plan?: string | null
          morning_snapshot?: Json | null
          morning_submitted_at?: string | null
          planned_task_ids?: string[]
          report_date?: string
          reporter_team?: string | null
          tasks_blocked?: number
          tasks_completed?: number
          tasks_in_progress?: number
          tomorrow_plan?: string | null
          total_hours?: number
          updated_at?: string
          user_id?: string
          work_remaining?: string | null
          workspace_id: string
        }
        Update: {
          accomplishments?: string | null
          blockers?: string | null
          created_at?: string
          evening_snapshot?: Json | null
          evening_submitted_at?: string | null
          id?: string
          linked_task_ids?: string[]
          morning_generated_at?: string | null
          morning_plan?: string | null
          morning_snapshot?: Json | null
          morning_submitted_at?: string | null
          planned_task_ids?: string[]
          report_date?: string
          reporter_team?: string | null
          tasks_blocked?: number
          tasks_completed?: number
          tasks_in_progress?: number
          tomorrow_plan?: string | null
          total_hours?: number
          updated_at?: string
          user_id?: string
          work_remaining?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_employee_identity: {
        Row: {
          aadhaar_last4: string | null
          pan_ciphertext: string | null
          pan_key_version: number | null
          pan_last4: string | null
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        ComputedFields: never
        Insert: {
          aadhaar_last4?: string | null
          pan_ciphertext?: string | null
          pan_key_version?: number | null
          pan_last4?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          aadhaar_last4?: string | null
          pan_ciphertext?: string | null
          pan_key_version?: number | null
          pan_last4?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_employee_identity_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_employee_identity_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_employee_profiles: {
        Row: {
          address: string | null
          created_at: string
          date_of_birth: string | null
          employee_code: string
          employment_status: string
          employment_type: string
          gender: string | null
          joining_date: string | null
          personal_email: string | null
          phone: string | null
          photo_path: string | null
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        ComputedFields: never
        Insert: {
          address?: string | null
          created_at?: string
          date_of_birth?: string | null
          employee_code?: string
          employment_status?: string
          employment_type?: string
          gender?: string | null
          joining_date?: string | null
          personal_email?: string | null
          phone?: string | null
          photo_path?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          created_at?: string
          date_of_birth?: string | null
          employee_code?: string
          employment_status?: string
          employment_type?: string
          gender?: string | null
          joining_date?: string | null
          personal_email?: string | null
          phone?: string | null
          photo_path?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_employee_profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_employee_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_leave_allowances: {
        Row: {
          days: number
          leave_type: Database["public"]["Enums"]["hr_leave_type"]
          updated_at: string
          updated_by: string | null
          user_id: string
          year: number
        }
        ComputedFields: never
        Insert: {
          days: number
          leave_type: Database["public"]["Enums"]["hr_leave_type"]
          updated_at?: string
          updated_by?: string | null
          user_id: string
          year: number
        }
        Update: {
          days?: number
          leave_type?: Database["public"]["Enums"]["hr_leave_type"]
          updated_at?: string
          updated_by?: string | null
          user_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "hr_leave_allowances_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_leave_allowances_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_leave_applications: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          end_date: string
          id: string
          leave_type: Database["public"]["Enums"]["hr_leave_type"]
          reason: string
          rejection_reason: string | null
          start_date: string
          status: Database["public"]["Enums"]["hr_leave_status"]
          updated_at: string
          user_id: string
          working_days: number
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          end_date: string
          id?: string
          leave_type: Database["public"]["Enums"]["hr_leave_type"]
          reason: string
          rejection_reason?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["hr_leave_status"]
          updated_at?: string
          user_id: string
          working_days: number
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          end_date?: string
          id?: string
          leave_type?: Database["public"]["Enums"]["hr_leave_type"]
          reason?: string
          rejection_reason?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["hr_leave_status"]
          updated_at?: string
          user_id?: string
          working_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "hr_leave_applications_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_leave_applications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_leave_policies: {
        Row: {
          annual_allowance: number | null
          is_paid: boolean
          label: string
          leave_type: Database["public"]["Enums"]["hr_leave_type"]
          updated_at: string
          updated_by: string | null
          uses_balance: boolean
        }
        ComputedFields: never
        Insert: {
          annual_allowance?: number | null
          is_paid: boolean
          label: string
          leave_type: Database["public"]["Enums"]["hr_leave_type"]
          updated_at?: string
          updated_by?: string | null
          uses_balance: boolean
        }
        Update: {
          annual_allowance?: number | null
          is_paid?: boolean
          label?: string
          leave_type?: Database["public"]["Enums"]["hr_leave_type"]
          updated_at?: string
          updated_by?: string | null
          uses_balance?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "hr_leave_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_public_holidays: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          holiday_date: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
          updated_by: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          holiday_date: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          holiday_date?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_public_holidays_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_public_holidays_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_settings: {
        Row: {
          break_allowance_minutes: number
          id: boolean
          scheduled_minutes: number
          timezone: string
          updated_at: string
          updated_by: string | null
          weekly_off_days: number[]
        }
        ComputedFields: never
        Insert: {
          break_allowance_minutes?: number
          id?: boolean
          scheduled_minutes?: number
          timezone?: string
          updated_at?: string
          updated_by?: string | null
          weekly_off_days?: number[]
        }
        Update: {
          break_allowance_minutes?: number
          id?: boolean
          scheduled_minutes?: number
          timezone?: string
          updated_at?: string
          updated_by?: string | null
          weekly_off_days?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "hr_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_links: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string | null
          id: string
          is_active: boolean
          kind: string
          meeting_date: string | null
          schedule: string | null
          sort_order: number
          starts_at: string | null
          team: string | null
          title: string
          updated_at: string
          url: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          meeting_date?: string | null
          schedule?: string | null
          sort_order?: number
          starts_at?: string | null
          team?: string | null
          title: string
          updated_at?: string
          url: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          meeting_date?: string | null
          schedule?: string | null
          sort_order?: number
          starts_at?: string | null
          team?: string | null
          title?: string
          updated_at?: string
          url?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_participants: {
        Row: {
          added_at: string
          added_by: string | null
          meeting_link_id: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          added_at?: string
          added_by?: string | null
          meeting_link_id: string
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          meeting_link_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_participants_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_participants_meeting_link_id_fkey"
            columns: ["meeting_link_id"]
            isOneToOne: false
            referencedRelation: "meeting_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_records: {
        Row: {
          agenda: string | null
          created_at: string
          created_by: string | null
          decisions: string | null
          follow_up_task_ids: string[]
          id: string
          meeting_date: string
          meeting_link_id: string
          notes: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          agenda?: string | null
          created_at?: string
          created_by?: string | null
          decisions?: string | null
          follow_up_task_ids?: string[]
          id?: string
          meeting_date: string
          meeting_link_id: string
          notes?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          agenda?: string | null
          created_at?: string
          created_by?: string | null
          decisions?: string | null
          follow_up_task_ids?: string[]
          id?: string
          meeting_date?: string
          meeting_link_id?: string
          notes?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_records_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_records_meeting_link_id_fkey"
            columns: ["meeting_link_id"]
            isOneToOne: false
            referencedRelation: "meeting_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_records_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          meeting_link_id: string | null
          message: string | null
          project_id: string | null
          read_at: string | null
          reminder_date: string | null
          task_id: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          meeting_link_id?: string | null
          message?: string | null
          project_id?: string | null
          read_at?: string | null
          reminder_date?: string | null
          task_id?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          meeting_link_id?: string | null
          message?: string | null
          project_id?: string | null
          read_at?: string | null
          reminder_date?: string | null
          task_id?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          department: string | null
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          job_title: string | null
          manager_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          team: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          job_title?: string | null
          manager_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          team?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          job_title?: string | null
          manager_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          team?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_collaborators: {
        Row: {
          granted_at: string
          granted_by: string | null
          project_id: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          granted_at?: string
          granted_by?: string | null
          project_id: string
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_collaborators_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_collaborators_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_collaborators_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          client_id: string | null
          client_name: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          is_default: boolean
          name: string
          owner_id: string | null
          priority: Database["public"]["Enums"]["priority_level"]
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          client_id?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          is_default?: boolean
          name: string
          owner_id?: string | null
          priority?: Database["public"]["Enums"]["priority_level"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          client_id?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          is_default?: boolean
          name?: string
          owner_id?: string | null
          priority?: Database["public"]["Enums"]["priority_level"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          is_primary: boolean
          task_id: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          is_primary?: boolean
          task_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          is_primary?: boolean
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          task_id: string
          uploaded_by: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          file_name: string
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          task_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          task_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          comment: string
          created_at: string
          id: string
          task_id: string
          updated_at: string
          user_id: string | null
        }
        ComputedFields: never
        Insert: {
          comment: string
          created_at?: string
          id?: string
          task_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          comment?: string
          created_at?: string
          id?: string
          task_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          created_at: string
          dependency_type: Database["public"]["Enums"]["dependency_type"]
          depends_on_task_id: string
          id: string
          task_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          dependency_type?: Database["public"]["Enums"]["dependency_type"]
          depends_on_task_id: string
          id?: string
          task_id: string
        }
        Update: {
          created_at?: string
          dependency_type?: Database["public"]["Enums"]["dependency_type"]
          depends_on_task_id?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          actual_hours: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          estimated_hours: number | null
          id: string
          parent_task_id: string | null
          priority: Database["public"]["Enums"]["priority_level"]
          progress: number
          project_id: string
          scheduled_date: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["task_status"]
          task_type: Database["public"]["Enums"]["task_type"]
          title: string
          updated_at: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          actual_hours?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["priority_level"]
          progress?: number
          project_id: string
          scheduled_date?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_type?: Database["public"]["Enums"]["task_type"]
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          actual_hours?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["priority_level"]
          progress?: number
          project_id?: string
          scheduled_date?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_type?: Database["public"]["Enums"]["task_type"]
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
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
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          created_at: string
          description: string | null
          duration_minutes: number | null
          ended_at: string | null
          id: string
          started_at: string
          task_id: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          started_at?: string
          task_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          started_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          can_create_clients_projects: boolean
          can_create_projects: boolean
          created_at: string
          id: string
          user_id: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          can_create_clients_projects?: boolean
          can_create_projects?: boolean
          created_at?: string
          id?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          can_create_clients_projects?: boolean
          can_create_projects?: boolean
          created_at?: string
          id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          timezone: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      attendance_check_in: { Args: { p_workspace_id: string }; Returns: string }
      attendance_check_out: { Args: Record<PropertyKey, never>; Returns: string }
      attendance_end_break: { Args: Record<PropertyKey, never>; Returns: string }
      attendance_start_break: { Args: Record<PropertyKey, never>; Returns: string }
      create_task: {
        Args: {
          p_assignee_ids: string[]
          p_description?: string
          p_due_date?: string
          p_estimated_hours?: number
          p_parent_task_id?: string
          p_primary_assignee_id?: string
          p_priority?: Database["public"]["Enums"]["priority_level"]
          p_project_id: string
          p_scheduled_date?: string
          p_start_date?: string
          p_status?: Database["public"]["Enums"]["task_status"]
          p_task_type?: Database["public"]["Enums"]["task_type"]
          p_title: string
        }
        Returns: string
      }
      daily_tracking: {
        Args: { p_workspace_id: string }
        Returns: {
          assigned_at: string | null
          client_name: string | null
          completed_at: string | null
          due_date: string | null
          evening_submitted_at: string | null
          morning_generated_at: string | null
          morning_status: string | null
          priority: string | null
          project_name: string | null
          scheduled_date: string | null
          status: string | null
          task_id: string
          title: string
          tracking: string
          user_id: string
        }[]
      }
      get_client_contacts: {
        Args: { p_workspace_id: string }
        Returns: {
          contact_email: string
          contact_name: string
          id: string
        }[]
      }
      hr_apply_leave: { Args: { p_end: string; p_reason: string; p_start: string; p_type: Database["public"]["Enums"]["hr_leave_type"] }; Returns: string }
      hr_cancel_leave: { Args: { p_id: string }; Returns: undefined }
      hr_cl_credits: {
        Args: { p_user_id?: string }
        Returns: {
          credit_month: string
          expires_on: string
          status: string
        }[]
      }
      hr_decide_leave: { Args: { p_approve: boolean; p_id: string; p_rejection_reason?: string }; Returns: undefined }
      hr_leave_balance: {
        Args: { p_user_id?: string; p_year?: number }
        Returns: {
          allowance: number
          approved: number
          available: number
          leave_type: Database["public"]["Enums"]["hr_leave_type"]
          pending: number
        }[]
      }
      hr_log_pan_reveal: { Args: { p_reason: string; p_user_id: string }; Returns: undefined }
      hr_set_identity: { Args: { p_aadhaar_last4: string; p_pan_ciphertext: string; p_pan_key_version: number; p_pan_last4: string; p_update_aadhaar: boolean; p_update_pan: boolean; p_user_id: string }; Returns: undefined }
      hr_working_days: { Args: { p_end: string; p_start: string }; Returns: number }
      set_task_assignees: {
        Args: { p_primary_id?: string; p_task_id: string; p_user_ids: string[] }
        Returns: undefined
      }
      submit_evening_report: {
        Args: {
          p_accomplishments?: string
          p_blockers?: string
          p_linked_task_ids?: string[]
          p_tomorrow_plan?: string
          p_total_hours?: number
          p_work_remaining?: string
          p_workspace_id: string
        }
        Returns: string
      }
      submit_morning_plan: {
        Args: {
          p_notes?: string
          p_planned_task_ids?: string[]
          p_workspace_id: string
        }
        Returns: string
      }
    }
    Enums: {
      activity_action:
        | "TASK_CREATED"
        | "TASK_UPDATED"
        | "TASK_ASSIGNED"
        | "TASK_UNASSIGNED"
        | "TASK_REASSIGNED"
        | "STATUS_CHANGED"
        | "PRIORITY_CHANGED"
        | "PROGRESS_CHANGED"
        | "DUE_DATE_CHANGED"
        | "TASK_COMPLETED"
        | "COMMENT_ADDED"
        | "ATTACHMENT_UPLOADED"
        | "PROJECT_CREATED"
        | "PROJECT_UPDATED"
        | "PROJECT_STATUS_CHANGED"
        | "TASK_SCHEDULED"
        | "TASK_DELETED"
        | "PROJECT_DELETED"
        | "CLIENT_CREATED"
        | "CLIENT_UPDATED"
        | "CLIENT_DELETED"
        | "MEMBER_ADDED"
        | "MEMBER_REMOVED"
        | "MEMBER_PERMISSION_CHANGED"
        | "EMPLOYEE_ROLE_CHANGED"
        | "EMPLOYEE_DEACTIVATED"
        | "EMPLOYEE_REACTIVATED"
        | "EMPLOYEE_UPDATED"
        | "WORKSPACE_CREATED"
        | "WORKSPACE_UPDATED"
        | "COLLABORATOR_ADDED"
        | "COLLABORATOR_REMOVED"
      dependency_type:
        | "FINISH_TO_START"
        | "START_TO_START"
        | "FINISH_TO_FINISH"
        | "START_TO_FINISH"
      hr_leave_status:
        | "PENDING"
        | "APPROVED"
        | "REJECTED"
        | "CANCELLED"
      hr_leave_type:
        | "CL"
        | "LWP"
        | "WFH"
      notification_type:
        | "TASK_ASSIGNED"
        | "TASK_UNASSIGNED"
        | "TASK_DUE_SOON"
        | "TASK_OVERDUE"
        | "TASK_COMMENT"
        | "TASK_STATUS_CHANGED"
        | "TASK_COMPLETED"
        | "PROJECT_UPDATED"
        | "MENTION"
        | "SYSTEM"
        | "MEETING_SCHEDULED"
        | "MEETING_UPDATED"
        | "MEETING_CANCELLED"
      priority_level: "LOW" | "MEDIUM" | "HIGH" | "URGENT"
      project_status:
        | "PLANNING"
        | "ACTIVE"
        | "ON_HOLD"
        | "COMPLETED"
        | "ARCHIVED"
      task_status:
        | "TODO"
        | "IN_PROGRESS"
        | "IN_REVIEW"
        | "BLOCKED"
        | "COMPLETED"
        | "CANCELLED"
      task_type:
        | "TASK"
        | "BUG"
        | "FEATURE"
        | "CONTENT"
        | "DESIGN"
        | "DEVELOPMENT"
        | "SEO"
        | "MARKETING"
        | "MEETING"
        | "OTHER"
      user_role: "SUPER_ADMIN" | "ADMIN" | "INDIVIDUAL"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_action: [
        "TASK_CREATED",
        "TASK_UPDATED",
        "TASK_ASSIGNED",
        "TASK_UNASSIGNED",
        "TASK_REASSIGNED",
        "STATUS_CHANGED",
        "PRIORITY_CHANGED",
        "PROGRESS_CHANGED",
        "DUE_DATE_CHANGED",
        "TASK_COMPLETED",
        "COMMENT_ADDED",
        "ATTACHMENT_UPLOADED",
        "PROJECT_CREATED",
        "PROJECT_UPDATED",
        "PROJECT_STATUS_CHANGED",
        "TASK_SCHEDULED",
        "TASK_DELETED",
        "PROJECT_DELETED",
        "CLIENT_CREATED",
        "CLIENT_UPDATED",
        "CLIENT_DELETED",
        "MEMBER_ADDED",
        "MEMBER_REMOVED",
        "MEMBER_PERMISSION_CHANGED",
        "EMPLOYEE_ROLE_CHANGED",
        "EMPLOYEE_DEACTIVATED",
        "EMPLOYEE_REACTIVATED",
        "EMPLOYEE_UPDATED",
        "WORKSPACE_CREATED",
        "WORKSPACE_UPDATED",
        "COLLABORATOR_ADDED",
        "COLLABORATOR_REMOVED",
      ],
      dependency_type: [
        "FINISH_TO_START",
        "START_TO_START",
        "FINISH_TO_FINISH",
        "START_TO_FINISH",
      ],
      hr_leave_status: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"],
      hr_leave_type: ["CL", "LWP", "WFH"],
      notification_type: [
        "TASK_ASSIGNED",
        "TASK_UNASSIGNED",
        "TASK_DUE_SOON",
        "TASK_OVERDUE",
        "TASK_COMMENT",
        "TASK_STATUS_CHANGED",
        "TASK_COMPLETED",
        "PROJECT_UPDATED",
        "MENTION",
        "SYSTEM",
        "MEETING_SCHEDULED",
        "MEETING_UPDATED",
        "MEETING_CANCELLED",
      ],
      priority_level: ["LOW", "MEDIUM", "HIGH", "URGENT"],
      project_status: [
        "PLANNING",
        "ACTIVE",
        "ON_HOLD",
        "COMPLETED",
        "ARCHIVED",
      ],
      task_status: [
        "TODO",
        "IN_PROGRESS",
        "IN_REVIEW",
        "BLOCKED",
        "COMPLETED",
        "CANCELLED",
      ],
      task_type: [
        "TASK",
        "BUG",
        "FEATURE",
        "CONTENT",
        "DESIGN",
        "DEVELOPMENT",
        "SEO",
        "MARKETING",
        "MEETING",
        "OTHER",
      ],
      user_role: ["SUPER_ADMIN", "ADMIN", "INDIVIDUAL"],
    },
  },
} as const
