import * as vscode from 'vscode';

/**
 * Show a user-friendly error with action buttons.
 * Pattern: What happened → Why → What to do.
 */
export async function showConnectionError(err: unknown, retryCommand?: string): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);

  let userMessage: string;
  const actions: string[] = [];

  if (msg.includes('Access denied') || msg.includes('Permission denied')) {
    userMessage = `Can't open the serial port - another program may be using it. Close any other serial monitors and try again.`;
    actions.push('Retry', 'Select Different Port');
  } else if (msg.includes('File not found') || msg.includes('No such file')) {
    userMessage = `Can't find the serial port. Is the board plugged in?`;
    actions.push('Retry', 'Select Different Port');
  } else if (msg.includes('Timeout')) {
    userMessage = `The board isn't responding. It may be running code or in a bad state. Try pressing the reset button.`;
    actions.push('Retry');
  } else {
    userMessage = `Connection failed: ${msg}`;
    actions.push('Retry', 'Select Different Port');
  }

  const choice = await vscode.window.showErrorMessage(userMessage, ...actions);
  if (choice === 'Retry' && retryCommand) {
    await vscode.commands.executeCommand(retryCommand);
  } else if (choice === 'Select Different Port') {
    await vscode.commands.executeCommand('blinky.selectPort');
  }
}

/**
 * Show a board execution error with helpful context.
 */
export async function showBoardError(stderr: string): Promise<void> {
  // Extract the last meaningful line from the traceback
  const lines = stderr.trim().split('\n');
  const errorLine = lines[lines.length - 1] || stderr;

  await vscode.window.showErrorMessage(
    `Board error: ${errorLine}`,
    'Dismiss',
  );
}
