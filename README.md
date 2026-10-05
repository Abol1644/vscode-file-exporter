# File Exporter — Clipboard & Desktop

A VS Code extension for getting code **out** of the editor: dump every open tab, or any
Explorer selection, either onto the clipboard as Markdown ready for an LLM or a doc, or onto
your Desktop as real files.

Four commands, two destinations, no configuration.

---

## Contents

- [Why](#why)
- [Commands](#commands)
- [Output format](#output-format)
- [What gets skipped](#what-gets-skipped)
- [Desktop export layout](#desktop-export-layout)
- [Install](#install)
- [Develop](#develop)
- [How it works](#how-it-works)
- [Behaviour notes and limitations](#behaviour-notes-and-limitations)
- [Project layout](#project-layout)
- [Development history](#development-history)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Why

Two chores that come up constantly when working with an AI assistant or writing docs:

1. You have eight tabs open and want to paste all of them into a chat window.
2. You want a physical copy of a folder on your Desktop to send to someone.

Doing either by hand means a lot of tabbing, selecting and pasting. This does both in one
keystroke, in a format the receiving end can actually parse.

## Commands

| Command | Palette title | Also on |
| --- | --- | --- |
| `fileExporter.copyOpenFilesToClipboard` | **Export: Copy Open Files to Clipboard** | Editor tab right-click |
| `fileExporter.exportOpenFilesToDesktop` | **Export: Save Open Files to Desktop** | Editor tab right-click |
| `fileExporter.copySelectionToClipboard` | **Export: Copy Selected Files/Folders to Clipboard** | Explorer right-click |
| `fileExporter.exportSelectionToDesktop` | **Export: Copy Selected Files/Folders to Desktop** | Explorer right-click |

All four are in the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) — type `Export:`.

The two Explorer commands accept a **multi-selection**: highlight several files and folders,
right-click any one of them, and the whole set is exported.

## Output format

The clipboard export is a sequence of Markdown blocks — one per file, in selection order.
The block below is itself shown inside a four-backtick fence so the three-backtick fences in
the output are visible:

````markdown
### File: myproject/src/index.ts
```ts
import { start } from './server';

start({ port: 8080 });
```

### File: myproject/README.md
```markdown
# myproject
```
````

Three details worth knowing:

- The `### File:` label is the **workspace-relative** path, so the receiving end knows the
  project structure. For a multi-root workspace the root folder name is included.
- The fence is tagged with the file extension (`ts`, `py`, `json`), or `text` for
  extensionless files such as `LICENSE` or `Dockerfile`.
- Fences are **widened automatically**. A file that contains its own three-backtick block
  gets wrapped in a longer fence, so the content cannot terminate its own block. This is the
  CommonMark rule for nested fences.

## What gets skipped

**Binaries are skipped for clipboard export only** — Desktop export copies everything,
since it is a plain file copy. Skipped by extension:

```
.png  .jpg  .jpeg  .gif  .ico  .svg  .webp
.mp4  .mp3  .wav   .pdf  .zip  .tar  .gz
.exe  .dll  .so    .dylib .bin  .wasm .woff  .woff2
```

The confirmation message tells you how many were skipped, e.g.
`Copied 12 file(s) to clipboard! (3 binary files skipped)`.

**Ignored folders are never traversed or copied**, in both clipboard and Desktop exports:

```
node_modules   .git   .svn   .hg   dist   build   out   .next   .cache
```

So exporting a project root gives you source, not `node_modules`.

## Desktop export layout

Each run creates a **new** folder on your Desktop:

```
Desktop/
└── VSCode_Export_2026-10-05T13-26-34/
    ├── README.md
    └── src/
        ├── index.ts
        └── util.ts
```

- **Open files** keep their **workspace-relative tree**, so `src/index.ts` lands in
  `src/`.
- **Explorer selections** each land under their own **basename**, so selecting
  `myproject/` and `notes.md` gives you `VSCode_Export_.../myproject/` and
  `.../notes.md`.
- Files outside the workspace are placed at the **root of the export folder** by
  basename, because there is no meaningful relative path for them. They are never written
  outside the export folder — see commit `6e59f27`.
- The name is a second-granular timestamp. Two exports started in the same second get
  `_1`, `_2` suffixes rather than overwriting each other.
- On Windows, `~/OneDrive/Desktop` is detected when `~/Desktop` does not exist.
- The confirmation offers **Open Folder**, which opens the export in a VS Code window.

## Install

### From a released VSIX

Each release tag carries its own built `.vsix`, committed to the repository, so you can
install without building anything:

```bash
git clone <this-repo> vscode-file-exporter
cd vscode-file-exporter
git checkout v1.0.1
```

Then in VS Code: **Extensions** (`Ctrl+Shift+X`) → **···** → **Install from VSIX...** and
pick `file-exporter-1.0.1.vsix` from the repository root.

### Build it yourself

```bash
npx @vscode/vsce package
```

This produces `file-exporter-<version>.vsix` using the version in `package.json`.

### From source

```bash
git clone <this-repo> vscode-file-exporter
cd vscode-file-exporter
npm install
```

Press `F5` for an Extension Development Host, or run `npm run compile` and install the
built folder manually.

**Requires VS Code 1.75 or newer.** No runtime dependencies — only three devDependencies
(`typescript`, `@types/vscode`, `@types/node`).

## Develop

| Command | What it does |
| --- | --- |
| `npm install` | Install devDependencies |
| `npm run compile` | Type-check and emit to `out/` |
| `npm run watch` | Recompile on change (also the default build task for `F5`) |
| `npx @vscode/vsce package` | Build `file-exporter-<version>.vsix` |

Press `F5` to launch an Extension Development Host with the extension loaded.

## How it works

Everything lives in one file, `src/extension.ts` (~350 lines), with no abstraction layers —
the logic is small enough that indirection would cost more than it saves.

**Clipboard path**

1. Collect URIs — either from `window.tabGroups.all` (open tabs) or from the Explorer
   selection, which VS Code passes as `(clickedUri, allSelectedUris)`.
2. Flatten folders to a file list with a depth-first walk that prunes ignored directories.
3. Skip binaries, read the rest, wrap each in a Markdown block, join, write once via
   `env.clipboard.writeText`.

Everything is assembled into a single string and written in one call, so the clipboard
operation itself is not the bottleneck and cannot interleave with other clipboard writers.

**Desktop path**

1. `createExportDir()` picks an unused `VSCode_Export_<timestamp>` folder.
2. Copy each item, creating parent directories as needed and skipping ignored folders.
3. `isInsideDir()` asserts every destination resolves inside the export folder before
   anything is written.

Tab enumeration deliberately skips `TabInputTextDiff`: a diff view spans two documents and
exposes no single `uri`, so dereferencing it would throw. `TabInputNotebook` is skipped for
the same reason — it is not a plain text file.

## Behaviour notes and limitations

- **Extension-based binary filtering.** A binary with a text extension, or a text file
  named `.png`, is misclassified. There is no content sniffing.
- **No size or count limits.** Selecting a large tree can produce a very large string.
  Clipboard writes of tens of megabytes may be slow; the ignore list is the only guard.
- **No symlink resolution.** A symlinked directory is walked as a directory, so a link
  pointing at an ancestor can cause deep or repeated traversal. Cycles are not detected.
- **Hidden files are included** (`.env`, `.npmrc`) — they are not in the ignore list. Be
  aware of this before pasting a selection into a public chat.
- **Unsaved editors are excluded.** Only tabs backed by a file on disk are exported; a
  dirty editor exports its last saved content.
- **The Desktop location is not configurable.** It resolves `~/Desktop`, then
  `~/OneDrive/Desktop`, then the home directory.
- **Ignoring `out` and `build` is unconditional**, so a project that genuinely keeps
  sources in `build/` will have them skipped. The lists are constants at the top of
  `src/extension.ts`; edit them to taste.

## Project layout

```
vscode-file-exporter/
├── package.json              # manifest: commands, menus, scripts
├── tsconfig.json             # CommonJS / ES2022, strict
├── .vscodeignore             # keeps sources and stale artifacts out of the VSIX
├── .vscode/
│   ├── launch.json           # F5 → Extension Development Host
│   └── tasks.json            # npm run watch as default build task
├── src/
│   └── extension.ts          # the entire extension
├── file-exporter-1.0.1.vsix  # built artifact, committed at the v1.0.1 tag
└── LICENSE.txt
```

## Releases

Each release tag carries its own built `.vsix`, committed to the repository, so a tagged
version can be installed without a build step:

| Tag | Artifact | Notes |
| --- | --- | --- |
| `v1.0.1` | `file-exporter-1.0.1.vsix` | First tag with the artifact tracked |

```bash
git checkout v1.0.1
# then Extensions → ··· → Install from VSIX... → file-exporter-1.0.1.vsix
```

`v1.0.0` predates this practice and has no committed artifact — build it with
`npx @vscode/vsce package` if you need it.

Only the current version's artifact is kept in the tree, so a rebuild of the same version
shows up as a modified file rather than silently accumulating binaries. `.vscodeignore`
excludes `*.vsix` so an existing artifact is never nested inside a newly built one.

## Development history

Each commit is a self-contained, compiling increment. The `fix` commits each correspond to a
defect reproduced against the code as it stood at the preceding commit.

| Commit | Change |
| --- | --- |
| `f691d8e` | `chore:` scaffold manifest, tsconfig, entry point |
| `54d8049` | `feat(clipboard):` export open editor tabs to the clipboard |
| `8f5957e` | `feat(clipboard):` export Explorer selection to the clipboard |
| `47e9985` | `feat(desktop):` write open tabs and selections to the Desktop |
| `6e59f27` | `fix(export):` contain out-of-workspace paths inside the export folder |
| `086b9e1` | `fix(export):` never overwrite an existing export folder |
| `931749d` | `fix(export):` open the export folder in VS Code, not the file manager |
| `c99cbf7` | `fix(markdown):` widen fences so content cannot terminate its own block |
| `2986ff4` | `fix(export):` skip unreadable entries, report real counts |
| `d4cae68` | `chore:` F5 launch config and VSIX packaging hygiene |
| `aa66c04` | `docs:` complete README and MIT license |
| `4b92c73` | `docs:` drop the relative LICENSE link that broke `vsce` packaging |
| `v1.0.1` | `chore(release):` version 1.0.1, track the release artifact |

The three most consequential fixes, all reproduced before being fixed:

- **`6e59f27` — path traversal.** `asRelativePath()` returns `../other/file.txt` in a
  multi-root workspace, which `path.join` resolved straight out of the export folder and
  onto the Desktop. With no workspace open it returns an absolute path, and
  `path.join(target, 'C:\\...')` produces a drive letter mid-path, making `mkdir` throw
  `ENOENT` and aborting the export as an unhandled rejection.
- **`086b9e1` — silent data loss.** Second-granular timestamps meant two exports in the same
  second wrote into one folder, mixing or losing files with no warning.
- **`2986ff4` — truncated exports.** One unreadable directory or locked file rejected the
  whole command: no confirmation message, and files silently missing.

Verification: `tsc` clean under `strict`, `vsce package` produces a 6-file VSIX, and a
35-check headless smoke test drives the compiled `extension.js` against a stubbed `vscode`
module — covering tab dedup, binary skips, ignore-list pruning, multi-select, tree
preservation, fence widening, traversal containment, export-name collisions, empty and
binary-only selections, and unreadable paths.

## Troubleshooting

**"No open file tabs found."** No tab is backed by a file on disk. Unsaved editors, diff
views and notebooks do not count.

**"No readable text files found to copy."** Everything in the selection was filtered as
binary, or every read failed.

**Nothing appears on the Desktop.** Check that `~/Desktop` exists; if you use OneDrive
redirection, the extension falls back to `~/OneDrive/Desktop`. Otherwise exports land in
your home directory.

**A file is missing from the export.** It is probably in an ignored folder, or it failed to
read and was skipped. The count in the confirmation message reflects what was actually
written.

**Right-click menu does not show the commands.** Confirm the extension is active in this
window — the entries appear under the `Export:` group in the Explorer context menu.

## License

MIT — see the `LICENSE.txt` file in the repository root.

If you publish this to a marketplace, add a `repository` field to `package.json` first.
`vsce` needs it to rewrite relative links and images in this README; without it, packaging
fails outright.
