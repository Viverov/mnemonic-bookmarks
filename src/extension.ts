// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Define the MnemonicBookmark interface
interface MnemonicBookmark {
	mnemonic: string;
	filePath: string;
	line: number;
	snippet: string;
}

// Restore text-based decoration for mnemonic bookmarks
const mnemonicDecorationType = vscode.window.createTextEditorDecorationType({
	after: {
		margin: '0 0 0 1em',
		color: '#888',
	},
});

const SNIPPET_LENGTH = 40;

function getLineSnippet(document: vscode.TextDocument, line: number): string {
	if (line < 0 || line >= document.lineCount) {return '';}
	return document.lineAt(line).text.slice(0, SNIPPET_LENGTH);
}

const ICON_DIR = '.mnemonic-bookmarks-icons';

function getIconDir(context: vscode.ExtensionContext): string {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	const baseDir = workspaceFolders && workspaceFolders.length > 0
		? workspaceFolders[0].uri.fsPath
		: context.globalStorageUri.fsPath;
	const iconDir = path.join(baseDir, ICON_DIR);
	if (!fs.existsSync(iconDir)) {
		fs.mkdirSync(iconDir, { recursive: true });
	}
	return iconDir;
}

function mnemonicSvgPath(mnemonic: string, context: vscode.ExtensionContext): string {
	const iconDir = getIconDir(context);
	return path.join(iconDir, `${mnemonic}.svg`);
}

function generateMnemonicSvg(mnemonic: string, filePath: string) {
	const width = 32;
	const height = 32;
	const fontSize = 14;
	const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'>
  <circle cx='16' cy='16' r='15' fill='#fde047' stroke='#b45309' stroke-width='2'/>
  <text x='16' y='21' text-anchor='middle' font-size='${fontSize}' font-family='monospace' fill='#222' font-weight='bold'>${mnemonic}</text>
</svg>`;
	fs.writeFileSync(filePath, svg, 'utf8');
}

function ensureMnemonicIcon(mnemonic: string, context: vscode.ExtensionContext): string {
	const svgPath = mnemonicSvgPath(mnemonic, context);
	if (!fs.existsSync(svgPath)) {
		generateMnemonicSvg(mnemonic, svgPath);
	}
	return svgPath;
}

const editorDecorationTypes = new WeakMap<vscode.TextEditor, vscode.TextEditorDecorationType[]>();

function updateEditorDecorations(editor: vscode.TextEditor, bookmarks: MnemonicBookmark[], context: vscode.ExtensionContext) {
	if (!editor) {return;}
	const filePath = editor.document.uri.toString();
	const decorations: { [icon: string]: vscode.DecorationOptions[] } = {};
	for (const b of bookmarks.filter(b => b.filePath === filePath)) {
		const iconPath = ensureMnemonicIcon(b.mnemonic, context);
		if (!decorations[iconPath]) decorations[iconPath] = [];
		decorations[iconPath].push({
			range: new vscode.Range(b.line, 0, b.line, 0),
		});
	}
	// Clear all previous decorations
	if (editorDecorationTypes.has(editor)) {
		for (const decoType of editorDecorationTypes.get(editor)!) {
			editor.setDecorations(decoType, []);
		}
	}
	editorDecorationTypes.set(editor, []);
	for (const iconPath in decorations) {
		const decoType = vscode.window.createTextEditorDecorationType({
			gutterIconPath: iconPath,
			gutterIconSize: 'contain',
		});
		editor.setDecorations(decoType, decorations[iconPath]);
		editorDecorationTypes.set(editor, [...editorDecorationTypes.get(editor)!, decoType]);
	}
}

function updateAllVisibleEditors(context: vscode.ExtensionContext) {
	const bookmarks: MnemonicBookmark[] = context.workspaceState.get('mnemonicBookmarks', []);
	for (const editor of vscode.window.visibleTextEditors) {
		updateEditorDecorations(editor, bookmarks, context);
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
		const snippet = getLineSnippet(document, line);

		// Load existing bookmarks
		const bookmarks: MnemonicBookmark[] = context.workspaceState.get('mnemonicBookmarks', []);
		if (bookmarks.some(b => b.mnemonic === mnemonic)) {
			vscode.window.showErrorMessage(`Mnemonic "${mnemonic}" already exists.`);
			return;
		}

		bookmarks.push({ mnemonic, filePath, line, snippet });
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
		if (confirm !== 'Yes') {return;}
		await context.workspaceState.update('mnemonicBookmarks', []);
		updateAllVisibleEditors(context);
		vscode.window.showInformationMessage('All mnemonic bookmarks have been deleted.');
	});

	// Update decorations when the active editor changes, a document is opened, or visible editors change
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() => updateAllVisibleEditors(context)),
		vscode.workspace.onDidOpenTextDocument(() => updateAllVisibleEditors(context)),
		vscode.window.onDidChangeVisibleTextEditors(() => updateAllVisibleEditors(context)),
		vscode.workspace.onDidChangeTextDocument(async (event) => {
			const uri = event.document.uri.toString();
			let bookmarks: MnemonicBookmark[] = context.workspaceState.get('mnemonicBookmarks', []);
			let changed = false;
			bookmarks = bookmarks.map(b => {
				if (b.filePath !== uri) {return b;}
				// Try to find the snippet near the old line
				const doc = event.document;
				let newLine = b.line;
				let found = false;
				for (let offset = 0; offset <= 20 && !found; offset++) {
					for (const delta of [offset, -offset]) {
						const candidate = b.line + delta;
						if (candidate < 0 || candidate >= doc.lineCount) {continue;}
						const candidateSnippet = getLineSnippet(doc, candidate);
						if (candidateSnippet === b.snippet) {
							newLine = candidate;
							found = true;
							break;
						}
					}
				}
				if (found && newLine !== b.line) {
					changed = true;
					return { ...b, line: newLine };
				}
				return b;
			});
			if (changed) {
				await context.workspaceState.update('mnemonicBookmarks', bookmarks);
			}
			updateAllVisibleEditors(context);
		})
	);

	updateAllVisibleEditors(context);

	context.subscriptions.push(setBookmark, listBookmarks, gotoBookmark, removeBookmark, deleteAllBookmarks);
}

// This method is called when your extension is deactivated
export function deactivate() {}
