# Deno KV

A Mac app for browsing and editing Deno KV databases.

It opens local SQLite files, in-memory stores, self-hosted KV Connect endpoints, Deno Deploy Classic databases, and Deno Deploy timeline databases (production, preview, and git branches). Each saved connection is one database. Tokens stay in the macOS Keychain.

## Develop

Install [Deno](https://deno.com) and Rust. Then:

```sh
npm install
npm run tauri dev
```

The dev build runs the worker with the `deno` binary on your machine.

## Data operations

- List keys by prefix, with paging
- Look up one exact key, including a not-found result
- Create, update, and delete one entry
- Update with an atomic versionstamp check
- Sum, min, and max on `KvU64` values
- Export, import, and delete a prefix

Production connections ask for confirmation before a write or delete.

## Remote databases

For Deploy v2, paste the database id from the Databases table in the Deno Deploy console. The app opens:

`https://api.deno.com/v2/databases/<database-id>/connect`

Classic databases use `https://api.deno.com/databases/<database-id>/connect`. Any other KV Connect URL can be entered directly. The access token (`ddo_…`) is stored in Keychain and passed to the worker only as `DENO_KV_ACCESS_TOKEN`.

The published Deploy v2 API does not return KV database ids. **Check Deploy API** confirms the token against `GET /v2/apps` and, when that response contains database records, fills the form. Otherwise paste the id yourself. Names ending in `-production` or `-preview`, or containing `--branch`, suggest an environment label.

## Install

Build a notarized disk image on a Mac with a Developer ID certificate:

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
npm run build:worker
CI=true npm run tauri build -- --target aarch64-apple-darwin
```

`--target aarch64-apple-darwin` keeps the bundle on the Apple Silicon sidecar when Node is running under Rosetta. `CI=true` skips the Finder layout script, which otherwise waits on AppleScript. With the four Apple variables set, Tauri signs with the Developer ID, notarizes, and staples. Without them the command still writes an ad-hoc signed `.app` and DMG.

Open the DMG, move Deno KV to Applications, and launch it. Gatekeeper accepts a stapled notarized app. This build is not submitted to the Mac App Store, and the App Sandbox stays off.

`build:worker` compiles the Deno sidecar for Apple Silicon. The packaged app does not need Deno installed.
