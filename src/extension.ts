import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

  // 3. Export open files to Desktop
  context.subscriptions.push(
    vscode.commands.registerCommand('fileExporter.exportOpenFilesToDesktop', async () => {
      const uris = getOpenEditorUris();
      if (uris.length === 0) {
        vscode.window.showInformationMessage('No open file tabs found.');
        return;
      }
      await exportFilesToDesktop(uris);
    })
  );

  // 4. Export selected Explorer files/folders to Desktop
  context.subscriptions.push(
    vscode.commands.registerCommand('fileExporter.exportSelectionToDesktop', async (clickedUri: vscode.Uri, allSelectedUris: vscode.Uri[]) => {
      const targets = getExplorerTargets(clickedUri, allSelectedUris);
      if (targets.length === 0) {
        vscode.window.showWarningMessage('No files or folders selected.');
        return;
      }
      await exportItemsToDesktop(targets);
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

/**
 * Gets the user's Desktop directory path across OS platforms.
 */
function getDesktopPath(): string {
  const home = os.homedir();
  const desktop = path.join(home, 'Desktop');
  if (fs.existsSync(desktop)) {
    return desktop;
  }
  // Fallback for OneDrive mapped Desktops on Windows
  const oneDriveDesktop = path.join(home, 'OneDrive', 'Desktop');
  if (fs.existsSync(oneDriveDesktop)) {
    return oneDriveDesktop;
  }
  return home;
}

/**
 * Exports a list of open file URIs to Desktop in a timestamped folder.
 */
async function exportFilesToDesktop(fileUris: vscode.Uri[]) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const targetDir = path.join(getDesktopPath(), `VSCode_Export_${timestamp}`);

  await fs.promises.mkdir(targetDir, { recursive: true });

  for (const uri of fileUris) {
    const relPath = vscode.workspace.asRelativePath(uri, false);
    const destPath = path.join(targetDir, relPath);
    if (!isInsideDir(targetDir, destPath)) {
      // The workspace-relative path escaped the export folder, which happens for
      // files outside the workspace: in a multi-root workspace VS Code returns a
      // '../other/file.txt' style path, and with no workspace at all it returns
      // an absolute path. Fall back to the bare filename so the file still lands
      // inside the export folder.
      await fs.promises.mkdir(targetDir, { recursive: true });
      await fs.promises.copyFile(uri.fsPath, path.join(targetDir, path.basename(uri.fsPath)));
      continue;
    }
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.copyFile(uri.fsPath, destPath);
  }

  showDesktopExportSuccess(targetDir, fileUris.length);
}

/**
 * Copies selected files/folders from Explorer to Desktop, maintaining tree structure.
 */
async function exportItemsToDesktop(targets: vscode.Uri[]) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const targetDir = path.join(getDesktopPath(), `VSCode_Export_${timestamp}`);

  await fs.promises.mkdir(targetDir, { recursive: true });

  for (const uri of targets) {
    const stat = await fs.promises.stat(uri.fsPath);
    const itemName = path.basename(uri.fsPath);
    const destPath = path.join(targetDir, itemName);
    // basename() cannot contain a separator, but guard anyway so a crafted name
    // can never write outside the export folder.
    if (!isInsideDir(targetDir, destPath)) continue;

    if (stat.isDirectory()) {
      await copyDirectoryRecursive(uri.fsPath, destPath);
    } else {
      await fs.promises.copyFile(uri.fsPath, destPath);
    }
  }

  showDesktopExportSuccess(targetDir, targets.length);
}

/**
 * True when `child` resolves to a location strictly inside `parent`.
 */
function isInsideDir(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function copyDirectoryRecursive(src: string, dest: string) {
  const base = path.basename(src);
  if (IGNORED_DIRS.has(base)) return;

  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcChild = path.join(src, entry.name);
    const destChild = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await copyDirectoryRecursive(srcChild, destChild);
      }
    } else if (entry.isFile()) {
      await fs.promises.copyFile(srcChild, destChild);
    }
  }
}

function showDesktopExportSuccess(exportDir: string, count: number) {
  vscode.window.showInformationMessage(
    `Exported ${count} item(s) to: ${path.basename(exportDir)}`,
    'Open Folder'
  ).then(selection => {
    if (selection === 'Open Folder') {
      vscode.env.openExternal(vscode.Uri.file(exportDir));
    }
  });
}

export function deactivate() {}
