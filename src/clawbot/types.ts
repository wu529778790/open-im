/**
 * ClawBot Types - WeChat iLink API
 */

/** Connection state */
export type ClawBotState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

/** ClawBot configuration */
export interface ClawBotConfig {
  /** iLink API base URL (default: http://127.0.0.1:26322) */
  apiUrl: string;
  /** Bearer token for authentication */
  apiToken: string;
}

/** Message from getupdates */
export interface ClawBotUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: string;
      name?: string;
    };
    chat?: {
      id: string;
      type?: string;
    };
    text?: string;
    date?: number;
  };
}

/** getupdates response */
export interface ClawBotUpdatesResponse {
  ok: boolean;
  result?: ClawBotUpdate[];
  error?: string;
}

/** sendmessage response */
export interface ClawBotSendResponse {
  ok: boolean;
  result?: {
    message_id: number;
  };
  error?: string;
}
