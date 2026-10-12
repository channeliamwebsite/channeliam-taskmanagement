
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "activity_logs": {
                  Row: {
                    "action": Database["public"]['Enums']["activity_action"],"created_at": string,"id": string,"new_value": Json | null,"old_value": Json | null,"project_id": string | null,"task_id": string | null,"user_id": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": Database["public"]['Enums']["activity_action"],"created_at"?: string,"id"?: string,"new_value"?: Json | null,"old_value"?: Json | null,"project_id"?: string | null,"task_id"?: string | null,"user_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "action"?: Database["public"]['Enums']["activity_action"],"created_at"?: string,"id"?: string,"new_value"?: Json | null,"old_value"?: Json | null,"project_id"?: string | null,"task_id"?: string | null,"user_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_logs_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_logs_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_logs_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_logs_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"clients": {
                  Row: {
                    "contact_email": string | null,"contact_name": string | null,"created_at": string,"created_by": string | null,"id": string,"is_active": boolean,"name": string,"notes": string | null,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "contact_email"?: string | null,"contact_name"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"notes"?: string | null,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "contact_email"?: string | null,"contact_name"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"notes"?: string | null,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "clients_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"daily_reports": {
                  Row: {
                    "accomplishments": string | null,"blockers": string | null,"created_at": string,"id": string,"linked_task_ids": (string)[],"report_date": string,"tasks_blocked": number,"tasks_completed": number,"tasks_in_progress": number,"tomorrow_plan": string | null,"total_hours": number,"updated_at": string,"user_id": string,"work_remaining": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accomplishments"?: string | null,"blockers"?: string | null,"created_at"?: string,"id"?: string,"linked_task_ids"?: (string)[],"report_date"?: string,"tasks_blocked"?: number,"tasks_completed"?: number,"tasks_in_progress"?: number,"tomorrow_plan"?: string | null,"total_hours"?: number,"updated_at"?: string,"user_id"?: string,"work_remaining"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "accomplishments"?: string | null,"blockers"?: string | null,"created_at"?: string,"id"?: string,"linked_task_ids"?: (string)[],"report_date"?: string,"tasks_blocked"?: number,"tasks_completed"?: number,"tasks_in_progress"?: number,"tomorrow_plan"?: string | null,"total_hours"?: number,"updated_at"?: string,"user_id"?: string,"work_remaining"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "daily_reports_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "daily_reports_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "created_at": string,"id": string,"is_read": boolean,"message": string | null,"project_id": string | null,"read_at": string | null,"task_id": string | null,"title": string,"type": Database["public"]['Enums']["notification_type"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_read"?: boolean,"message"?: string | null,"project_id"?: string | null,"read_at"?: string | null,"task_id"?: string | null,"title": string,"type": Database["public"]['Enums']["notification_type"],"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_read"?: boolean,"message"?: string | null,"project_id"?: string | null,"read_at"?: string | null,"task_id"?: string | null,"title"?: string,"type"?: Database["public"]['Enums']["notification_type"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"department": string | null,"email": string | null,"full_name": string | null,"id": string,"is_active": boolean,"job_title": string | null,"manager_id": string | null,"role": Database["public"]['Enums']["user_role"],"team": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"department"?: string | null,"email"?: string | null,"full_name"?: string | null,"id": string,"is_active"?: boolean,"job_title"?: string | null,"manager_id"?: string | null,"role"?: Database["public"]['Enums']["user_role"],"team"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"department"?: string | null,"email"?: string | null,"full_name"?: string | null,"id"?: string,"is_active"?: boolean,"job_title"?: string | null,"manager_id"?: string | null,"role"?: Database["public"]['Enums']["user_role"],"team"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_manager_id_fkey"
      columns: ["manager_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "client_id": string | null,"client_name": string | null,"created_at": string,"created_by": string | null,"description": string | null,"due_date": string | null,"id": string,"name": string,"owner_id": string | null,"priority": Database["public"]['Enums']["priority_level"],"start_date": string | null,"status": Database["public"]['Enums']["project_status"],"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id"?: string | null,"client_name"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"due_date"?: string | null,"id"?: string,"name": string,"owner_id"?: string | null,"priority"?: Database["public"]['Enums']["priority_level"],"start_date"?: string | null,"status"?: Database["public"]['Enums']["project_status"],"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "client_id"?: string | null,"client_name"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"due_date"?: string | null,"id"?: string,"name"?: string,"owner_id"?: string | null,"priority"?: Database["public"]['Enums']["priority_level"],"start_date"?: string | null,"status"?: Database["public"]['Enums']["project_status"],"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"task_assignees": {
                  Row: {
                    "assigned_at": string,"assigned_by": string | null,"id": string,"is_primary": boolean,"task_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_at"?: string,"assigned_by"?: string | null,"id"?: string,"is_primary"?: boolean,"task_id": string,"user_id": string
                  }
                  Update: {
                    "assigned_at"?: string,"assigned_by"?: string | null,"id"?: string,"is_primary"?: boolean,"task_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_assignees_assigned_by_fkey"
      columns: ["assigned_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_assignees_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_assignees_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"task_attachments": {
                  Row: {
                    "created_at": string,"file_name": string,"file_size": number | null,"file_type": string | null,"file_url": string,"id": string,"task_id": string,"uploaded_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"file_name": string,"file_size"?: number | null,"file_type"?: string | null,"file_url": string,"id"?: string,"task_id": string,"uploaded_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"file_name"?: string,"file_size"?: number | null,"file_type"?: string | null,"file_url"?: string,"id"?: string,"task_id"?: string,"uploaded_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_attachments_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_attachments_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"task_comments": {
                  Row: {
                    "comment": string,"created_at": string,"id": string,"task_id": string,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "comment": string,"created_at"?: string,"id"?: string,"task_id": string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "comment"?: string,"created_at"?: string,"id"?: string,"task_id"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_comments_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_comments_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"task_dependencies": {
                  Row: {
                    "created_at": string,"dependency_type": Database["public"]['Enums']["dependency_type"],"depends_on_task_id": string,"id": string,"task_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"dependency_type"?: Database["public"]['Enums']["dependency_type"],"depends_on_task_id": string,"id"?: string,"task_id": string
                  }
                  Update: {
                    "created_at"?: string,"dependency_type"?: Database["public"]['Enums']["dependency_type"],"depends_on_task_id"?: string,"id"?: string,"task_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_dependencies_depends_on_task_id_fkey"
      columns: ["depends_on_task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_dependencies_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"tasks": {
                  Row: {
                    "actual_hours": number,"created_at": string,"created_by": string | null,"description": string | null,"due_date": string | null,"estimated_hours": number | null,"id": string,"parent_task_id": string | null,"priority": Database["public"]['Enums']["priority_level"],"progress": number,"project_id": string,"scheduled_date": string | null,"start_date": string | null,"status": Database["public"]['Enums']["task_status"],"task_type": Database["public"]['Enums']["task_type"],"title": string,"updated_at": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actual_hours"?: number,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"due_date"?: string | null,"estimated_hours"?: number | null,"id"?: string,"parent_task_id"?: string | null,"priority"?: Database["public"]['Enums']["priority_level"],"progress"?: number,"project_id": string,"scheduled_date"?: string | null,"start_date"?: string | null,"status"?: Database["public"]['Enums']["task_status"],"task_type"?: Database["public"]['Enums']["task_type"],"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "actual_hours"?: number,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"due_date"?: string | null,"estimated_hours"?: number | null,"id"?: string,"parent_task_id"?: string | null,"priority"?: Database["public"]['Enums']["priority_level"],"progress"?: number,"project_id"?: string,"scheduled_date"?: string | null,"start_date"?: string | null,"status"?: Database["public"]['Enums']["task_status"],"task_type"?: Database["public"]['Enums']["task_type"],"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tasks_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_parent_task_id_fkey"
      columns: ["parent_task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"time_entries": {
                  Row: {
                    "created_at": string,"description": string | null,"duration_minutes": number | null,"ended_at": string | null,"id": string,"started_at": string,"task_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"duration_minutes"?: number | null,"ended_at"?: string | null,"id"?: string,"started_at"?: string,"task_id": string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"duration_minutes"?: number | null,"ended_at"?: string | null,"id"?: string,"started_at"?: string,"task_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "time_entries_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "time_entries_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"workspace_members": {
                  Row: {
                    "can_create_projects": boolean,"created_at": string,"id": string,"user_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "can_create_projects"?: boolean,"created_at"?: string,"id"?: string,"user_id": string,"workspace_id": string
                  }
                  Update: {
                    "can_create_projects"?: boolean,"created_at"?: string,"id"?: string,"user_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workspace_members_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspaces": {
                  Row: {
                    "created_at": string,"created_by": string | null,"description": string | null,"id": string,"name": string,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"name": string,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"name"?: string,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspaces_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            "activity_action": "TASK_CREATED"|"TASK_UPDATED"|"TASK_ASSIGNED"|"TASK_UNASSIGNED"|"TASK_REASSIGNED"|"STATUS_CHANGED"|"PRIORITY_CHANGED"|"PROGRESS_CHANGED"|"DUE_DATE_CHANGED"|"TASK_COMPLETED"|"COMMENT_ADDED"|"ATTACHMENT_UPLOADED"|"PROJECT_CREATED"|"PROJECT_UPDATED"|"PROJECT_STATUS_CHANGED"|"TASK_SCHEDULED","dependency_type": "FINISH_TO_START"|"START_TO_START"|"FINISH_TO_FINISH"|"START_TO_FINISH","notification_type": "TASK_ASSIGNED"|"TASK_UNASSIGNED"|"TASK_DUE_SOON"|"TASK_OVERDUE"|"TASK_COMMENT"|"TASK_STATUS_CHANGED"|"TASK_COMPLETED"|"PROJECT_UPDATED"|"MENTION"|"SYSTEM","priority_level": "LOW"|"MEDIUM"|"HIGH"|"URGENT","project_status": "PLANNING"|"ACTIVE"|"ON_HOLD"|"COMPLETED"|"ARCHIVED","task_status": "TODO"|"IN_PROGRESS"|"IN_REVIEW"|"BLOCKED"|"COMPLETED"|"CANCELLED","task_type": "TASK"|"BUG"|"FEATURE"|"CONTENT"|"DESIGN"|"DEVELOPMENT"|"SEO"|"MARKETING"|"MEETING"|"OTHER","user_role": "SUPER_ADMIN"|"ADMIN"|"INDIVIDUAL"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "activity_action": ["TASK_CREATED", "TASK_UPDATED", "TASK_ASSIGNED", "TASK_UNASSIGNED", "TASK_REASSIGNED", "STATUS_CHANGED", "PRIORITY_CHANGED", "PROGRESS_CHANGED", "DUE_DATE_CHANGED", "TASK_COMPLETED", "COMMENT_ADDED", "ATTACHMENT_UPLOADED", "PROJECT_CREATED", "PROJECT_UPDATED", "PROJECT_STATUS_CHANGED", "TASK_SCHEDULED"],"dependency_type": ["FINISH_TO_START", "START_TO_START", "FINISH_TO_FINISH", "START_TO_FINISH"],"notification_type": ["TASK_ASSIGNED", "TASK_UNASSIGNED", "TASK_DUE_SOON", "TASK_OVERDUE", "TASK_COMMENT", "TASK_STATUS_CHANGED", "TASK_COMPLETED", "PROJECT_UPDATED", "MENTION", "SYSTEM"],"priority_level": ["LOW", "MEDIUM", "HIGH", "URGENT"],"project_status": ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"],"task_status": ["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "COMPLETED", "CANCELLED"],"task_type": ["TASK", "BUG", "FEATURE", "CONTENT", "DESIGN", "DEVELOPMENT", "SEO", "MARKETING", "MEETING", "OTHER"],"user_role": ["SUPER_ADMIN", "ADMIN", "INDIVIDUAL"]
          }
        }
} as const
