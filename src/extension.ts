import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Common folders to skip during directory traversal
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.next',
  '.cache'
]);

// Common binary extensions to skip when copying text to clipboard
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
  '.mp4', '.mp3', '.wav', '.pdf', '.zip', '.tar', '.gz',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm', '.woff', '.woff2'
]);

export function activate(context: vscode.ExtensionContext) {

  // 1. Copy open files to clipboard
  context.subscriptions.push(
    vscode.commands.registerCommand('fileExporter.copyOpenFilesToClipboard', async () => {
      const uris = getOpenEditorUris();
      if (uris.length === 0) {
        vscode.window.showInformationMessage('No open file tabs found.');
        return;
      }
      await copyFilesToClipboard(uris);
    })
  );

  // 2. Copy selected Explorer files/folders to clipboard
  context.subscriptions.push(
    vscode.commands.registerCommand('fileExporter.copySelectionToClipboard', async (clickedUri: vscode.Uri, allSelectedUris: vscode.Uri[]) => {
      const targets = getExplorerTargets(clickedUri, allSelectedUris);
      if (targets.length === 0) {
        vscode.window.showWarningMessage('No files or folders selected.');
        return;
      }
      const files = await resolveAllFiles(targets);
      await copyFilesToClipboard(files);
    })
  );
}

// ---------------------------------------------------------------------------
// Core Logic
// ---------------------------------------------------------------------------

/**
 * Returns URIs of all currently open editor tabs across all tab groups.
 */
function getOpenEditorUris(): vscode.Uri[] {
  const uris: vscode.Uri[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      // Only these two input kinds carry a single document URI. TabInputTextDiff
      // is a side-by-side view of two documents and exposes no `uri`, so it is
      // deliberately excluded rather than dereferenced.
      if (
        (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) &&
        input.uri
      ) {
        uris.push(input.uri);
      }
    }
  }

  // Deduplicate: the same file can be open in several groups/tabs.
  const seen = new Set<string>();
  return uris.filter(uri => {
    if (uri.scheme !== 'file') return false;
    if (seen.has(uri.fsPath)) return false;
    seen.add(uri.fsPath);
    return true;
  });
}

/**
 * Handles VS Code passing the clicked item as 1st arg and multi-selection as 2nd arg.
 */
function getExplorerTargets(clickedUri?: vscode.Uri, allSelectedUris?: vscode.Uri[]): vscode.Uri[] {
  if (allSelectedUris && allSelectedUris.length > 0) {
    return allSelectedUris;
  }
  if (clickedUri) {
    return [clickedUri];
  }
  return [];
}

/**
 * Recursively inspects URIs and returns a flat list of actual file URIs.
 */
async function resolveAllFiles(uris: vscode.Uri[]): Promise<vscode.Uri[]> {
  const fileUris: vscode.Uri[] = [];

  for (const uri of uris) {
    try {
      const stat = await fs.promises.stat(uri.fsPath);
      if (stat.isDirectory()) {
        await walkDir(uri.fsPath, fileUris);
      } else if (stat.isFile()) {
        fileUris.push(uri);
      }
    } catch {
      // Skip inaccessible paths
    }
  }

  return fileUris;
}

/**
 * Depth-first collection of files under a directory, pruning ignored folders.
 */
async function walkDir(dirPath: string, result: vscode.Uri[]) {
  const baseName = path.basename(dirPath);
  if (IGNORED_DIRS.has(baseName)) {
    return;
  }

  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await walkDir(fullPath, result);
      }
    } else if (entry.isFile()) {
      result.push(vscode.Uri.file(fullPath));
    }
  }
}

/**
 * Formats file contents into Markdown code blocks and writes to clipboard.
 */
async function copyFilesToClipboard(fileUris: vscode.Uri[]) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Exporting files to clipboard...',
      cancellable: false
    },
    async () => {
      let output = '';
      let processedCount = 0;
      let skippedBinary = 0;

      for (const uri of fileUris) {
        const ext = path.extname(uri.fsPath).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) {
          skippedBinary++;
          continue;
        }

        try {
          const content = await fs.promises.readFile(uri.fsPath, 'utf8');
          const relPath = vscode.workspace.asRelativePath(uri, true);
          const lang = ext.replace('.', '') || 'text';

          output += `### File: ${relPath}\n\`\`\`${lang}\n${content}\n\`\`\`\n\n`;
          processedCount++;
        } catch {
          // If file reading fails (e.g. strict binary disguised as text), ignore
        }
      }

      if (processedCount === 0) {
        vscode.window.showWarningMessage('No readable text files found to copy.');
        return;
      }

      await vscode.env.clipboard.writeText(output.trim());
      const binaryMsg = skippedBinary > 0 ? ` (${skippedBinary} binary files skipped)` : '';
      vscode.window.showInformationMessage(`Copied ${processedCount} file(s) to clipboard!${binaryMsg}`);
    }
  );
}

export function deactivate() {}
