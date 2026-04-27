# Install-flow E2E tests

Tests the **packaged** application — what users actually get — separate from
the source-tree dev tests in `../e2e/`.

## Why two layers?

| Layer | Spec | What it catches |
|---|---|---|
| Source-tree (`e2e/`) | runs Vite + `electron .` | Logic, IPC, UI behavior |
| **Packed app** (`01-packed-app.spec.ts`) | launches `release/win-unpacked/GhostFrog.exe` | Bad asar packing, missing files in `build.files`, native module ABI mismatch (better-sqlite3, keytar), broken file:// renderer paths |
| **Full installer** (`02-installer.spec.ts`) | runs NSIS `.exe /S /D=tmp`, launches installed binary, then `Uninstall /S` | NSIS script bugs, registry entries, shortcuts, files missing from installer payload vs win-unpacked, uninstaller leaving artefacts |

## Running

```powershell
# Packed-app smoke (fast, ~1s, runs by default)
npm run test:installer

# Full install -> launch -> uninstall round-trip (gated, ~35s)
$env:RUN_INSTALLER='1'
npm run test:installer:full
```

## Prerequisites

Both specs require build artefacts in `release/`. Run `npm run dist` first.

If `npm run dist` fails on Windows with
`Cannot create symbolic link ... darwin/10.12/lib/libcrypto.dylib`:
enable **Windows Developer Mode** (Settings → Privacy & Security → For
developers → Developer Mode = On) and retry. This grants
`SeCreateSymbolicLinkPrivilege` to non-admin users so the bundled `7za.exe`
can extract the macOS symlinks in the `winCodeSign` cache.

## Native module note

`better-sqlite3` is compiled per Electron version (NODE_MODULE_VERSION).
After upgrading Electron you must `npx electron-rebuild -f -w better-sqlite3`
**and** rebuild the installer (`npm run dist`), otherwise the installed app
will fail at startup with a `NODE_MODULE_VERSION 127 vs 133` error.
The packed-app test is designed to catch exactly this regression.
