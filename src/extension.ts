import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

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
