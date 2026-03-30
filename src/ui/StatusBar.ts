import * as vscode from 'vscode';
import { ConnectionState } from '../connection/DeviceConnection';

/**
 * Manages the status bar item showing connection state.
 * Click to connect/disconnect.
 */
export class StatusBar implements vscode.Disposable {
  private _item: vscode.StatusBarItem;

  constructor() {
    this._item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this._item.command = 'blinky.connect';
    this.update('disconnected');
    this._item.show();
  }

  update(state: ConnectionState, boardLabel?: string): void {
    switch (state) {
      case 'disconnected':
        this._item.text = '$(plug) Connect Board';
        this._item.tooltip = 'Click to connect to a MicroPython board';
        this._item.command = 'blinky.connect';
        this._item.backgroundColor = undefined;
        break;
      case 'connecting':
        this._item.text = '$(loading~spin) Connecting…';
        this._item.tooltip = 'Connecting to board…';
        this._item.command = undefined;
        this._item.backgroundColor = undefined;
        break;
      case 'connected':
        this._item.text = `$(check) ${boardLabel ?? 'MicroPython'}`;
        this._item.tooltip = `Connected to ${boardLabel ?? 'board'}. Click to disconnect.`;
        this._item.command = 'blinky.disconnect';
        this._item.backgroundColor = undefined;
        break;
      case 'error':
        this._item.text = '$(error) Connection Error';
        this._item.tooltip = 'Connection error. Click to reconnect.';
        this._item.command = 'blinky.connect';
        this._item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;
    }
  }

  dispose(): void {
    this._item.dispose();
  }
}
