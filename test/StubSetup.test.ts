import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { StubSetup } from '../src/onboarding/StubSetup';

function createMockContext(state: Record<string, any> = {}): vscode.ExtensionContext {
  const store = { ...state };
  return {
    globalState: {
      get: (key: string, defaultValue?: any) => store[key] ?? defaultValue,
      update: vi.fn(async (key: string, value: any) => { store[key] = value; }),
    },
  } as any;
}

describe('StubSetup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isPylanceInstalled', () => {
    it('returns true when Pylance extension exists', () => {
      vi.spyOn(vscode.extensions, 'getExtension')
        .mockImplementation((id: string) => {
          if (id === 'ms-python.vscode-pylance') return {} as any;
          return undefined;
        });

      const setup = new StubSetup(createMockContext());
      expect(setup.isPylanceInstalled()).toBe(true);
    });

    it('returns true when Python extension exists', () => {
      vi.spyOn(vscode.extensions, 'getExtension')
        .mockImplementation((id: string) => {
          if (id === 'ms-python.python') return {} as any;
          return undefined;
        });

      const setup = new StubSetup(createMockContext());
      expect(setup.isPylanceInstalled()).toBe(true);
    });

    it('returns false when neither extension is installed', () => {
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);

      const setup = new StubSetup(createMockContext());
      expect(setup.isPylanceInstalled()).toBe(false);
    });
  });

  describe('isStubsConfigured', () => {
    it('returns true when extraPaths contains micropython', () => {
      vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: (_key: string, defaultValue?: any) => {
          if (_key === 'extraPaths') return ['.vscode/stubs/micropython-esp32-stubs'];
          return defaultValue;
        },
      } as any);

      const setup = new StubSetup(createMockContext());
      expect(setup.isStubsConfigured()).toBe(true);
    });

    it('returns true when extraPaths contains stubs', () => {
      vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: (_key: string, defaultValue?: any) => {
          if (_key === 'extraPaths') return ['.vscode/stubs'];
          return defaultValue;
        },
      } as any);

      const setup = new StubSetup(createMockContext());
      expect(setup.isStubsConfigured()).toBe(true);
    });

    it('returns false when extraPaths is empty', () => {
      vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: (_key: string, defaultValue?: any) => {
          if (_key === 'extraPaths') return [];
          return defaultValue;
        },
      } as any);

      const setup = new StubSetup(createMockContext());
      expect(setup.isStubsConfigured()).toBe(false);
    });

    it('returns false for unrelated paths containing "stubs"', () => {
      vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: (_key: string, defaultValue?: any) => {
          if (_key === 'extraPaths') return ['/home/user/typestubs', '/project_stubs_old'];
          return defaultValue;
        },
      } as any);

      const setup = new StubSetup(createMockContext());
      expect(setup.isStubsConfigured()).toBe(false);
    });
  });

  describe('isDismissed / dismiss', () => {
    it('returns false by default', () => {
      const setup = new StubSetup(createMockContext());
      expect(setup.isDismissed()).toBe(false);
    });

    it('returns true after dismiss()', async () => {
      const ctx = createMockContext();
      const setup = new StubSetup(ctx);
      await setup.dismiss();
      expect(setup.isDismissed()).toBe(true);
    });
  });

  describe('promptIfNeeded', () => {
    it('does nothing when Pylance is not installed', async () => {
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);
      const showInfo = vi.spyOn(vscode.window, 'showInformationMessage');

      const setup = new StubSetup(createMockContext());
      await setup.promptIfNeeded();

      expect(showInfo).not.toHaveBeenCalled();
    });

    it('does nothing when stubs are already configured', async () => {
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue({} as any);
      vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: (_key: string) => {
          if (_key === 'extraPaths') return ['.vscode/stubs'];
          return undefined;
        },
      } as any);
      const showInfo = vi.spyOn(vscode.window, 'showInformationMessage');

      const setup = new StubSetup(createMockContext());
      await setup.promptIfNeeded();

      expect(showInfo).not.toHaveBeenCalled();
    });

    it('does nothing when previously dismissed', async () => {
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue({} as any);
      vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: (_key: string, defaultValue?: any) => {
          if (_key === 'extraPaths') return [];
          return defaultValue;
        },
      } as any);
      const showInfo = vi.spyOn(vscode.window, 'showInformationMessage');

      const setup = new StubSetup(createMockContext({ 'blinky.stubsDismissed': true }));
      await setup.promptIfNeeded();

      expect(showInfo).not.toHaveBeenCalled();
    });

    it('shows prompt when conditions are met', async () => {
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue({} as any);
      vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: (_key: string, defaultValue?: any) => {
          if (_key === 'extraPaths') return [];
          return defaultValue;
        },
      } as any);
      const showInfo = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as any);

      const setup = new StubSetup(createMockContext());
      await setup.promptIfNeeded();

      expect(showInfo).toHaveBeenCalledWith(
        expect.stringContaining('MicroPython stubs'),
        'Install Stubs',
        'Configure Manually',
        "Don't Show Again",
      );
    });
  });

  describe('forcePrompt', () => {
    it('shows "already configured" when stubs exist', async () => {
      vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: (_key: string, defaultValue?: any) => {
          if (_key === 'extraPaths') return ['.vscode/stubs'];
          return defaultValue;
        },
      } as any);
      const showInfo = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as any);

      const setup = new StubSetup(createMockContext());
      await setup.forcePrompt();

      expect(showInfo).toHaveBeenCalledWith('MicroPython stubs are already configured.');
    });

    it('warns when Pylance is not installed', async () => {
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);
      vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: (_key: string, defaultValue?: any) => {
          if (_key === 'extraPaths') return [];
          return defaultValue;
        },
      } as any);
      const showWarning = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined as any);

      const setup = new StubSetup(createMockContext());
      await setup.forcePrompt();

      expect(showWarning).toHaveBeenCalledWith(
        expect.stringContaining('Pylance'),
        'Install Anyway',
      );
    });

    it('shows prompt even if previously dismissed', async () => {
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue({} as any);
      vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: (_key: string, defaultValue?: any) => {
          if (_key === 'extraPaths') return [];
          return defaultValue;
        },
      } as any);
      const showInfo = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as any);

      const setup = new StubSetup(createMockContext({ 'blinky.stubsDismissed': true }));
      await setup.forcePrompt();

      expect(showInfo).toHaveBeenCalledWith(
        expect.stringContaining('MicroPython stubs'),
        'Install Stubs',
        'Configure Manually',
        "Don't Show Again",
      );
    });
  });
});
