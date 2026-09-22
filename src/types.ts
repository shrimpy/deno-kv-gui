import type { KeyPartTag, Tag } from "../shared/tags.ts";
import type { Environment } from "../shared/environment.ts";

export type ConnectionKind = "local-file" | "memory" | "remote";
export type UrlShape = "v2" | "classic" | "custom";

export interface Connection {
  id: string;
  name: string;
  kind: ConnectionKind;
  environment: Environment;
  path?: string | null;
  url?: string | null;
  databaseId?: string | null;
  urlShape?: UrlShape | null;
  hasToken: boolean;
}

export interface KvEntry {
  found: boolean;
  key: KeyPartTag[];
  value: Tag | null;
  versionstamp: string | null;
}

export interface ListResult {
  entries: KvEntry[];
  cursor: KeyPartTag[] | null;
}

export interface DatabaseDraft {
  name: string;
  databaseId: string;
  url: string;
  urlShape: UrlShape | string;
  environment: string;
}

export interface DeployList {
  available: boolean;
  databases: DatabaseDraft[];
  message: string;
}
