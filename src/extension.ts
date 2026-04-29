import * as vscode from 'vscode';
import { BoardDetector } from './board/BoardDetector';
import { BoardProfile } from './board/BoardProfile';
import { esp32Profile, esp8266Profile, rp2Profile } from './board/profiles';
import { DeviceConnection } from './connection/DeviceConnection';
import { PortDiscovery } from './connection/PortDiscovery';
import { AutoSync } from './filesystem/AutoSync';
import { BOARD_SCHEME, BoardContentProvider } from './filesystem/BoardContentProvider';
import { BoardFileSystem } from './filesystem/BoardFileSystem';
import { registerFileCommands } from './filesystem/FileCommands';
import { FileSync } from './filesystem/FileSync';
import { FileTreeProvider } from './filesystem/FileTreeProvider';
import { EspFlasher } from './flash/EspFlasher';
import { CHIP_BOARD_MAP, FirmwareCatalog } from './flash/FirmwareCatalog';
import { NOTEBOOK_TYPE, ReplNotebookController, ReplNotebookSerializer } from './notebook';
import { OnboardingNotifications } from './onboarding/Notifications';
import { StubSetup } from './onboarding/StubSetup';
import { openPendingScaffold, scaffoldProject } from './project/ProjectManager';
import { createReplTerminal } from './repl/ReplTerminal';
import { MicroPythonLinkProvider } from './repl/TerminalLinkProvider';
import { DiagnosticManager } from './run/DiagnosticParser';
import { ScriptRunner } from './run/ScriptRunner';
import { showConnectionError } from './ui/ErrorHelpers';
import { pickPort } from './ui/QuickPick';
import { StatusBar } from './ui/StatusBar';

let connection: DeviceConnection | undefined;
let replTerminal: vscode.Terminal | undefined;
let boardFs: BoardFileSystem | undefined;
let reconnectTimer: ReturnType<typeof setInterval> | undefined;
let lastPortPath: string | undefined;

/** Registered board profiles - ESP32 ships built-in, others can be added. */
const boardProfiles: BoardProfile[] = [esp32Profile, esp8266Profile, rp2Profile];

let portDiscovery: PortDiscovery;
const boardDetector = new BoardDetector(boardProfiles);

export function activate(context: vscode.ExtensionContext) {
	const outputChannel = vscode.window.createOutputChannel('blinky');
	outputChannel.appendLine('blinky activated');

	// Wire enumeration errors (eg. missing udev rules) into the output channel.
	portDiscovery = new PortDiscovery(boardProfiles, undefined, (msg) => outputChannel.appendLine(msg));

	const statusBar = new StatusBar();
	const autoSync = new AutoSync(() => boardFs, () => connection, outputChannel, () => fileTreeProvider.refresh());

	const fileTreeProvider = new FileTreeProvider();
	const treeView = vscode.window.createTreeView('blinky.boardFiles', {
		treeDataProvider: fileTreeProvider,
		showCollapseAll: true,
	});

	// Register clickable traceback links in REPL terminals
	const linkProvider = new MicroPythonLinkProvider();
	context.subscriptions.push(
		vscode.window.registerTerminalLinkProvider(linkProvider),
	);

	// Register notebook serializer + controller
	const notebookSerializer = new ReplNotebookSerializer();
	context.subscriptions.push(
		vscode.workspace.registerNotebookSerializer(NOTEBOOK_TYPE, notebookSerializer),
	);
	const notebookController = new ReplNotebookController(() => connection);
	context.subscriptions.push({ dispose: () => notebookController.dispose() });

	// Register virtual document provider for board file preview
	const boardContentProvider = new BoardContentProvider(() => boardFs);
	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(BOARD_SCHEME, boardContentProvider),
	);

	const diagnosticMgr = new DiagnosticManager();
	const scriptRunner = new ScriptRunner(diagnosticMgr, outputChannel);
	const stubSetup = new StubSetup(context);
	const onboarding = new OnboardingNotifications(context);

	const stopReconnect = () => {
		if (reconnectTimer) {
			clearInterval(reconnectTimer);
			reconnectTimer = undefined;
		}
	};

	const startReconnect = (portPath: string) => {
		stopReconnect();
		let attempts = 0;
		const maxAttempts = 30; // ~30 seconds

		outputChannel.appendLine(`Attempting to reconnect to ${portPath}…`);
		statusBar.update('connecting');

		reconnectTimer = setInterval(async () => {
			attempts++;
			if (attempts > maxAttempts) {
				stopReconnect();
				statusBar.update('disconnected');
				outputChannel.appendLine('Auto-reconnect timed out.');
				return;
			}

			// Check if the port is available
			const ports = await portDiscovery.listPorts();
			const found = ports.find((p) => p.path === portPath);
			if (!found) return;

			// Port is back - try to connect
			stopReconnect();
			try {
				await connectToPort(portPath);
			} catch {
				// Will show error via normal flow
			}
		}, 1000);
	};

	const connectToPort = async (portPath: string) => {
		const config = vscode.workspace.getConfiguration('blinky');
		const baudRate = config.get<number>('baudRate', 115200);

		stopReconnect();

		// Clean up previous connection and stale filesystem
		boardFs = undefined;
		fileTreeProvider.setFileSystem(undefined);
		if (replTerminal) {
			replTerminal.dispose();
			replTerminal = undefined;
		}
		if (connection) {
			connection.dispose();
		}

		lastPortPath = portPath;
		connection = new DeviceConnection({ path: portPath, baudRate });

		connection.on('stateChanged', (state) => {
			vscode.commands.executeCommand('setContext', 'blinky.connected', state === 'connected');
			if (state === 'disconnected') {
				statusBar.update('disconnected');
				// Cancel any running script; race against a short timeout so we
				// don't block reconnect logic if the board never settles.
				Promise.race([
					scriptRunner.cancel(),
					new Promise((r) => setTimeout(r, 500)),
				]).catch(() => { /* ignore */ });
				// Auto-reconnect if we were previously connected
				if (lastPortPath) {
					startReconnect(lastPortPath);
				}
			}
		});

		statusBar.update('connecting');
		try {
			await connection.connect();

			// Probe whether the board is idle or running a script
			const isIdle = await connection.probeIdle();

			let skipDetection = false;
			if (!isIdle) {
				const choice = await vscode.window.showWarningMessage(
					'A script appears to be running on the board. Interrupt it to enable board detection and features?',
					{ modal: true },
					'Interrupt',
					'Leave Running',
				);
				if (choice !== 'Interrupt') {
					skipDetection = true;
					// Try to load cached board info from previous session
					const cached = context.globalState.get<{ platform?: string; version?: string }>('blinky.boardInfo');
					if (cached) {
						connection.setBoardInfo(cached);
						stubSetup.setBoardPlatform(cached.platform);
						stubSetup.setBoardVersion(cached.version);
					}
				}
			}

			// Detect board type
			if (!skipDetection) {
				try {
					const info = await boardDetector.detect(connection);
					connection.setBoardInfo({ platform: info.platform, version: info.version });
					stubSetup.setBoardPlatform(info.platform);
					stubSetup.setBoardVersion(info.version);
					statusBar.update('connected', info.label);
					outputChannel.appendLine(`Connected to ${info.label} on ${portPath}`);
					// Cache board info for next time
					context.globalState.update('blinky.boardInfo', { platform: info.platform, version: info.version });
				} catch (err) {
					// Detection failed but connection is up
					const msg = err instanceof Error ? err.message : String(err);
					statusBar.update('connected');
					outputChannel.appendLine(`Connected to ${portPath} (board detection failed: ${msg})`);
				}
			} else {
				statusBar.update('connected', connection.boardInfo.platform
					? `${connection.boardInfo.platform.toUpperCase()} (cached)`
					: undefined);
				outputChannel.appendLine(`Connected to ${portPath} (script running, detection skipped)`);
			}

			// Store last used port
			context.globalState.update('blinky.lastPort', portPath);

			// Set up board filesystem
			boardFs = new BoardFileSystem(connection);
			fileTreeProvider.setFileSystem(boardFs);

			// Auto-open REPL terminal if configured (skip if script is running)
			if (!skipDetection) {
				const autoRepl = config.get<boolean>('autoOpenRepl', true);
				if (autoRepl) {
					openReplTerminal();
				}
			}

			// Onboarding: first-connect tip + stubs prompt
			onboarding.onFirstConnect();
			stubSetup.promptIfNeeded();
		} catch (err) {
			statusBar.update('error');
			await showConnectionError(err, 'blinky.connect');
		}
	};

	const openReplTerminal = () => {
		if (!connection?.isConnected) {
			vscode.window.showWarningMessage('Connect to a board first.', 'Connect').then((action) => {
				if (action === 'Connect') {
					vscode.commands.executeCommand('blinky.connect');
				}
			});
			return;
		}

		// Dispose previous REPL terminal if it exists
		if (replTerminal) {
			replTerminal.dispose();
			replTerminal = undefined;
		}

		replTerminal = createReplTerminal(connection, context.globalState);

		// Track terminal closure - self-disposing listener.
		// Also tracked in context.subscriptions so it's cleaned up on extension unload.
		let closeListener: vscode.Disposable | undefined;
		closeListener = vscode.window.onDidCloseTerminal((t) => {
			if (t === replTerminal) {
				replTerminal = undefined;
				closeListener?.dispose();
				closeListener = undefined;
			}
		});
		context.subscriptions.push({
			dispose: () => closeListener?.dispose(),
		});
	};

	/**
	 * Pick a port for flashing. Shows a picker with available ports,
	 * pre-selecting the currently connected port if any.
	 */
	const pickFlashPort = async (
		discovery: PortDiscovery,
		conn?: DeviceConnection,
	): Promise<string | undefined> => {
		const ports = await discovery.listPorts();
		if (ports.length === 0) {
			vscode.window.showWarningMessage('No serial ports found. Is the board plugged in?');
			return undefined;
		}

		const connectedPath = conn?.isConnected ? conn.portPath : undefined;
		const items = ports.map((p) => ({
			label: p.label,
			description: p.path === connectedPath ? '(connected)' : undefined,
			path: p.path,
			picked: p.path === connectedPath,
		}));

		// If only one port, skip the picker
		if (items.length === 1) return items[0].path;

		const choice = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select serial port for flashing',
		});
		return choice?.path;
	};

	/**
	 * Detect the chip on the given port and return the correct flash address.
	 * Falls back to prompting the user if detection fails or the chip is unknown.
	 * Returns undefined if the user cancels.
	 */
	const resolveFlashAddress = async (
		flasher: EspFlasher,
		portPath: string,
	): Promise<string | undefined> => {
		const boardInfoResult = await flasher.boardInfo(portPath);
		if ('info' in boardInfoResult) {
			const mapping = CHIP_BOARD_MAP[boardInfoResult.info.chip];
			if (mapping) return mapping.flashAddress;
			// Chip detected but not in our map
			return vscode.window.showInputBox({
				title: 'Flash Address',
				prompt: `Unknown chip "${boardInfoResult.info.chip}". Enter the flash address for this firmware.`,
				value: '0x0',
				validateInput: (v) => /^0x[0-9a-fA-F]+$/.test(v) ? undefined : 'Enter a hex address, e.g. 0x0 or 0x1000',
			});
		}
		// Detection failed entirely
		return vscode.window.showInputBox({
			title: 'Flash Address',
			prompt: 'Could not detect chip. Enter the flash address (0x1000 for ESP32, 0x0 for ESP32-S2/S3/C3/C6/H2).',
			value: '0x0',
			validateInput: (v) => /^0x[0-9a-fA-F]+$/.test(v) ? undefined : 'Enter a hex address, e.g. 0x0 or 0x1000',
		});
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('blinky.connect', async () => {
			// Try auto-detect first
			const autoPort = await portDiscovery.autoDetect();
			if (autoPort) {
				await connectToPort(autoPort.path);
				return;
			}

			// Fall back to port picker
			const port = await pickPort(portDiscovery);
			if (port) {
				await connectToPort(port.path);
			}
		}),

		vscode.commands.registerCommand('blinky.disconnect', async () => {
			stopReconnect();
			lastPortPath = undefined;
			boardFs = undefined;
			fileTreeProvider.setFileSystem(undefined);
			diagnosticMgr.clear();
			autoSync.disable();
			if (connection) {
				await connection.disconnect();
				connection.dispose();
				connection = undefined;
				statusBar.update('disconnected');
				outputChannel.appendLine('Disconnected');
			}
		}),

		vscode.commands.registerCommand('blinky.selectPort', async () => {
			const port = await pickPort(portDiscovery);
			if (port) {
				await connectToPort(port.path);
			}
		}),

		vscode.commands.registerCommand('blinky.openRepl', () => {
			openReplTerminal();
		}),

		vscode.commands.registerCommand('blinky.runFile', async () => {
			if (!connection?.isConnected || !boardFs) {
				vscode.window.showWarningMessage('Connect to a board first.');
				return;
			}

			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== 'python') {
				vscode.window.showWarningMessage('Open a Python file first.');
				return;
			}

			// Save the file before running
			if (editor.document.isDirty) {
				await editor.document.save();
			}

			await scriptRunner.runFile(connection, boardFs, editor.document.uri);
			onboarding.onFirstRun();
		}),

		vscode.commands.registerCommand('blinky.runSelection', async () => {
			if (!connection?.isConnected) {
				vscode.window.showWarningMessage('Connect to a board first.');
				return;
			}

			const editor = vscode.window.activeTextEditor;
			if (!editor) return;

			const selection = editor.selection;
			const code = selection.isEmpty
				? editor.document.lineAt(selection.active.line).text
				: editor.document.getText(selection);

			if (!code.trim()) return;

			await scriptRunner.runCode(connection, code, editor.document.uri);

			// Advance cursor to next line when running a single line
			if (selection.isEmpty) {
				const nextLine = Math.min(selection.active.line + 1, editor.document.lineCount - 1);
				const newPos = new vscode.Position(nextLine, 0);
				editor.selection = new vscode.Selection(newPos, newPos);
				editor.revealRange(new vscode.Range(newPos, newPos));
			}
		}),

		vscode.commands.registerCommand('blinky.stopScript', async () => {
			if (!connection?.isConnected) return;
			await scriptRunner.cancel();
		}),

		vscode.commands.registerCommand('blinky.syncProject', async () => {
			if (!connection?.isConnected || !boardFs) {
				vscode.window.showWarningMessage('Connect to a board first.');
				return;
			}

			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders?.length) {
				vscode.window.showWarningMessage('Open a workspace folder first.');
				return;
			}

			const sync = new FileSync(connection, boardFs);

			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Syncing project\u2026', cancellable: true },
				async (progress, token) => {
					progress.report({ message: 'Comparing files\u2026' });
					const plan = await sync.plan(workspaceFolders[0].uri);

					if (token.isCancellationRequested) return;

					if (plan.upload.length === 0 && plan.orphaned.length === 0 && plan.mkdirs.length === 0) {
						vscode.window.showInformationMessage('All files are up to date.');
						return;
					}

					// Ask about orphaned files
					let deleteOrphans = false;
					if (plan.orphaned.length > 0) {
						const answer = await vscode.window.showQuickPick(
							[
								{ label: 'Keep', description: `Keep ${plan.orphaned.length} extra file(s) on board`, picked: true },
								{ label: 'Delete', description: `Remove ${plan.orphaned.length} file(s) not in workspace` },
							],
							{ placeHolder: `${plan.orphaned.length} file(s) on board not in workspace` },
						);
						deleteOrphans = answer?.label === 'Delete';
					}

					if (token.isCancellationRequested) return;

					const result = await sync.execute(plan, { deleteOrphans }, progress);

					const parts = [];
					if (result.uploaded > 0) parts.push(`${result.uploaded} uploaded`);
					if (result.deleted > 0) parts.push(`${result.deleted} deleted`);
					if (result.unchanged > 0) parts.push(`${result.unchanged} unchanged`);

					if (result.errors.length > 0) {
						vscode.window.showWarningMessage(`Sync completed with ${result.errors.length} error(s): ${parts.join(', ')}`);
						for (const err of result.errors) {
							outputChannel.appendLine(`Sync error: ${err}`);
						}
					} else {
						vscode.window.showInformationMessage(`Sync complete: ${parts.join(', ')}`);
					}

					onboarding.onFirstSync();
					fileTreeProvider.refresh();
				},
			);
		}),

		...registerFileCommands(context, fileTreeProvider, () => boardFs, boardContentProvider),

		vscode.commands.registerCommand('blinky.flashFirmware', async () => {
			// Flashing requires the serial port - disconnect first if connected
			const portPath = await pickFlashPort(portDiscovery, connection);
			if (!portPath) return;

			// Pick firmware file
			const fileUris = await vscode.window.showOpenDialog({
				canSelectMany: false,
				openLabel: 'Select Firmware',
				filters: { 'Firmware': ['bin', 'elf'] },
			});
			if (!fileUris?.length) return;

			// Confirm destructive operation
			const confirm = await vscode.window.showWarningMessage(
				`Flash firmware to ${portPath}? This will overwrite the current firmware.`,
				{ modal: true },
				'Flash',
			);
			if (confirm !== 'Flash') return;

			// Disconnect before flashing (espflash needs exclusive port access)
			if (connection?.isConnected) {
				await vscode.commands.executeCommand('blinky.disconnect');
			}

			const flasher = new EspFlasher(context.extensionPath);
			const config = vscode.workspace.getConfiguration('blinky');
			const flashBaud = config.get<number>('flashBaudRate', 460800);

			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Flashing firmware\u2026', cancellable: true },
				async (progress, token) => {
					token.onCancellationRequested(() => flasher.cancel());

					outputChannel.appendLine('--- Flash output ---');
					outputChannel.show(true);

					const flashAddress = await resolveFlashAddress(flasher, portPath);
					if (flashAddress === undefined) return; // user cancelled

					const result = await flasher.flash(
						portPath,
						fileUris[0].fsPath,
						{ baudRate: flashBaud, address: flashAddress },
						(p) => progress.report({ message: p.message }),
						(line) => outputChannel.appendLine(line),
					);

					if (result.success) {
						vscode.window.showInformationMessage(
							'Firmware flashed successfully!',
							'Reconnect',
						).then((action) => {
							if (action === 'Reconnect') {
								connectToPort(portPath);
							}
						});
					} else {
						vscode.window.showErrorMessage(
							`Flash failed. Check the output channel for details.`,
							'Show Output',
						).then((action) => {
							if (action === 'Show Output') outputChannel.show();
						});
					}
				},
			);
		}),

		vscode.commands.registerCommand('blinky.eraseFirmware', async () => {
			const portPath = await pickFlashPort(portDiscovery, connection);
			if (!portPath) return;

			const confirm = await vscode.window.showWarningMessage(
				`Erase ALL flash on ${portPath}? This will permanently delete the firmware and all files on the board.`,
				{ modal: true },
				'Erase',
			);
			if (confirm !== 'Erase') return;

			if (connection?.isConnected) {
				await vscode.commands.executeCommand('blinky.disconnect');
			}

			const flasher = new EspFlasher(context.extensionPath);

			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Erasing flash\u2026', cancellable: true },
				async (progress, token) => {
					token.onCancellationRequested(() => flasher.cancel());

					outputChannel.appendLine('--- Erase output ---');
					outputChannel.show(true);

					const result = await flasher.erase(
						portPath,
						(p) => progress.report({ message: p.message }),
						(line) => outputChannel.appendLine(line),
					);

					if (result.success) {
						vscode.window.showInformationMessage('Flash erased successfully. You can now flash new firmware.');
					} else {
						vscode.window.showErrorMessage(
							'Erase failed. Check the output channel for details.',
							'Show Output',
						).then((action) => {
							if (action === 'Show Output') outputChannel.show();
						});
					}
				},
			);
		}),

		vscode.commands.registerCommand('blinky.installMicroPython', async () => {
			// Step 1: Pick port
			const portPath = await pickFlashPort(portDiscovery, connection);
			if (!portPath) return;

			// Step 2: Disconnect if connected
			if (connection?.isConnected) {
				await vscode.commands.executeCommand('blinky.disconnect');
			}

			const flasher = new EspFlasher(context.extensionPath);
			const cacheDir = context.globalStorageUri.fsPath;
			const catalog = new FirmwareCatalog(cacheDir);

			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Install MicroPython', cancellable: true },
				async (progress, token) => {
					token.onCancellationRequested(() => flasher.cancel());

					// Step 3: Detect chip
					progress.report({ message: 'Detecting board\u2026' });
					const probeResult = await flasher.boardInfo(portPath);

					if (!('info' in probeResult)) {
						vscode.window.showErrorMessage(
							`Could not detect board. ${probeResult.output}`,
							'Show Output',
						).then((action) => {
							if (action === 'Show Output') {
								outputChannel.appendLine(probeResult.output);
								outputChannel.show();
							}
						});
						return;
					}

					const { chip, flashSize } = probeResult.info;
					outputChannel.appendLine(`Detected chip: ${chip}${flashSize ? ` (${flashSize} flash)` : ''}`);

					// Step 4: Map chip to MicroPython board
					const mapping = CHIP_BOARD_MAP[chip];
					if (!mapping) {
						vscode.window.showErrorMessage(
							`Chip "${chip}" is not supported for MicroPython installation. Supported: ${Object.keys(CHIP_BOARD_MAP).join(', ')}`,
						);
						return;
					}

					if (token.isCancellationRequested) return;

					// Step 5: Pick variant (if multiple)
					let variant = mapping.variants[0];
					if (mapping.variants.length > 1) {
						const items = mapping.variants.map((v) => ({
							label: v.label,
							id: v.id,
							description: v.id === '' ? '(recommended)' : undefined,
						}));
						const picked = await vscode.window.showQuickPick(items, {
							placeHolder: `Select ${mapping.label} firmware variant`,
						});
						if (!picked) return;
						variant = { id: picked.id, label: picked.label };
					}

					if (token.isCancellationRequested) return;

					// Step 6: Fetch versions from GitHub
					progress.report({ message: 'Fetching available versions\u2026' });
					let versions;
					try {
						versions = await catalog.fetchVersions();
					} catch (err: unknown) {
						const message = err instanceof Error ? err.message : String(err);
						vscode.window.showErrorMessage(
							`Could not fetch MicroPython versions. Check your internet connection. (${message})`,
						);
						return;
					}

					if (versions.length === 0) {
						vscode.window.showErrorMessage('No MicroPython versions found.');
						return;
					}

					// Show version picker - stable first, prereleases at bottom
					const versionItems = versions.map((v) => ({
						label: `v${v.version}`,
						description: v.prerelease ? '(prerelease)' : undefined,
						detail: v.date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
						version: v,
					}));

					const pickedVersion = await vscode.window.showQuickPick(versionItems, {
						placeHolder: 'Select MicroPython version',
					});
					if (!pickedVersion) return;

					if (token.isCancellationRequested) return;

					// Step 7: Download firmware
					const downloadUrls = catalog.buildDownloadUrls(
						mapping.board,
						variant.id,
						pickedVersion.version.version,
						pickedVersion.version.date,
					);
					outputChannel.appendLine(`Downloading: ${downloadUrls[0]}`);
					progress.report({ message: 'Downloading firmware\u2026' });

					let firmwarePath: string;
					try {
						firmwarePath = await catalog.downloadFirmware(
							downloadUrls,
							(bytes) => progress.report({ message: `Downloading\u2026 ${(bytes / 1024).toFixed(0)} KB` }),
						);
					} catch (err: unknown) {
						const message = err instanceof Error ? err.message : String(err);
						vscode.window.showErrorMessage(`Download failed: ${message}`);
						return;
					}

					if (token.isCancellationRequested) return;

					// Step 8: Ask about erasing
					const eraseChoice = await vscode.window.showQuickPick(
						[
							{ label: 'Yes (recommended)', id: 'yes', description: 'MicroPython recommends erasing before first install', picked: true },
							{ label: 'No', id: 'no', description: 'Skip erase - use for reinstall or upgrade' },
						],
						{ placeHolder: 'Erase flash before installing?' },
					);
					if (!eraseChoice) return;

					if (token.isCancellationRequested) return;

					// Step 9: Erase if requested
					if (eraseChoice.id === 'yes') {
						progress.report({ message: 'Erasing flash\u2026' });
						outputChannel.appendLine('--- Erase output ---');
						outputChannel.show(true);
						const eraseResult = await flasher.erase(
							portPath,
							(p) => progress.report({ message: p.message }),
							(line) => outputChannel.appendLine(line),
						);

						if (!eraseResult.success) {
							outputChannel.appendLine(eraseResult.output);
							vscode.window.showErrorMessage(
								'Erase failed. Check the output channel for details.',
								'Show Output',
							).then((action) => {
								if (action === 'Show Output') outputChannel.show();
							});
							return;
						}
					}

					if (token.isCancellationRequested) return;

					// Step 10: Flash firmware
					progress.report({ message: 'Installing MicroPython\u2026' });
					outputChannel.appendLine('--- Install output ---');
					outputChannel.show(true);
					const flashResult = await flasher.flash(
						portPath,
						firmwarePath,
						{ baudRate: 460800, address: mapping.flashAddress },
						(p) => progress.report({ message: p.message }),
						(line) => outputChannel.appendLine(line),
					);

					if (flashResult.success) {
						vscode.window.showInformationMessage(
							`MicroPython v${pickedVersion.version.version} installed on ${mapping.label}!`,
							'Connect',
						).then((action) => {
							if (action === 'Connect') {
								connectToPort(portPath);
							}
						});
					} else {
						vscode.window.showErrorMessage(
							'MicroPython installation failed. Check the output channel for details.',
							'Show Output',
						).then((action) => {
							if (action === 'Show Output') outputChannel.show();
						});
					}
				},
			);
		}),

		vscode.commands.registerCommand('blinky.setupStubs', async () => {
			await stubSetup.forcePrompt();
		}),

		vscode.commands.registerCommand('blinky.openWalkthrough', () => {
			const extId = context.extension.id;
			// Open the Getting Started tab filtered to our walkthrough
			vscode.commands.executeCommand('workbench.action.openWalkthrough', `${extId}#blinky.getStarted`).then(
				undefined,
				() => {
					// Fallback: open the general Getting Started page
					vscode.commands.executeCommand('workbench.action.openWalkthrough');
				},
			);
		}),

		vscode.commands.registerCommand('blinky.newProject', async () => {
			await scaffoldProject(context.globalState, context.extensionPath);
		}),

		vscode.commands.registerCommand('blinky.newNotebook', async () => {
			const data = new vscode.NotebookData([
				new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', 'python'),
			]);
			const doc = await vscode.workspace.openNotebookDocument(NOTEBOOK_TYPE, data);
			await vscode.window.showNotebookDocument(doc);
		}),

		vscode.commands.registerCommand('blinky.enableAutoSync', () => {
			autoSync.enable();
		}),

		vscode.commands.registerCommand('blinky.disableAutoSync', () => {
			autoSync.disable();
		}),

		scriptRunner,
		diagnosticMgr,
		fileTreeProvider,
		treeView,
		statusBar,
		autoSync,
		outputChannel,
	);

	// Auto-connect if configured
	const config = vscode.workspace.getConfiguration('blinky');
	if (config.get<boolean>('autoConnect', false)) {
		const lastPort = context.globalState.get<string>('blinky.lastPort');
		if (lastPort) {
			connectToPort(lastPort);
		}
	}

	// Open main.py if we just scaffolded a project into a new folder
	openPendingScaffold(context.globalState, context.extension.id);
}

export function deactivate() {
	if (replTerminal) {
		replTerminal.dispose();
		replTerminal = undefined;
	}
	boardFs = undefined;
	if (connection) {
		connection.dispose();
		connection = undefined;
	}
}
