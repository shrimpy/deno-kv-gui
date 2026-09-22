import { useCallback, useEffect, useMemo, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  connectUrl,
  environmentFromDatabaseName,
  needsProductionConfirm,
  type Environment,
} from "../shared/environment.ts";
import { formatKey, tagPreview, type KeyPartTag, type Tag } from "../shared/tags.ts";
import * as api from "./api.ts";
import { draftFromTag, emptyDraft, tagFromDraft, type ValueDraft, type ValueKind } from "./draft.ts";
import type { Connection, ConnectionKind, DatabaseDraft, KvEntry, UrlShape } from "./types.ts";

const ENVIRONMENTS: Environment[] = [
  "local",
  "memory",
  "production",
  "preview",
  "branch",
  "classic",
  "self-hosted",
];

const VALUE_KINDS: ValueKind[] = [
  "string",
  "number",
  "boolean",
  "null",
  "bigint",
  "u64",
  "bytes",
  "date",
  "json",
  "tagged",
];

interface FormState {
  id: string;
  name: string;
  kind: ConnectionKind;
  environment: Environment;
  path: string;
  urlShape: UrlShape;
  databaseId: string;
  url: string;
  token: string;
}

interface ConfirmState {
  title: string;
  body: string;
  confirmLabel: string;
  resolve: (value: boolean) => void;
}

function blankPart(kind: KeyPartTag["t"]): KeyPartTag {
  switch (kind) {
    case "string":
      return { t: "string", v: "" };
    case "number":
      return { t: "number", v: 0 };
    case "boolean":
      return { t: "boolean", v: false };
    case "bigint":
      return { t: "bigint", v: "0" };
    case "bytes":
      return { t: "bytes", v: "" };
  }
}

function emptyForm(): FormState {
  return {
    id: crypto.randomUUID(),
    name: "",
    kind: "memory",
    environment: "memory",
    path: "",
    urlShape: "v2",
    databaseId: "",
    url: "",
    token: "",
  };
}

function formFromConnection(connection: Connection): FormState {
  return {
    id: connection.id,
    name: connection.name,
    kind: connection.kind,
    environment: connection.environment,
    path: connection.path ?? "",
    urlShape: connection.urlShape ?? "v2",
    databaseId: connection.databaseId ?? "",
    url: connection.url ?? "",
    token: "",
  };
}

export function App() {
  const [workerLabel, setWorkerLabel] = useState("Starting worker…");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [tokenEdited, setTokenEdited] = useState(false);
  const [prefix, setPrefix] = useState<KeyPartTag[]>([]);
  const [lookupKey, setLookupKey] = useState<KeyPartTag[]>([blankPart("string")]);
  const [entries, setEntries] = useState<KvEntry[]>([]);
  const [cursor, setCursor] = useState<KeyPartTag[] | null>(null);
  const [pageStart, setPageStart] = useState<KeyPartTag[] | null>(null);
  const [editorKey, setEditorKey] = useState<KeyPartTag[]>([blankPart("string")]);
  const [draft, setDraft] = useState<ValueDraft>(emptyDraft());
  const [mode, setMode] = useState<"create" | "update">("create");
  const [versionstamp, setVersionstamp] = useState<string | null>(null);
  const [lookupNote, setLookupNote] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [deployMessage, setDeployMessage] = useState("");
  const [drafts, setDrafts] = useState<DatabaseDraft[]>([]);
  const [counterDelta, setCounterDelta] = useState("1");

  const active = connections.find((connection) => connection.id === activeId) ?? null;

  const ask = useCallback((title: string, body: string, confirmLabel: string) => {
    return new Promise<boolean>((resolve) => {
      setConfirm({ title, body, confirmLabel, resolve });
    });
  }, []);

  const refreshConnections = useCallback(async () => {
    setConnections(await api.listConnections());
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const result = await api.ping();
        setWorkerLabel(result.pong ? "Worker ready" : "Worker did not respond");
        await refreshConnections();
      } catch (caught) {
        setWorkerLabel("Worker unavailable");
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
  }, [refreshConnections]);

  async function guardWrite(action: string): Promise<boolean> {
    if (!active || !needsProductionConfirm(active.environment)) return true;
    return ask(
      "Production database",
      `${action} “${active.name}”. This changes the production database.`,
      "Write to production",
    );
  }

  async function connectTo(connection: Connection) {
    setError("");
    setStatus("");
    try {
      await api.kvOpen(connection.id);
      setActiveId(connection.id);
      setEntries([]);
      setCursor(null);
      setPageStart(null);
      setLookupNote("");
      setStatus(`Connected to ${connection.name}`);
    } catch (caught) {
      setActiveId(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function disconnect() {
    setError("");
    try {
      await api.kvClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
    setActiveId(null);
    setEntries([]);
    setStatus("Disconnected");
  }

  async function saveForm() {
    if (!form) return;
    setError("");
    const url = form.kind === "remote"
      ? form.urlShape === "custom" ? form.url.trim() : connectUrl(form.urlShape, form.databaseId, form.url)
      : "";
    const connection: Connection = {
      id: form.id,
      name: form.name.trim(),
      kind: form.kind,
      environment: form.environment,
      path: form.kind === "local-file" ? form.path.trim() : null,
      url: form.kind === "remote" ? url : null,
      databaseId: form.kind === "remote" ? form.databaseId.trim() : null,
      urlShape: form.kind === "remote" ? form.urlShape : null,
      hasToken: false,
    };
    try {
      const saved = await api.saveConnection(connection, tokenEdited ? form.token : null);
      setTokenEdited(false);
      setForm(formFromConnection(saved));
      await refreshConnections();
      setStatus(`Saved ${saved.name}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function removeConnection(connection: Connection) {
    const ok = await ask("Remove connection", `Remove “${connection.name}” from this app? The database itself is not deleted.`, "Remove");
    if (!ok) return;
    if (activeId === connection.id) await disconnect();
    await api.deleteConnection(connection.id);
    if (form?.id === connection.id) setForm(null);
    await refreshConnections();
  }

  async function browse(start: KeyPartTag[] | null) {
    if (!active) return;
    setError("");
    try {
      const result = await api.kvList({ prefix, start, limit: 25 });
      setEntries(result.entries);
      setCursor(result.cursor);
      setPageStart(start);
      setStatus(result.entries.length === 0 ? "No keys on this page" : `${result.entries.length} keys`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function lookup() {
    if (!active) return;
    setError("");
    setLookupNote("");
    try {
      const result = await api.kvGet(lookupKey);
      if (!result.found || !result.value) {
        setLookupNote("Not found");
        setMode("create");
        setEditorKey(lookupKey);
        setDraft(emptyDraft());
        setVersionstamp(null);
        return;
      }
      loadEntry(result);
      setLookupNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function loadEntry(entry: KvEntry) {
    setEditorKey(entry.key);
    setLookupKey(entry.key);
    setVersionstamp(entry.versionstamp);
    setMode("update");
    setDraft(entry.value ? draftFromTag(entry.value) : emptyDraft());
    setLookupNote("");
  }

  function startCreate() {
    setMode("create");
    setVersionstamp(null);
    setDraft(emptyDraft());
    setLookupNote("");
    setEditorKey(lookupKey);
  }

  async function saveEntry() {
    if (!active) return;
    setError("");
    const creating = mode === "create";
    const allowed = await guardWrite(creating ? "Create a key in" : "Update a key in");
    if (!allowed) return;
    try {
      const value = tagFromDraft(draft);
      if (creating) {
        const existing = await api.kvGet(editorKey);
        if (existing.found) {
          setError("This key already exists. Update it instead.");
          loadEntry(existing);
          return;
        }
        const result = await api.kvSet(editorKey, value);
        setVersionstamp(result.versionstamp);
        setMode("update");
        setStatus("Created");
      } else {
        const result = await api.kvSet(editorKey, value, versionstamp);
        setVersionstamp(result.versionstamp);
        setStatus("Updated");
      }
      await browse(pageStart);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message === "conflict" ? "This entry changed. Look it up again before saving." : message);
    }
  }

  async function deleteEntry() {
    if (!active) return;
    const allowed = await guardWrite("Delete a key from");
    if (!allowed) return;
    if (!needsProductionConfirm(active.environment)) {
      const ok = await ask("Delete key", `Delete ${formatKey(editorKey)}?`, "Delete");
      if (!ok) return;
    }
    try {
      const result = await api.kvDelete(editorKey, versionstamp);
      setStatus(result.existed ? "Deleted" : "Key is already gone");
      setMode("create");
      setVersionstamp(null);
      setDraft(emptyDraft());
      await browse(pageStart);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message === "conflict" ? "This entry changed. Look it up again before deleting." : message);
    }
  }

  async function mutateCounter(type: "sum" | "min" | "max") {
    if (!active) return;
    const allowed = await guardWrite(`Apply ${type} on`);
    if (!allowed) return;
    try {
      const result = await api.kvAtomic({
        mutates: [{ type, key: editorKey, value: counterDelta.trim() }],
      });
      if (!result.ok) {
        setError("Counter update did not commit");
        return;
      }
      const entry = await api.kvGet(editorKey);
      if (entry.found) loadEntry(entry);
      setStatus(`Applied ${type}`);
      await browse(pageStart);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function exportPrefix() {
    if (!active) return;
    try {
      const result = await api.kvExportPrefix(prefix);
      const path = await save({ defaultPath: "kv-export.json", filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!path) return;
      await api.writeTextFile(path, JSON.stringify({ version: 1, entries: result.entries }, null, 2));
      setStatus(`Exported ${result.entries.length} entries`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function importPrefix() {
    if (!active) return;
    const allowed = await guardWrite("Import entries into");
    if (!allowed) return;
    try {
      const picked = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (typeof picked !== "string") return;
      const text = await api.readTextFile(picked);
      const parsed = JSON.parse(text) as { entries?: { key: KeyPartTag[]; value: Tag }[] };
      if (!Array.isArray(parsed.entries)) throw new Error("export file has no entries array");
      const result = await api.kvImportEntries(parsed.entries);
      setStatus(`Imported ${result.count} entries`);
      await browse(pageStart);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function deletePrefix() {
    if (!active) return;
    try {
      const { count } = await api.kvCountPrefix(prefix);
      const label = prefix.length === 0 ? "every key" : formatKey(prefix);
      if (needsProductionConfirm(active.environment)) {
        const ok = await ask(
          "Production database",
          `Delete ${count} entries under ${label} in “${active.name}”. This changes the production database.`,
          "Delete from production",
        );
        if (!ok) return;
      } else {
        const ok = await ask("Delete prefix", `Delete ${count} entries under ${label}?`, "Delete");
        if (!ok) return;
      }
      const result = await api.kvDeletePrefix(prefix);
      setStatus(`Deleted ${result.count} entries`);
      await browse(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function checkDeploy() {
    if (!form) return;
    setDeployMessage("");
    setDrafts([]);
    try {
      const result = await api.deployList(form.id, tokenEdited ? form.token : null);
      setDrafts(result.databases);
      setDeployMessage(result.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function applyDraft(item: DatabaseDraft) {
    if (!form) return;
    const suggested = environmentFromDatabaseName(item.name);
    setForm({
      ...form,
      name: item.name,
      kind: "remote",
      environment: (suggested ?? item.environment) as Environment,
      databaseId: item.databaseId,
      url: item.url,
      urlShape: item.urlShape === "classic" || item.urlShape === "custom" ? item.urlShape : "v2",
    });
  }

  async function pickFile() {
    const picked = await open({ multiple: false });
    if (typeof picked === "string" && form) setForm({ ...form, path: picked });
  }

  const suggested = useMemo(() => {
    if (!form || form.kind !== "remote") return null;
    return environmentFromDatabaseName(form.name);
  }, [form]);

  const resolvedUrl = form && form.kind === "remote"
    ? form.urlShape === "custom" ? form.url : connectUrl(form.urlShape, form.databaseId, form.url)
    : "";

  return (
    <div className="app">
      <header>
        <div>
          <p className="eyebrow">Deno KV</p>
          <h1>Database manager</h1>
        </div>
        <p className={workerLabel === "Worker ready" ? "worker ok" : "worker"}>{workerLabel}</p>
      </header>
      {error ? <p className="banner error" role="alert">{error}</p> : null}
      {status ? <p className="banner">{status}</p> : null}
      <div className="layout">
        <aside>
          <div className="row">
            <h2>Connections</h2>
            <button type="button" aria-label="Add connection" onClick={() => { setForm(emptyForm()); setTokenEdited(false); setDeployMessage(""); setDrafts([]); }}>Add</button>
          </div>
          <ul className="connections">
            {connections.map((connection) => (
              <li key={connection.id} className={connection.id === activeId ? "active" : ""}>
                <button type="button" className="link" aria-label={`Connect ${connection.name}`} onClick={() => void connectTo(connection)}>
                  <span>{connection.name}</span>
                  <em className={`badge ${connection.environment}`}>{connection.environment}</em>
                </button>
                <button type="button" className="text" aria-label={`Edit ${connection.name}`} onClick={() => { setForm(formFromConnection(connection)); setTokenEdited(false); }}>Edit</button>
              </li>
            ))}
          </ul>
          {form ? (
            <form className="panel" onSubmit={(event) => { event.preventDefault(); void saveForm(); }}>
              <label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label>Kind
                <select value={form.kind} onChange={(event) => {
                  const kind = event.target.value as ConnectionKind;
                  const environment: Environment = kind === "memory" ? "memory" : kind === "local-file" ? "local" : form.environment;
                  setForm({ ...form, kind, environment });
                }}>
                  <option value="memory">In memory</option>
                  <option value="local-file">Local file</option>
                  <option value="remote">Remote KV Connect</option>
                </select>
              </label>
              <label>Environment
                <select value={form.environment} onChange={(event) => setForm({ ...form, environment: event.target.value as Environment })}>
                  {ENVIRONMENTS.map((environment) => <option key={environment} value={environment}>{environment}</option>)}
                </select>
              </label>
              {suggested && suggested !== form.environment ? (
                <button type="button" className="text" onClick={() => setForm({ ...form, environment: suggested })}>
                  Use suggested environment: {suggested}
                </button>
              ) : null}
              {form.kind === "local-file" ? (
                <label>File
                  <span className="inline">
                    <input value={form.path} onChange={(event) => setForm({ ...form, path: event.target.value })} />
                    <button type="button" onClick={() => void pickFile()}>Browse</button>
                  </span>
                </label>
              ) : null}
              {form.kind === "remote" ? (
                <>
                  <label>URL shape
                    <select value={form.urlShape} onChange={(event) => setForm({ ...form, urlShape: event.target.value as UrlShape })}>
                      <option value="v2">Deploy v2 timeline</option>
                      <option value="classic">Deploy Classic</option>
                      <option value="custom">Custom KV Connect URL</option>
                    </select>
                  </label>
                  {form.urlShape === "custom" ? (
                    <label>URL<input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} /></label>
                  ) : (
                    <label>Database id<input value={form.databaseId} onChange={(event) => setForm({ ...form, databaseId: event.target.value })} /></label>
                  )}
                  {resolvedUrl ? <p className="hint">{resolvedUrl}</p> : null}
                  <label>Access token
                    <input type="password" value={form.token} placeholder={connections.find((item) => item.id === form.id)?.hasToken ? "Saved in Keychain" : "ddo_…"} onChange={(event) => { setTokenEdited(true); setForm({ ...form, token: event.target.value }); }} />
                  </label>
                  <button type="button" onClick={() => void checkDeploy()}>Check Deploy API</button>
                  {deployMessage ? <p className="hint">{deployMessage}</p> : null}
                  {drafts.length > 0 ? (
                    <ul className="drafts">
                      {drafts.map((item) => (
                        <li key={item.databaseId}>
                          <button type="button" onClick={() => applyDraft(item)}>{item.name}</button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : null}
              <div className="row">
                <button type="submit" aria-label="Save connection">Save</button>
                <button type="button" aria-label="Remove connection" onClick={() => void removeConnection({ ...form, hasToken: false, path: form.path, url: form.url })}>Remove</button>
              </div>
            </form>
          ) : null}
        </aside>
        <main>
          {!active ? <p className="empty">Connect to a database to list, look up, create, update, and delete entries.</p> : (
            <>
              <div className="row">
                <h2>{active.name}</h2>
                <em className={`badge ${active.environment}`}>{active.environment}</em>
                <button type="button" aria-label="Disconnect" onClick={() => void disconnect()}>Disconnect</button>
              </div>
              <section className="panel">
                <h3>Lookup</h3>
                <KeyEditor parts={lookupKey} onChange={setLookupKey} />
                <button type="button" aria-label="Look up key" onClick={() => void lookup()}>Look up</button>
                {lookupNote ? <p className="hint" role="status">{lookupNote}</p> : null}
              </section>
              <section className="panel">
                <h3>Browse</h3>
                <KeyEditor parts={prefix} onChange={setPrefix} allowEmpty />
                <div className="row">
                  <button type="button" aria-label="List keys" onClick={() => void browse(null)}>List</button>
                  <button type="button" aria-label="Next page" onClick={() => void browse(cursor)} disabled={!cursor}>Next page</button>
                  <button type="button" aria-label="Export prefix" onClick={() => void exportPrefix()}>Export prefix</button>
                  <button type="button" aria-label="Import entries" onClick={() => void importPrefix()}>Import</button>
                  <button type="button" aria-label="Delete prefix" onClick={() => void deletePrefix()}>Delete prefix</button>
                </div>
                <table>
                  <thead><tr><th>Key</th><th>Value</th></tr></thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={JSON.stringify(entry.key)} onClick={() => loadEntry(entry)}>
                        <td>{formatKey(entry.key)}</td>
                        <td>{entry.value ? tagPreview(entry.value) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="panel">
                <div className="row">
                  <h3>{mode === "create" ? "Create entry" : "Update entry"}</h3>
                  <button type="button" aria-label="New entry" onClick={startCreate}>New entry</button>
                </div>
                <KeyEditor parts={editorKey} onChange={setEditorKey} />
                <label>Value type
                  <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as ValueKind })}>
                    {VALUE_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                  </select>
                </label>
                <ValueEditor draft={draft} onChange={setDraft} />
                {versionstamp ? <p className="hint">versionstamp {versionstamp}</p> : null}
                <div className="row">
                  <button type="button" aria-label={mode === "create" ? "Create entry" : "Update entry"} onClick={() => void saveEntry()}>{mode === "create" ? "Create" : "Update"}</button>
                  {mode === "update" ? <button type="button" aria-label="Delete entry" onClick={() => void deleteEntry()}>Delete</button> : null}
                </div>
                {mode === "update" && draft.kind === "u64" ? (
                  <div className="row">
                    <label>Amount<input value={counterDelta} onChange={(event) => setCounterDelta(event.target.value)} /></label>
                    <button type="button" onClick={() => void mutateCounter("sum")}>Sum</button>
                    <button type="button" onClick={() => void mutateCounter("min")}>Min</button>
                    <button type="button" onClick={() => void mutateCounter("max")}>Max</button>
                  </div>
                ) : null}
              </section>
            </>
          )}
        </main>
      </div>
      {confirm ? (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="dialog">
            <h3 id="confirm-title">{confirm.title}</h3>
            <p>{confirm.body}</p>
            <div className="row">
              <button type="button" aria-label={confirm.confirmLabel} onClick={() => { confirm.resolve(true); setConfirm(null); }}>{confirm.confirmLabel}</button>
              <button type="button" aria-label="Cancel" onClick={() => { confirm.resolve(false); setConfirm(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function KeyEditor({
  parts,
  onChange,
  allowEmpty = false,
}: {
  parts: KeyPartTag[];
  onChange: (parts: KeyPartTag[]) => void;
  allowEmpty?: boolean;
}) {
  function update(index: number, part: KeyPartTag) {
    onChange(parts.map((current, currentIndex) => currentIndex === index ? part : current));
  }
  return (
    <div className="keys">
      {parts.length === 0 && allowEmpty ? <p className="hint">Empty prefix lists every key.</p> : null}
      {parts.map((part, index) => (
        <div className="inline" key={index}>
          <select value={part.t} onChange={(event) => update(index, blankPart(event.target.value as KeyPartTag["t"]))}>
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="bigint">bigint</option>
            <option value="bytes">bytes</option>
          </select>
          {part.t === "boolean" ? (
            <select value={String(part.v)} onChange={(event) => update(index, { t: "boolean", v: event.target.value === "true" })}>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : (
            <input
              value={String(part.v)}
              onChange={(event) => {
                const text = event.target.value;
                if (part.t === "number") update(index, { t: "number", v: Number(text) });
                else if (part.t === "string") update(index, { t: "string", v: text });
                else if (part.t === "bigint") update(index, { t: "bigint", v: text });
                else if (part.t === "bytes") update(index, { t: "bytes", v: text });
              }}
            />
          )}
          <button type="button" aria-label="Remove key part" onClick={() => onChange(parts.filter((_, currentIndex) => currentIndex !== index))}>Remove</button>
        </div>
      ))}
      <button type="button" aria-label="Add key part" onClick={() => onChange([...parts, blankPart("string")])}>Add key part</button>
    </div>
  );
}

function ValueEditor({ draft, onChange }: { draft: ValueDraft; onChange: (draft: ValueDraft) => void }) {
  if (draft.kind === "null") return <p className="hint">Stored as null.</p>;
  if (draft.kind === "boolean") {
    return (
      <label>Boolean
        <select value={String(draft.bool)} onChange={(event) => onChange({ ...draft, bool: event.target.value === "true" })}>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </label>
    );
  }
  const long = draft.kind === "json" || draft.kind === "tagged" || draft.kind === "string" || draft.kind === "bytes";
  return (
    <label>
      {draft.kind === "bytes" ? "Base64" : draft.kind === "u64" ? "Unsigned integer" : "Value"}
      {long ? (
        <textarea value={draft.text} onChange={(event) => onChange({ ...draft, text: event.target.value })} rows={draft.kind === "json" || draft.kind === "tagged" ? 8 : 3} />
      ) : (
        <input
          type={draft.kind === "date" ? "datetime-local" : "text"}
          value={draft.text}
          onChange={(event) => onChange({ ...draft, text: event.target.value })}
        />
      )}
    </label>
  );
}
