export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      feedback: {
        Row: {
          id: string;
          submitted_by: string;
          type: "bug" | "confusion" | "request";
          body: string;
          screenshot_url: string | null;
          screenshot_path: string | null;
          status: "new" | "triaged" | "planned" | "shipped" | "declined";
          tags: string[];
          merged_into: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          submitted_by: string;
          type?: "bug" | "confusion" | "request";
          body: string;
          screenshot_url?: string | null;
          screenshot_path?: string | null;
          status?: "new" | "triaged" | "planned" | "shipped" | "declined";
          tags?: string[];
          merged_into?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          submitted_by?: string;
          type?: "bug" | "confusion" | "request";
          body?: string;
          screenshot_url?: string | null;
          screenshot_path?: string | null;
          status?: "new" | "triaged" | "planned" | "shipped" | "declined";
          tags?: string[];
          merged_into?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "feedback_submitted_by_fkey";
            columns: ["submitted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "feedback_merged_into_fkey";
            columns: ["merged_into"];
            isOneToOne: false;
            referencedRelation: "feedback";
            referencedColumns: ["id"];
          },
        ];
      };
      feedback_comments: {
        Row: {
          id: string;
          feedback_id: string;
          author: string;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          feedback_id: string;
          author: string;
          body: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          feedback_id?: string;
          author?: string;
          body?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "feedback_comments_author_fkey";
            columns: ["author"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "feedback_comments_feedback_id_fkey";
            columns: ["feedback_id"];
            isOneToOne: false;
            referencedRelation: "feedback";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          email: string | null;
          is_admin: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          is_admin?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          is_admin?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      sessions: {
        Row: {
          id: string;
          tester_id: string;
          scheduled_at: string;
          status: "scheduled" | "completed" | "no_show" | "canceled";
          notes: string | null;
          owner: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tester_id: string;
          scheduled_at: string;
          status?: "scheduled" | "completed" | "no_show" | "canceled";
          notes?: string | null;
          owner: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          tester_id?: string;
          scheduled_at?: string;
          status?: "scheduled" | "completed" | "no_show" | "canceled";
          notes?: string | null;
          owner?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sessions_tester_id_fkey";
            columns: ["tester_id"];
            isOneToOne: false;
            referencedRelation: "testers";
            referencedColumns: ["id"];
          },
        ];
      };
      testers: {
        Row: {
          id: string;
          name: string;
          email: string;
          role: string | null;
          organization: string | null;
          status: "prospect" | "invited" | "active" | "inactive";
          source: string | null;
          notes: string | null;
          owner: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          email: string;
          role?: string | null;
          organization?: string | null;
          status?: "prospect" | "invited" | "active" | "inactive";
          source?: string | null;
          notes?: string | null;
          owner: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          email?: string;
          role?: string | null;
          organization?: string | null;
          status?: "prospect" | "invited" | "active" | "inactive";
          source?: string | null;
          notes?: string | null;
          owner?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      feedback_lock_triage_columns: {
        Args: Record<string, never>;
        Returns: unknown;
      };
      feedback_merge_guard: {
        Args: Record<string, never>;
        Returns: unknown;
      };
      handle_new_user: {
        Args: Record<string, never>;
        Returns: unknown;
      };
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      merge_feedback: {
        Args: { src: string; target: string };
        Returns: undefined;
      };
      touch_updated_at: {
        Args: Record<string, never>;
        Returns: unknown;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
