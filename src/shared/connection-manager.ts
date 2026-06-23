/**
 * Shared connection management infrastructure for self-managing platform clients.
 *
 * Encapsulates three cross-cutting concerns duplicated across wework, clawbot,
 * qq, and workbuddy clients:
 *
 * - **ReconnectManager**: jittered backoff scheduling with fatal→slow-probe mode
 * - **HeartbeatMonitor**: interval-based heartbeat / watchdog timer
 * - **StateManager**: state variable with change-notification callback
 */

import { createLogger } from '../logger.js';
import { jitteredDelay, SLOW_PROBE_MS } from './reconnect.js';

// ── ReconnectManager ─────────────────────────────────────────────

export interface ReconnectManagerConfig {
  /** Platform name used in log messages. */
  name: string;
  /**
   * Delay strategy:
   * - `{ mode: 'exponential', baseMs, maxMs, cap }` — exponential backoff
   *   `min(baseMs * 1.5^floor(attempt / cap), maxMs)`.
   * - `{ mode: 'stepped', delays }` — stepped array; last entry repeats.
   */
  backoff:
    | { mode: 'exponential'; baseMs: number; maxMs: number; cap?: number }
    | { mode: 'stepped'; delays: number[] };
  /**
   * After this many attempts the counter resets and retries continue
   * (avoids permanent disconnection). 0 = unlimited (no reset).
   */
  maxAttempts?: number;
  /** Callback invoked after the computed delay. */
  onReconnect: () => void | Promise<void>;
}

/**
 * Manages reconnection scheduling with jittered backoff and fatal→slow-probe.
 *
 * Replaces the duplicated `scheduleReconnect()` pattern across 4 client files:
 * timer cleanup, attempt counting, backoff computation, jitter, logging.
 */
export class ReconnectManager {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private _fatal = false;
  private _stopped = false;
  private readonly log;
  private readonly cfg: ReconnectManagerConfig;

  constructor(cfg: ReconnectManagerConfig) {
    this.cfg = cfg;
    this.log = createLogger(`${cfg.name}/Reconnect`);
  }

  get attemptCount(): number { return this.attempt; }
  get fatal(): boolean { return this._fatal; }
  get stopped(): boolean { return this._stopped; }

  /** Mark a fatal (auth) error — next scheduleReconnect uses slow-probe delay. */
  setFatal(value: boolean): void { this._fatal = value; }

  /** Reset attempt counter and fatal flag after a successful connection. */
  reset(): void {
    this.attempt = 0;
    this._fatal = false;
  }

  /**
   * Schedule a reconnect attempt.  Clears any pending timer, computes the
   * backoff delay (with jitter), and invokes `onReconnect` after the delay.
   */
  schedule(): void {
    this.clearTimer();
    if (this._stopped) return;

    const max = this.cfg.maxAttempts;
    if (max && max > 0 && this.attempt >= max) {
      this.log.warn(`Max reconnect attempts (${max}) reached, resetting counter`);
      this.attempt = 0;
    }

    const baseDelay = this.computeBaseDelay();
    const delay = this._fatal ? jitteredDelay(SLOW_PROBE_MS) : jitteredDelay(baseDelay);
    this.attempt++;

    const fatalTag = this._fatal ? ' [slow-probe]' : '';
    this.log.info(
      `Reconnecting in ${delay}ms (attempt ${this.attempt})${fatalTag}...`,
    );

    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.cfg.onReconnect();
      } catch (err) {
        this.log.warn(`Reconnect callback failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, delay);
  }

  /** Cancel any pending reconnect timer. */
  stop(): void {
    this._stopped = true;
    this.clearTimer();
  }

  /** Allow scheduling again (undo `stop`). */
  resume(): void {
    this._stopped = false;
  }

  private clearTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private computeBaseDelay(): number {
    const { backoff } = this.cfg;
    if (backoff.mode === 'exponential') {
      const cap = backoff.cap ?? 5;
      return Math.min(
        backoff.baseMs * Math.pow(1.5, Math.floor(this.attempt / cap)),
        backoff.maxMs,
      );
    }
    const { delays } = backoff;
    return delays[Math.min(this.attempt, delays.length - 1)];
  }
}

// ── HeartbeatMonitor ─────────────────────────────────────────────

/**
 * Manages a setInterval-based heartbeat or watchdog timer.
 *
 * Replaces duplicated `heartbeatTimer` / `watchdogTimer` patterns:
 * timer cleanup on re-start, clearInterval on stop.
 */
export class HeartbeatMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private _lastResponseTime = 0;

  get lastResponseTime(): number { return this._lastResponseTime; }

  /** Record that a response was received (for watchdog stale detection). */
  recordResponse(): void { this._lastResponseTime = Date.now(); }

  /**
   * Start a periodic callback.  Clears any existing timer first.
   * @param intervalMs  Interval in milliseconds.
   * @param onTick      Callback invoked on each tick.
   */
  start(intervalMs: number, onTick: () => void | Promise<void>): void {
    this.stop();
    this.timer = setInterval(() => {
      Promise.resolve(onTick()).catch(() => { /* swallow — handler logs */ });
    }, intervalMs);
  }

  /** Clear the heartbeat timer. */
  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /**
   * Watchdog convenience: returns true if more than `staleMs` have elapsed
   * since the last `recordResponse()` call.
   */
  isStale(staleMs: number): boolean {
    return this._lastResponseTime > 0 && Date.now() - this._lastResponseTime > staleMs;
  }
}

// ── StateManager ─────────────────────────────────────────────────

/**
 * Manages a connection state variable with change-notification callback.
 *
 * Replaces duplicated `connectionState` / `channelState` + `stateChangeHandler`
 * patterns across wework, clawbot, and workbuddy clients.
 */
export class StateManager<T extends string> {
  private _state: T;
  private onChange?: (state: T) => void;

  constructor(initialState: T) {
    this._state = initialState;
  }

  get current(): T { return this._state; }

  /** Register a callback invoked whenever the state changes. */
  setOnChange(handler: ((state: T) => void) | undefined): void {
    this.onChange = handler;
  }

  /** Transition to a new state and notify the callback if it changed. */
  set(newState: T): void {
    if (this._state === newState) return;
    this._state = newState;
    this.onChange?.(newState);
  }
}
