// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// Define the MnemonicBookmark interface
interface MnemonicBookmark {
	mnemonic: string;
	filePath: string;
	line: number;
}

// Restore text-based decoration for mnemonic bookmarks
const mnemonicDecorationType = vscode.window.createTextEditorDecorationType({
	after: {
		margin: '0 0 0 1em',
		color: '#888',
	},
});

function updateEditorDecorations(editor: vscode.TextEditor, bookmarks: MnemonicBookmark[]) {
	if (!editor) {return;}
	const filePath = editor.document.uri.toString();
	const decorations: vscode.DecorationOptions[] = bookmarks
		.filter(b => b.filePath === filePath)
		.map(b => ({
			range: new vscode.Range(b.line, 0, b.line, 0),
			renderOptions: {
				after: {
					contentText: `[${b.mnemonic}]`,
					color: '#888',
					margin: '0 0 0 1em',
				},
			},
		}));
	editor.setDecorations(mnemonicDecorationType, decorations);
}

function updateAllVisibleEditors(context: vscode.ExtensionContext) {
	const bookmarks: MnemonicBookmark[] = context.workspaceState.get('mnemonicBookmarks', []);
	for (const editor of vscode.window.visibleTextEditors) {
		updateEditorDecorations(editor, bookmarks);
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Register Set Mnemonic Bookmark command
	const setBookmark = vscode.commands.registerCommand('mnemonic-bookmarks.setBookmark', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('No active editor.');
			return;
		}

		const mnemonic = await vscode.window.showInputBox({
			prompt: 'Enter a mnemonic for this bookmark (e.g., init, bug, todo)',
			validateInput: (value) => {
				if (!value.match(/^[a-zA-Z0-9_-]+$/)) {
					return 'Mnemonic must be alphanumeric (letters, numbers, _ or -)';
				}
				return null;
			}
		});
		if (!mnemonic) {
			return; // User cancelled
		}

		const document = editor.document;
		const filePath = document.uri.toString();
		const line = editor.selection.active.line;

		// Load existing bookmarks
		const bookmarks: MnemonicBookmark[] = context.workspaceState.get('mnemonicBookmarks', []);
		if (bookmarks.some(b => b.mnemonic === mnemonic)) {
			vscode.window.showErrorMessage(`Mnemonic "${mnemonic}" already exists.`);
			return;
		}

		bookmarks.push({ mnemonic, filePath, line });
		await context.workspaceState.update('mnemonicBookmarks', bookmarks);
		vscode.window.showInformationMessage(`Bookmark set: ${mnemonic} → ${document.fileName}:${line + 1}`);
		updateAllVisibleEditors(context);
	});

	// Register List Mnemonic Bookmarks command
	const listBookmarks = vscode.commands.registerCommand('mnemonic-bookmarks.listBookmarks', async () => {
		const bookmarks: MnemonicBookmark[] = context.workspaceState.get('mnemonicBookmarks', []);
		if (!bookmarks.length) {
			vscode.window.showInformationMessage('No mnemonic bookmarks set.');
			return;
		}

		const items = bookmarks.map(b => ({
			label: b.mnemonic,
			description: `${vscode.Uri.parse(b.filePath).fsPath}:${b.line + 1}`,
			bookmark: b
		}));

		const selection = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select a mnemonic bookmark to go to',
		});
		if (!selection) {return;}

		const { filePath, line } = selection.bookmark;
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(filePath));
		const editor = await vscode.window.showTextDocument(doc);
		const pos = new vscode.Position(line, 0);
		editor.selection = new vscode.Selection(pos, pos);
		editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
	});

	// Register Go to Mnemonic Bookmark command
	const gotoBookmark = vscode.commands.registerCommand('mnemonic-bookmarks.gotoBookmark', async () => {
		const bookmarks: MnemonicBookmark[] = context.workspaceState.get('mnemonicBookmarks', []);
		if (!bookmarks.length) {
			vscode.window.showInformationMessage('No mnemonic bookmarks set.');
			return;
		}

		const mnemonic = await vscode.window.showInputBox({
			prompt: 'Enter the mnemonic to jump to',
		});
		if (!mnemonic) {return;}

		const bookmark = bookmarks.find(b => b.mnemonic === mnemonic);
		if (!bookmark) {
			vscode.window.showErrorMessage(`Mnemonic "${mnemonic}" not found.`);
			return;
		}

		const { filePath, line } = bookmark;
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(filePath));
		const editor = await vscode.window.showTextDocument(doc);
		const pos = new vscode.Position(line, 0);
		editor.selection = new vscode.Selection(pos, pos);
		editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
	});

	// Register Remove Mnemonic Bookmark command
	const removeBookmark = vscode.commands.registerCommand('mnemonic-bookmarks.removeBookmark', async () => {
		const bookmarks: MnemonicBookmark[] = context.workspaceState.get('mnemonicBookmarks', []);
		if (!bookmarks.length) {
			vscode.window.showInformationMessage('No mnemonic bookmarks set.');
			return;
		}

		const items = bookmarks.map(b => ({
			label: b.mnemonic,
			description: `${vscode.Uri.parse(b.filePath).fsPath}:${b.line + 1}`,
			bookmark: b
		}));

		const selection = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select a mnemonic bookmark to remove',
		});
		if (!selection) {return;}

		const mnemonic = selection.bookmark.mnemonic;
		const index = bookmarks.findIndex(b => b.mnemonic === mnemonic);
		if (index === -1) {
			vscode.window.showErrorMessage(`Mnemonic "${mnemonic}" not found.`);
			return;
		}

		bookmarks.splice(index, 1);
		await context.workspaceState.update('mnemonicBookmarks', bookmarks);
		vscode.window.showInformationMessage(`Removed bookmark: ${mnemonic}`);
		updateAllVisibleEditors(context);
	});

	// Register Delete All Mnemonic Bookmarks command
	const deleteAllBookmarks = vscode.commands.registerCommand('mnemonic-bookmarks.deleteAllBookmarks', async () => {
		const confirm = await vscode.window.showWarningMessage(
			'Are you sure you want to delete ALL mnemonic bookmarks?',
			{ modal: true },
			'Yes', 'No'
		);
		if (confirm !== 'Yes') return;
		await context.workspaceState.update('mnemonicBookmarks', []);
		updateAllVisibleEditors(context);
		vscode.window.showInformationMessage('All mnemonic bookmarks have been deleted.');
	});

	// Update decorations when the active editor changes, a document is opened, or visible editors change
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() => updateAllVisibleEditors(context)),
		vscode.workspace.onDidOpenTextDocument(() => updateAllVisibleEditors(context)),
		vscode.workspace.onDidChangeTextDocument(() => updateAllVisibleEditors(context)),
		vscode.window.onDidChangeVisibleTextEditors(() => updateAllVisibleEditors(context))
	);

	// Initial decorations (call directly, not in setTimeout)
	updateAllVisibleEditors(context);

	context.subscriptions.push(setBookmark, listBookmarks, gotoBookmark, removeBookmark, deleteAllBookmarks);
}

// This method is called when your extension is deactivated
export function deactivate() {}
