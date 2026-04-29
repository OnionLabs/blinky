/**
 * Detects MicroPython REPL prompts and state from incoming serial data.
 *
 * MicroPython prompt types:
 *   ">>> "  - normal REPL, ready for input
 *   "... "  - continuation line (inside block)
 *   "raw REPL; CTRL-B to exit\r\n>"  - raw REPL mode
 *   "paste mode; Ctrl-C to cancel, Ctrl-D to finish\r\n=== "  - paste mode
 */

export type PromptType = 'normal' | 'continuation' | 'raw' | 'paste' | 'none';

export interface ParseResult {
  /** The detected prompt type at the end of the buffer */
  prompt: PromptType;
  /** Output text before the prompt (to display to user) */
  output: string;
}

const NORMAL_PROMPT = '>>> ';
const CONTINUATION_PROMPT = '... ';
const RAW_PROMPT_SUFFIX = '\r\n>';
const RAW_PROMPT_MARKER = 'raw REPL; CTRL-B to exit';
const PASTE_PROMPT = '=== ';
const PASTE_MARKER = 'paste mode;';

export class ReplParser {
  private _buffer = '';
  private _flushTimer: ReturnType<typeof setTimeout> | undefined;
  private _onFlush: ((output: string) => void) | undefined;
  private _flushDelayMs: number;

  constructor(options: { flushDelayMs?: number } = {}) {
    this._flushDelayMs = options.flushDelayMs ?? 50;
  }

  /** Override the deferred-flush delay at runtime. */
  setFlushDelay(ms: number): void {
    if (Number.isFinite(ms) && ms >= 0) {
      this._flushDelayMs = ms;
    }
  }

  /**
   * Set a callback for deferred flushes (when buffered data
   * doesn't match any prompt after a short timeout).
   */
  set onDeferredFlush(cb: ((output: string) => void) | undefined) {
    this._onFlush = cb;
  }

  /**
   * Feed incoming data and detect prompts.
   * Returns parsed output and detected prompt state.
   */
  feed(data: string): ParseResult {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = undefined;
    }

    this._buffer += data;

    // Check for prompts at the end of the buffer
    if (this._buffer.endsWith(NORMAL_PROMPT)) {
      const output = this._buffer.slice(0, -NORMAL_PROMPT.length);
      this._buffer = '';
      return { prompt: 'normal', output };
    }

    if (this._buffer.endsWith(CONTINUATION_PROMPT)) {
      const output = this._buffer.slice(0, -CONTINUATION_PROMPT.length);
      this._buffer = '';
      return { prompt: 'continuation', output };
    }

    if (this._buffer.endsWith(RAW_PROMPT_SUFFIX) && this._buffer.includes(RAW_PROMPT_MARKER)) {
      const output = this._buffer.slice(0, this._buffer.lastIndexOf(RAW_PROMPT_MARKER));
      this._buffer = '';
      return { prompt: 'raw', output };
    }

    if (this._buffer.endsWith(PASTE_PROMPT) && this._buffer.includes(PASTE_MARKER)) {
      const output = this._buffer.slice(0, this._buffer.lastIndexOf(PASTE_MARKER));
      this._buffer = '';
      return { prompt: 'paste', output };
    }

    // No complete prompt yet - schedule a deferred flush.
    // In interactive mode, echoed characters arrive in small chunks
    // that can't form a prompt. Flush them after a short delay so the
    // user sees their typing immediately.
    if (this._buffer.length > 0 && this._onFlush) {
      this._flushTimer = setTimeout(() => {
        this._flushTimer = undefined;
        if (this._buffer.length > 0 && this._onFlush) {
          const output = this._buffer;
          this._buffer = '';
          this._onFlush(output);
        }
      }, this._flushDelayMs);
    }

    return { prompt: 'none', output: '' };
  }

  /**
   * Flush any remaining buffered data (e.g. on disconnect).
   */
  flush(): string {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = undefined;
    }
    const output = this._buffer;
    this._buffer = '';
    return output;
  }

  /**
   * Reset parser state.
   */
  reset(): void {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = undefined;
    }
    this._buffer = '';
  }
}
