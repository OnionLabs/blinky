import * as vscode from 'vscode';
import { DeviceConnection } from '../connection/DeviceConnection';
import { PromptType, ReplParser } from './ReplParser';

// ANSI color codes
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

/**
 * VS Code Pseudoterminal that provides an interactive MicroPython REPL.
 *
 * Data flow:
 *   Keyboard → handleInput() → serial transport → board
 *   Board → serial data event → write emitter → terminal display
 *
 * The terminal is pause/resume aware: when VS Code applies backpressure,
 * we buffer output and flush on resume.
 */
export class ReplTerminal implements vscode.Pseudoterminal {
  private _writeEmitter = new vscode.EventEmitter<string>();
  private _closeEmitter = new vscode.EventEmitter<number | void>();

  readonly onDidWrite: vscode.Event<string> = this._writeEmitter.event;
  readonly onDidClose: vscode.Event<number | void> = this._closeEmitter.event;

  private _connection: DeviceConnection;
  private _parser = new ReplParser();
  private _dataHandler: ((data: Buffer) => void) | undefined;
  private _stateHandler: ((state: string) => void) | undefined;
  private _disposed = false;
  private _paused = false;
  private _pauseBuffer: string[] = [];
  private _currentPrompt: PromptType = 'none';
  private _history: string[] = [];
  private _historyIndex = -1;
  private _currentLine = '';
  private _boardLine = '';
  private _globalState: vscode.Memento | undefined;

  constructor(connection: DeviceConnection, globalState?: vscode.Memento) {
    this._connection = connection;
    this._globalState = globalState;
    // Load persistent history
    if (globalState) {
      this._history = globalState.get<string[]>('blinky.replHistory', []);
    }
  }

  get currentPrompt(): PromptType {
    return this._currentPrompt;
  }

  /** Send raw data to the board, logging failures instead of silencing them. */
  private _sendRaw(data: string): void {
    this._connection.writeRaw(data).catch((err) => {
      if (!this._disposed) {
        const msg = err instanceof Error ? err.message : String(err);
        this._write(`\r\n${ANSI.red}[serial write error: ${msg}]${ANSI.reset}\r\n`);
      }
    });
  }

  /**
   * Called by VS Code when the terminal is ready.
   */
  open(/* _initialDimensions */): void {
    const config = vscode.workspace.getConfiguration('blinky');

    // Rich welcome banner
    if (config.get<boolean>('repl.richBanner', true)) {
      const board = this._connection.boardInfo;
      const platform = board.platform?.toUpperCase() ?? 'Unknown';
      const version = board.version ?? '';
      this._write(`\r\n${ANSI.cyan}${ANSI.bold}  ⚡ MicroPython REPL${ANSI.reset}\r\n`);
      this._write(`${ANSI.gray}  ─────────────────────────────────${ANSI.reset}\r\n`);
      this._write(`${ANSI.dim}  Board:   ${ANSI.reset}${platform}\r\n`);
      if (version) {
        this._write(`${ANSI.dim}  Version: ${ANSI.reset}${version}\r\n`);
      }
      this._write(`${ANSI.dim}  Port:    ${ANSI.reset}${this._connection.portPath}\r\n`);
      this._write(`${ANSI.gray}  ─────────────────────────────────${ANSI.reset}\r\n`);
      this._write(`${ANSI.dim}  Ctrl-C${ANSI.reset} interrupt  ${ANSI.dim}Ctrl-D${ANSI.reset} reboot  ${ANSI.dim}Tab${ANSI.reset} complete  ${ANSI.dim}Ctrl-L${ANSI.reset} clear\r\n\r\n`);
    } else {
      this._write('\r\nMicroPython REPL - connected to ' + this._connection.portPath + '\r\n');
      this._write('Use Ctrl-C to interrupt, Ctrl-D to soft reboot\r\n\r\n');
    }

    // Handle deferred flush from the parser (echoed characters that
    // didn't form a complete prompt within the timeout)
    this._parser.onDeferredFlush = (text: string) => {
      if (!this._disposed) {
        this._write(this._sanitize(text));
      }
    };

    // Listen for data from the board
    this._dataHandler = (data: Buffer) => {
      const text = data.toString('utf-8');
      const result = this._parser.feed(text);

      if (result.output) {
        const pendingInput = this._currentLine;
        if (pendingInput.length > 0) {
          // Move cursor back over the typed text and clear to end of line
          this._write('\x08'.repeat(pendingInput.length) + '\x1b[K');
        }

        const colorize = config.get<boolean>('repl.colorizeErrors', true);
        this._write(this._sanitize(colorize ? this._colorizeOutput(result.output) : result.output));

        if (result.prompt !== 'none') {
          this._currentPrompt = result.prompt;
          this._writePrompt(result.prompt);
          // After a new prompt, reset the pending line
          this._currentLine = '';
          this._boardLine = '';
          this._historyIndex = -1;
        } else if (pendingInput.length > 0) {
          // No new prompt - restore the user's partial input
          this._write(pendingInput);
        }
      } else if (result.prompt !== 'none') {
        this._currentPrompt = result.prompt;
        this._writePrompt(result.prompt);
        this._currentLine = '';
        this._boardLine = '';
        this._historyIndex = -1;
      }
    };
    this._connection.on('data', this._dataHandler);

    // Handle disconnection - keep terminal open, show message
    this._stateHandler = (state: string) => {
      if (state === 'disconnected' || state === 'error') {
        this._write('\r\n\x1b[31m[Disconnected - board was reset or unplugged]\x1b[0m\r\n');
        this._write('\x1b[33mReconnect via the status bar or Cmd+Shift+P → blinky: Connect\x1b[0m\r\n');
      } else if (state === 'connected') {
        this._write('\r\n\x1b[32m[Reconnected]\x1b[0m\r\n');
        // Get a clean prompt
        this._sendRaw('\x03');
      }
    };
    this._connection.on('stateChanged', this._stateHandler);

    // Send a bare Enter to elicit a >>> prompt without interrupting any running script
    this._sendRaw('\r');
  }

  /**
   * Called by VS Code when the terminal is closed by the user.
   */
  close(): void {
    this._dispose();
  }

  /**
   * Handle user keyboard input.
   * VS Code sends individual characters or escape sequences.
   */
  handleInput(data: string): void {
    if (this._disposed) return;
    if (!this._connection.isConnected) {
      this._write(`\r\n${ANSI.yellow}[Not connected - reconnect first]${ANSI.reset}\r\n`);
      return;
    }

    const config = vscode.workspace.getConfiguration('blinky');

    if (data.length === 1) {
      const code = data.charCodeAt(0);

      // Ctrl-C - interrupt
      if (code === 3) {
        this._currentLine = '';
        this._boardLine = '';
        this._historyIndex = -1;
        this._sendRaw('\x03');
        return;
      }
      // Ctrl-D - soft reboot
      if (code === 4) {
        this._currentLine = '';
        this._boardLine = '';
        this._historyIndex = -1;
        this._sendRaw('\x04');
        return;
      }
      // Ctrl-E - paste mode
      if (code === 5) {
        this._sendRaw('\x05');
        return;
      }
      // Ctrl-L - clear screen
      if (code === 12) {
        this._write('\x1b[2J\x1b[H');
        this._writePrompt(this._currentPrompt);
        return;
      }
      // Backspace / Delete
      if (code === 127 || code === 8) {
        this._currentLine = this._currentLine.slice(0, -1);
        this._boardLine = this._boardLine.slice(0, -1);
        this._sendRaw('\x08');
        return;
      }
      // Tab - autocomplete via MicroPython
      if (code === 9 && config.get<boolean>('repl.autocomplete', true)) {
        this._sendRaw('\t');
        return;
      }
      // Enter - commit to history
      if (code === 13) {
        if (this._currentLine.trim()) {
          this._addToHistory(this._currentLine);
        }
        this._currentLine = '';
        this._boardLine = '';
        this._historyIndex = -1;
        this._sendRaw('\r');
        return;
      }

      // Regular character - accumulate for history
      this._currentLine += data;
      this._boardLine += data;
      this._sendRaw(data);
    } else {
      // Multi-byte input: check for arrow keys (history navigation)
      if (data === '\x1b[A') {
        // Up arrow - navigate history backward
        if (config.get<boolean>('repl.persistentHistory', true) && this._history.length > 0) {
          if (this._historyIndex < this._history.length - 1) {
            this._historyIndex++;
            const entry = this._history[this._history.length - 1 - this._historyIndex];
            this._replaceCurrentLine(entry);
            return;
          }
        }
        // Fall through to MicroPython's built-in history
        this._sendRaw(data);
      } else if (data === '\x1b[B') {
        // Down arrow - navigate history forward
        if (config.get<boolean>('repl.persistentHistory', true) && this._historyIndex >= 0) {
          this._historyIndex--;
          if (this._historyIndex < 0) {
            this._replaceCurrentLine('');
          } else {
            const entry = this._history[this._history.length - 1 - this._historyIndex];
            this._replaceCurrentLine(entry);
          }
          return;
        }
        this._sendRaw(data);
      } else {
        // Other escape sequences or pasted text - send atomically
        this._sendRaw(data);
      }
    }
  }

  private _addToHistory(line: string): void {
    // Don't add duplicates of the last entry
    if (this._history.length > 0 && this._history[this._history.length - 1] === line) return;
    this._history.push(line);
    // Cap at 500 entries
    if (this._history.length > 500) {
      this._history = this._history.slice(-500);
    }
    // Persist
    this._globalState?.update('blinky.replHistory', this._history);
  }

  private _replaceCurrentLine(newLine: string): void {
    // Send backspaces to erase what the board has, then send new text.
    // The board echoes everything, keeping display and line buffer in sync.
    const eraseBoard = '\x08'.repeat(this._boardLine.length);
    this._sendRaw(eraseBoard + newLine);
    this._currentLine = newLine;
    this._boardLine = newLine;
  }

  /**
   * VS Code terminal backpressure: pause output.
   */
  setDimensions?(/* _dimensions */): void {
    // Dimensions changed - no action needed
  }

  /**
   * Pause output (VS Code backpressure).
   */
  pause(): void {
    this._paused = true;
  }

  /**
   * Resume output after pause.
   */
  resume(): void {
    this._paused = false;
    if (this._pauseBuffer.length > 0) {
      const buffered = this._pauseBuffer.join('');
      this._pauseBuffer = [];
      this._pauseBufferSize = 0;
      this._writeEmitter.fire(buffered);
    }
  }

  /** Maximum bytes to buffer while paused (1 MB). Excess is discarded. */
  private static readonly MAX_PAUSE_BUFFER = 1024 * 1024;
  private _pauseBufferSize = 0;

  private _write(text: string): void {
    if (this._disposed) return;

    if (this._paused) {
      if (this._pauseBufferSize < ReplTerminal.MAX_PAUSE_BUFFER) {
        this._pauseBuffer.push(text);
        this._pauseBufferSize += text.length;
      }
    } else {
      this._writeEmitter.fire(text);
    }
  }

  /**
   * Convert raw board output to terminal-safe text.
   * Replaces bare \n with \r\n for proper terminal rendering.
   */
  private _sanitize(text: string): string {
    // Replace \n that isn't preceded by \r
    return text.replace(/(?<!\r)\n/g, '\r\n');
  }

  private _writePrompt(prompt: PromptType): void {
    const config = vscode.workspace.getConfiguration('blinky');
    const colorize = config.get<boolean>('repl.colorizePrompt', true);

    switch (prompt) {
      case 'normal':
        this._write(colorize ? `${ANSI.green}${ANSI.bold}>>> ${ANSI.reset}` : '>>> ');
        break;
      case 'continuation':
        this._write(colorize ? `${ANSI.yellow}... ${ANSI.reset}` : '... ');
        break;
      case 'paste':
        this._write(colorize ? `${ANSI.blue}=== ${ANSI.reset}` : '=== ');
        break;
      // raw prompt is intentionally not displayed
    }
  }

  /**
   * Colorize error output from MicroPython tracebacks.
   */
  private _colorizeOutput(text: string): string {
    return text.replace(
      /^(MicroPython v[\d.]+ on .+)$/gm,
      `${ANSI.cyan}$1${ANSI.reset}`,
    ).replace(
      /^(Traceback \(most recent call last\):)$/gm,
      `${ANSI.red}${ANSI.bold}$1${ANSI.reset}`,
    ).replace(
      /^( {2}File "[^"]*", line \d+.*)$/gm,
      `${ANSI.dim}$1${ANSI.reset}`,
    ).replace(
      /^(\w*Error: .+)$/gm,
      `${ANSI.red}$1${ANSI.reset}`,
    ).replace(
      /^(\w*Exception: .+)$/gm,
      `${ANSI.red}$1${ANSI.reset}`,
    );
  }

  private _dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    if (this._dataHandler) {
      this._connection.removeListener('data', this._dataHandler);
      this._dataHandler = undefined;
    }
    if (this._stateHandler) {
      this._connection.removeListener('stateChanged', this._stateHandler);
      this._stateHandler = undefined;
    }

    this._parser.onDeferredFlush = undefined;
    this._parser.reset();
    this._pauseBuffer = [];
    this._writeEmitter.dispose();
    this._closeEmitter.dispose();
  }
}

/**
 * Create and show a REPL terminal for the given connection.
 * Returns the Terminal instance for tracking.
 */
export function createReplTerminal(connection: DeviceConnection, globalState?: vscode.Memento): vscode.Terminal {
  const pty = new ReplTerminal(connection, globalState);
  const boardLabel = connection.boardInfo.platform?.toUpperCase() ?? 'MicroPython';

  const terminal = vscode.window.createTerminal({
    name: `REPL (${boardLabel})`,
    pty,
    iconPath: new vscode.ThemeIcon('terminal'),
  });

  terminal.show();
  return terminal;
}
