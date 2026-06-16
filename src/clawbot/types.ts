/**
 * ClawBot Types - WeChat iLink Bot API
 *
 * Matches the official iLink API protocol (POST + JSON body + Bearer token).
 * Reference: @tencent-weixin/openclaw-weixin, cc-wechat, claude-code-wechat-channel
 */

/** Connection state */
export type ClawBotState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

/** ClawBot configuration */
export interface ClawBotConfig {
  /** iLink API base URL (default: https://ilinkai.weixin.qq.com) */
  apiUrl: string;
  /** Bearer token for authentication */
  apiToken: string;
}

/** iLink message content item types */
export const enum MessageItemType {
  NONE = 0,
  TEXT = 1,
  IMAGE = 2,
  VOICE = 3,
  FILE = 4,
  VIDEO = 5,
}

/** Text content item */
export interface TextItem {
  text?: string;
}

/** Image content item */
export interface ImageItem {
  media?: { aes_key?: string; cdn_url?: string };
  width?: number;
  height?: number;
}

/** Voice content item */
export interface VoiceItem {
  text?: string; // server-side speech-to-text transcript
  media?: { aes_key?: string; cdn_url?: string };
  playtime?: number;
}

/** File content item */
export interface FileItem {
  file_name?: string;
  file_size?: number;
  media?: { aes_key?: string; cdn_url?: string };
}

/** Video content item */
export interface VideoItem {
  media?: { aes_key?: string; cdn_url?: string };
  duration_ms?: number;
}

/** A single content item in a message */
export interface MessageItem {
  type?: number;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
  ref_msg?: { title?: string; message_item?: MessageItem };
  msg_id?: string;
}

/** iLink message from getupdates */
export interface ILinkMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  /** 1=USER (inbound), 2=BOT (outbound) */
  message_type?: number;
  /** 0=NEW, 1=GENERATING, 2=FINISH */
  message_state?: number;
  item_list?: MessageItem[];
  /** Token required for sending replies to this conversation */
  context_token?: string;
  group_id?: string;
}

/** getupdates response */
export interface GetUpdatesResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: ILinkMessage[];
  /** Opaque cursor for next poll — pass back as-is */
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

/** sendmessage response */
export interface SendMessageResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
}
