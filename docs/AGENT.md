# Agent operating rules

These rules are the implementation contract. Work from `docs/TASKS.md`.

- Do exactly one task: status `pending`, and every id in `depends` is `done`.
- Set that task to `in_progress` before editing product code. Leave `started` as the date.
- Touch only the files that task needs. If new work appears, append a `pending` task. Do not do it in the same session.
- Run the task’s verification. On success set `done`, and write what changed and the command output summary in `notes`.
- On failure set `blocked`, write the blocker, and stop. Do not start the next task.
- Do not mark `done` without verification. Do not commit unless the user asks.
- Stop after one task and report: task id, new status, verification result.

Status values: `pending`, `in_progress`, `blocked`, `done`.

Session prompt:

```text
You are implementing the Mac Deno KV app in this repo.
Read docs/AGENT.md and docs/TASKS.md.
Choose the single eligible task (pending, dependencies done).
Set it to in_progress, implement only that task, run its verification, then set done or blocked.
Update docs/TASKS.md in the same session.
Stop after that task and report id, status, and verification.
```

## Product constraints

- Tauri 2 shell, React + TypeScript UI, Deno sidecar is the only process that calls `Deno.openKv`.
- Distribute as a Developer ID–signed, notarized DMG. Do not enable the App Sandbox. Do not submit to the Mac App Store.
- Tokens live in the macOS Keychain. Connection JSON must not contain a token.
- Required entry operations: list, exact lookup, create, update, delete.
- Remote open receives `DENO_KV_ACCESS_TOKEN` only as the child process environment.
