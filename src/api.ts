import { invoke } from "@tauri-apps/api/core";
import type { KeyPartTag, Tag } from "../shared/tags.ts";
import type { Connection, DeployList, KvEntry, ListResult } from "./types.ts";

export function ping(): Promise<{ pong: boolean; app: string }> {
  return invoke("ping");
}

export function listConnections(): Promise<Connection[]> {
  return invoke("list_connections");
}

export function saveConnection(
  connection: Connection,
  token: string | null,
): Promise<Connection> {
  return invoke("save_connection", { connection, token });
}

export function deleteConnection(id: string): Promise<void> {
  return invoke("delete_connection", { id });
}

export function kvOpen(id: string): Promise<{ open: boolean }> {
  return invoke("kv_open", { id });
}

export function kvClose(): Promise<{ open: boolean }> {
  return invoke("kv_close");
}

export function kvGet(key: KeyPartTag[]): Promise<KvEntry> {
  return invoke("kv_call", { method: "get", params: { key } });
}

export function kvSet(
  key: KeyPartTag[],
  value: Tag,
  versionstamp?: string | null,
): Promise<{ versionstamp: string }> {
  return invoke("kv_call", { method: "set", params: { key, value, versionstamp: versionstamp ?? null } });
}

export function kvDelete(
  key: KeyPartTag[],
  versionstamp?: string | null,
): Promise<{ existed: boolean }> {
  return invoke("kv_call", {
    method: "delete",
    params: { key, versionstamp: versionstamp ?? null },
  });
}

export function kvList(params: {
  prefix: KeyPartTag[];
  start?: KeyPartTag[] | null;
  limit?: number;
  reverse?: boolean;
}): Promise<ListResult> {
  return invoke("kv_call", { method: "list", params });
}

export function kvAtomic(params: {
  mutates: { type: "sum" | "min" | "max"; key: KeyPartTag[]; value: string }[];
}): Promise<{ ok: boolean; versionstamp: string | null }> {
  return invoke("kv_call", { method: "atomic", params });
}

export function kvExportPrefix(prefix: KeyPartTag[]): Promise<{ entries: KvEntry[] }> {
  return invoke("kv_call", { method: "exportPrefix", params: { prefix } });
}

export function kvImportEntries(
  entries: { key: KeyPartTag[]; value: Tag }[],
): Promise<{ count: number }> {
  return invoke("kv_call", { method: "importEntries", params: { entries } });
}

export function kvCountPrefix(prefix: KeyPartTag[]): Promise<{ count: number }> {
  return invoke("kv_call", { method: "countPrefix", params: { prefix } });
}

export function kvDeletePrefix(prefix: KeyPartTag[]): Promise<{ count: number }> {
  return invoke("kv_call", { method: "deletePrefix", params: { prefix } });
}

export function deployList(
  connectionId: string | null,
  token: string | null,
): Promise<DeployList> {
  return invoke("deploy_list", { connectionId, token });
}

export function writeTextFile(path: string, contents: string): Promise<void> {
  return invoke("write_text_file", { path, contents });
}

export function readTextFile(path: string): Promise<string> {
  return invoke("read_text_file", { path });
}
