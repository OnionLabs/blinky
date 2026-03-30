import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { OnboardingNotifications } from '../src/onboarding/Notifications';

function createMockContext(state: Record<string, any> = {}): vscode.ExtensionContext {
  const store = { ...state };
  return {
    globalState: {
      get: (key: string, defaultValue?: any) => store[key] ?? defaultValue,
      update: vi.fn(async (key: string, value: any) => { store[key] = value; }),
    },
  } as any;
}

describe('OnboardingNotifications', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('onFirstConnect', () => {
    it('shows notification on first connect', async () => {
      const showInfo = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as any);
      const ctx = createMockContext();
      const notif = new OnboardingNotifications(ctx);

      await notif.onFirstConnect();

      expect(showInfo).toHaveBeenCalledWith(
        expect.stringContaining('Connected!'),
        'Open REPL',
        'Got it',
      );
    });

    it('does not show notification on second connect', async () => {
      const showInfo = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as any);
      const ctx = createMockContext();
      const notif = new OnboardingNotifications(ctx);

      await notif.onFirstConnect();
      showInfo.mockClear();
      await notif.onFirstConnect();

      expect(showInfo).not.toHaveBeenCalled();
    });

    it('does not show if already marked', async () => {
      const showInfo = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as any);
      const ctx = createMockContext({ 'blinky.onboarding.firstConnect': true });
      const notif = new OnboardingNotifications(ctx);

      await notif.onFirstConnect();

      expect(showInfo).not.toHaveBeenCalled();
    });
  });

  describe('onFirstRun', () => {
    it('shows tip on first run', async () => {
      const showInfo = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as any);
      const notif = new OnboardingNotifications(createMockContext());

      await notif.onFirstRun();

      expect(showInfo).toHaveBeenCalledWith(expect.stringContaining('Shift+Enter'));
    });

    it('does not repeat', async () => {
      const showInfo = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as any);
      const notif = new OnboardingNotifications(createMockContext());

      await notif.onFirstRun();
      showInfo.mockClear();
      await notif.onFirstRun();

      expect(showInfo).not.toHaveBeenCalled();
    });
  });

  describe('onFirstSync', () => {
    it('shows tip on first sync', async () => {
      const showInfo = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as any);
      const notif = new OnboardingNotifications(createMockContext());

      await notif.onFirstSync();

      expect(showInfo).toHaveBeenCalledWith(expect.stringContaining('SHA-256'));
    });

    it('does not repeat', async () => {
      const showInfo = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as any);
      const notif = new OnboardingNotifications(createMockContext());

      await notif.onFirstSync();
      showInfo.mockClear();
      await notif.onFirstSync();

      expect(showInfo).not.toHaveBeenCalled();
    });
  });
});
