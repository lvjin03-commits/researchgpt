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
      chats: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          chat_id: string;
          user_id: string;
          role: string;
          content: string;
          attachments: Json | null;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          chat_id: string;
          user_id: string;
          role: string;
          content?: string;
          attachments?: Json | null;
          position: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          chat_id?: string;
          user_id?: string;
          role?: string;
          content?: string;
          attachments?: Json | null;
          position?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      research_workspaces: {
        Row: {
          user_id: string;
          projects: Json;
          active_project_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          projects?: Json;
          active_project_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          projects?: Json;
          active_project_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
