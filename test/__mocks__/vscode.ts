/**
 * Minimal mock of the vscode module for unit tests.
 * Only stubs what the test code actually touches.
 */
class EventEmitterMock<T> {
  private _listeners: Array<(e: T) => void> = [];

  event = (listener: (e: T) => void) => {
    this._listeners.push(listener);
    return { dispose: () => { this._listeners = this._listeners.filter(l => l !== listener); } };
  };

  fire(data: T): void {
    for (const listener of this._listeners) {
      listener(data);
    }
  }

  dispose(): void {
    this._listeners = [];
  }
}

export { EventEmitterMock as EventEmitter };

export class ThemeColor {
  constructor(public id: string) {}
}

export class ThemeIcon {
  constructor(public id: string) {}
}

export enum QuickPickItemKind {
  Separator = -1,
  Default = 0,
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  label: string;
  collapsibleState: TreeItemCollapsibleState;
  contextValue?: string;
  iconPath?: any;
  description?: string;
  tooltip?: string;
  command?: any;

  constructor(label: string, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState ?? TreeItemCollapsibleState.None;
  }
}

export enum ProgressLocation {
  Notification = 15,
  Window = 10,
  SourceControl = 1,
}

export class Uri {
  readonly fsPath: string;
  readonly scheme: string;
  private constructor(fsPath: string, scheme = 'file') {
    this.fsPath = fsPath;
    this.scheme = scheme;
  }
  static file(path: string) { return new Uri(path); }
  static joinPath(base: Uri, ...segments: string[]) {
    return new Uri(base.fsPath + '/' + segments.join('/'));
  }
  static parse(str: string) { return new Uri(str, str.includes(':') ? str.split(':')[0] : 'file'); }
  toString() { return this.fsPath; }
}

export class Range {
  constructor(
    public readonly startLine: number,
    public readonly startChar: number,
    public readonly endLine: number,
    public readonly endChar: number,
  ) {}
}

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class Selection {
  readonly anchor: Position;
  readonly active: Position;
  constructor(anchor: Position, active: Position) {
    this.anchor = anchor;
    this.active = active;
  }
  get isEmpty(): boolean {
    return this.anchor.line === this.active.line && this.anchor.character === this.active.character;
  }
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class Diagnostic {
  range: Range;
  message: string;
  severity: DiagnosticSeverity;
  source?: string;
  constructor(range: Range, message: string, severity?: DiagnosticSeverity) {
    this.range = range;
    this.message = message;
    this.severity = severity ?? DiagnosticSeverity.Error;
  }
}

export const window = {
  createTerminal: (_opts: any) => ({
    show: () => {},
    dispose: () => {},
  }),
  createTreeView: (_id: string, _opts: any) => ({
    dispose: () => {},
  }),
  createStatusBarItem: () => ({
    text: '',
    tooltip: '',
    command: undefined as string | undefined,
    backgroundColor: undefined,
    show: () => {},
    hide: () => {},
    dispose: () => {},
  }),
  createOutputChannel: (_name: string) => ({
    appendLine: () => {},
    dispose: () => {},
  }),
  showQuickPick: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showInformationMessage: async () => undefined,
  showInputBox: async () => undefined,
  showOpenDialog: async () => undefined,
  showSaveDialog: async () => undefined,
  showTextDocument: async () => {},
  withProgress: async (_opts: any, task: any) => {
    const cancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} }),
    };
    return task({ report: () => {} }, cancellationToken);
  },
  onDidCloseTerminal: () => ({ dispose: () => {} }),
};

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export const workspace = {
  getConfiguration: () => ({
    get: (_key: string, defaultValue?: any) => defaultValue,
  }),
  fs: {
    readFile: async () => Buffer.from(''),
    writeFile: async () => {},
    readDirectory: async (): Promise<[string, FileType][]> => [],
    stat: async () => { throw new Error('ENOENT'); },
    createDirectory: async () => {},
  },
  openTextDocument: async (_opts: any) => ({ getText: () => '' }),
  workspaceFolders: [{ uri: Uri.file('/workspace') }] as { uri: Uri }[] | undefined,
  createFileSystemWatcher: () => ({
    onDidChange: () => ({ dispose: () => {} }),
    onDidCreate: () => ({ dispose: () => {} }),
    onDidDelete: () => ({ dispose: () => {} }),
    dispose: () => {},
  }),
  onDidSaveTextDocument: () => ({ dispose: () => {} }),
  findFiles: async () => [] as Uri[],
};

export const languages = {
  createDiagnosticCollection: (_name: string) => {
    const map = new Map();
    return {
      set: (uri: any, diags: any[]) => map.set(uri, diags),
      get: (uri: any) => map.get(uri),
      delete: (uri: any) => map.delete(uri),
      clear: () => map.clear(),
      forEach: (cb: any) => map.forEach(cb),
      dispose: () => map.clear(),
      _map: map,
    };
  },
  setTextDocumentLanguage: async () => {},
};

export class RelativePattern {
  constructor(public base: any, public pattern: string) {}
}

export const commands = {
  executeCommand: async () => {},
  registerCommand: (_cmd: string, _cb: any) => ({ dispose: () => {} }),
};

export enum NotebookCellKind {
  Markup = 1,
  Code = 2,
}

export class NotebookCellData {
  kind: NotebookCellKind;
  value: string;
  languageId: string;
  outputs?: NotebookCellOutput[];

  constructor(kind: NotebookCellKind, value: string, languageId: string) {
    this.kind = kind;
    this.value = value;
    this.languageId = languageId;
  }
}

export class NotebookData {
  cells: NotebookCellData[];
  constructor(cells: NotebookCellData[]) {
    this.cells = cells;
  }
}

export class NotebookCellOutputItem {
  mime: string;
  data: Uint8Array;
  constructor(data: Uint8Array, mime: string) {
    this.data = data;
    this.mime = mime;
  }
  static stdout(text: string) {
    return new NotebookCellOutputItem(new TextEncoder().encode(text), 'application/vnd.code.notebook.stdout');
  }
  static stderr(text: string) {
    return new NotebookCellOutputItem(new TextEncoder().encode(text), 'application/vnd.code.notebook.stderr');
  }
}

export class NotebookCellOutput {
  items: NotebookCellOutputItem[];
  constructor(items: NotebookCellOutputItem[]) {
    this.items = items;
  }
}

export class CancellationTokenSource {
  token = {
    isCancellationRequested: false,
    onCancellationRequested: (_cb: () => void) => ({ dispose: () => {} }),
  };
  cancel() { this.token.isCancellationRequested = true; }
  dispose() {}
}

export const notebooks = {
  createNotebookController: (_id: string, _type: string, _label: string) => ({
    supportedLanguages: undefined as string[] | undefined,
    supportsExecutionOrder: false,
    description: '',
    executeHandler: undefined as any,
    interruptHandler: undefined as any,
    createNotebookCellExecution: (_cell: any) => ({
      executionOrder: 0,
      start: () => {},
      end: () => {},
      replaceOutput: () => {},
      token: {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => {} }),
      },
    }),
    dispose: () => {},
  }),
};

export const extensions = {
  getExtension: (_id: string) => undefined,
};

export const env = {
  openExternal: async (_uri: any) => true,
};

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}
