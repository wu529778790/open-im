/**
 * Unified session-invalid detection — consolidates all session-expiry
 * error patterns from codex, codebuddy, and opencode into one place.
 */

const SESSION_INVALID_PATTERNS = [
  'No session found',
  'No conversation found',
  'Unable to find session',
  'Session not found',
  'Invalid session',
  'Unable to resume',
  'session not found',
  'no sessions found',
  'session expired',
  'session corrupt',
];

export function isSessionInvalidMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return SESSION_INVALID_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}
