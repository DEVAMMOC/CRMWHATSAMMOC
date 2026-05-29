// packages/types/src/index.ts

export type UserRole = 'funcionario' | 'supervisor' | 'admin';

export type ConversationStatus = 'nao_salva' | 'pendente' | 'ativa' | 'encerrada';
export type ConversationSource = 'pessoal' | 'bot';

export type AttendanceStatus = 'aberto' | 'em_andamento' | 'transferido' | 'encerrado';

export type MessageDirection = 'in' | 'out';
export type MessageType = 'text' | 'image' | 'document' | 'audio' | 'video';

export type ContextFileType = 'json' | 'md' | 'index';
export type SyncStatus = 'success' | 'error' | 'pending';

export type BotProvider = 'evolution_go' | 'meta_cloud' | 'twilio';

export type IntegrationType = 'supabase' | 'drive' | 'projex' | 'enggov' | 'github' | 'custom';
export type IntegrationStatus = 'connected' | 'disconnected' | 'error';

export type RagSourceType = 'github' | 'supabase' | 'drive' | 'projex' | 'enggov' | 'webhook';

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  whatsapp_number: string | null;
  evolution_instance_id: string | null;
  evolution_instance_token: string | null;
  whatsapp_status: 'disconnected' | 'connecting' | 'connected';
  is_online: boolean;
  created_at: string;
}

export interface Conversation {
  id: string;
  owner_user_id: string;
  contact_number: string;
  contact_name: string;
  status: ConversationStatus;
  source: ConversationSource;
  municipality: string | null;
  trigger_keywords: string[];
  last_message_at: string | null;
  last_synced_at: string | null;
  shared_at: string | null;
  shared_by: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  content: string;
  message_type: MessageType;
  media_url: string | null;
  evolution_message_id: string | null;
  sent_at: string;
}

export interface Attendance {
  id: string;
  conversation_id: string;
  assigned_to: string;
  status: AttendanceStatus;
  municipality: string | null;
  summary: string | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
}

export interface AttendanceTransfer {
  id: string;
  attendance_id: string;
  from_user_id: string;
  to_user_id: string;
  note: string | null;
  transferred_at: string;
}

export interface ContextFile {
  id: string;
  conversation_id: string;
  file_type: ContextFileType;
  github_path: string | null;
  github_commit_sha: string | null;
  message_count: number;
  generated_at: string;
  status: SyncStatus;
  error_message: string | null;
  content: string | null;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
  attendance: Attendance | null;
}

export interface AttendanceWithDetails extends Attendance {
  conversation: Conversation;
  assigned_user: AppUser;
  transfers: AttendanceTransfer[];
}

export interface ApiResponse<T> {
  data: T;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
