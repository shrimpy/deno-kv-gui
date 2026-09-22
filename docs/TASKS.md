# Tasks

Status values: `pending`, `in_progress`, `blocked`, `done`.

## T1 — Agent docs and app shell

- status: done
- depends: none
- started: 2026-09-21
- notes: Added `docs/AGENT.md`, this file, the Tauri 2 + Vite React shell, and `sidecar/main.ts`. `deno task check` passed (`deno check sidecar/main.ts`). The release app window title is Deno KV and the header reads Worker ready after the bundled worker answers ping.

## T2 — Connection records and Keychain

- status: done
- depends: T1
- started: 2026-09-21
- notes: Connection JSON is stored under Application Support with no token field. Tokens go through `/usr/bin/security` (service `deno-kv-gui`). `cargo test` passed 4 tests, including `connection_file_has_no_secret` and `keychain_round_trip`. Saved records for Scratch and Bundle file have `hasToken: false` and no secret in `connections.json`.

## T3 — Open every KV target

- status: done
- depends: T2
- started: 2026-09-21
- notes: Worker `open` / `close` covers a local path, `:memory:`, and a remote URL. The remote token is set only as the child env `DENO_KV_ACCESS_TOKEN`. `deno task test`: memory and file open/write/read/close passed; remote open to `http://127.0.0.1:9/connect` failed as expected. No Deploy token was available for a live remote open.

## T4 — Typed codec

- status: done
- depends: T3
- started: 2026-09-21
- notes: Tagged codec covers string, number, boolean, null, object, array, bigint, bytes, date, and u64, and rejects unsupported values. `deno task test` codec tests passed (round trip, nested u64, rejects, key parts).

## T5 — List, lookup, create, update, delete

- status: done
- depends: T4
- started: 2026-09-21
- notes: Worker methods `list`, `get`, `set`, and `delete` are implemented. `deno task test` `list lookup create update delete` passed against `:memory:` (prefix paging, stored get, missing get, create, update, delete).

## T6 — Connections screen

- status: done
- depends: T5
- started: 2026-09-21
- notes: The app adds, edits, removes, and connects one database at a time, with environment badges and forms for memory, local file, and remote URL shapes. In the release app, saved an in-memory connection (Scratch) and a local-file connection (Bundle file at `/tmp/deno-kv-gui-bundle.sqlite`), connected, and confirmed both records persist in `connections.json` with no token.

## T7 — Key browser, lookup, and editor

- status: done
- depends: T6
- started: 2026-09-21
- notes: Prefix list, exact lookup, and create/update/delete are in the entry panel. Against the temp local file in the bundled app, created key `hello` with value `world`, and the row appeared in the list with a versionstamp. An earlier debug-app pass also updated a value, looked up a missing key (Not found), deleted a key, and still listed the remaining keys after reconnect.

## T8 — Atomic writes, counters, production guard

- status: done
- depends: T7
- started: 2026-09-21
- notes: `set` and `delete` accept an expected versionstamp and return `conflict` when it does not match. `deno task test` `atomic check conflict and u64 sum` passed (stale write rejected, sum 10+5). In the app, Scratch marked production blocked Create until the dialog that names Scratch; Cancel left the database unchanged.

## T9 — Prefix delete, export, and import

- status: done
- depends: T8
- started: 2026-09-21
- notes: `deno task test` `export import and prefix delete` passed, including u64 and bytes. In the bundled app, exported the local file prefix to `/tmp/kv-export.json` (tagged string `hello`/`world`), deleted the prefix (count dialog, then “No keys on this page”), imported the file, and the same key was listed again.

## T10 — Deploy database list

- status: done
- depends: T9
- started: 2026-09-21
- notes: The published Deploy v2 OpenAPI has no list-KV-databases route. The app calls `GET https://api.deno.com/v2/apps` to check the token and only builds drafts from objects that actually include a database id. Manual id entry remains the path. `cargo test` `parses_timeline_names` and `extracts_database_drafts_and_ignores_app_lists` passed. `deno task test` environment parser tests passed.

## T11 — Notarized macOS DMG

- status: blocked
- depends: T10
- started: 2026-09-21
- notes: Blocker: this Mac has no Developer ID Application certificate and `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` are unset, so the DMG cannot be notarized or stapled. `spctl --assess` rejects the ad-hoc linker signature (`code has no resources but signature indicates they must be present`). `CI=true npx tauri build --target aarch64-apple-darwin` succeeded and wrote `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Deno KV_0.1.0_aarch64.dmg` plus `Deno KV.app`. The bundled `kv-worker` is arm64, answered ping (`pong: true`), and the `.app` launched without `deno` on the command line: the child process was `Contents/MacOS/kv-worker`, and it opened `/tmp/deno-kv-gui-bundle.sqlite`. App Sandbox is off. Re-run the README install command after a Developer ID cert and notarization credentials are available.
