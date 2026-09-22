import { decodeKey, decodeValue, encodeKey, encodeValue, keysEqual } from "./codec.ts";
import type { KeyPartTag, Tag } from "../shared/tags.ts";

export interface KvEntry {
  key: KeyPartTag[];
  value: Tag | null;
  versionstamp: string | null;
  found: boolean;
}

export interface ListResult {
  entries: KvEntry[];
  cursor: KeyPartTag[] | null;
}

export interface AtomicParams {
  checks?: { key: KeyPartTag[]; versionstamp: string }[];
  sets?: { key: KeyPartTag[]; value: Tag }[];
  deletes?: KeyPartTag[][];
  mutates?: { type: "sum" | "min" | "max"; key: KeyPartTag[]; value: string }[];
}

export class Session {
  kv: Deno.Kv | null = null;

  async open(target: string): Promise<void> {
    if (this.kv) {
      this.kv.close();
      this.kv = null;
    }
    this.kv = await Deno.openKv(target);
  }

  close(): void {
    this.kv?.close();
    this.kv = null;
  }

  async get(key: KeyPartTag[]): Promise<KvEntry> {
    const decoded = decodeKey(key);
    const row = await this.require().get(decoded);
    if (row.versionstamp === null) {
      return { found: false, key, value: null, versionstamp: null };
    }
    return {
      found: true,
      key: encodeKey(row.key),
      value: encodeValue(row.value),
      versionstamp: row.versionstamp,
    };
  }

  async set(
    key: KeyPartTag[],
    value: Tag,
    versionstamp?: string | null,
  ): Promise<{ versionstamp: string }> {
    const decodedKey = decodeKey(key);
    const decodedValue = decodeValue(value);
    const kv = this.require();
    if (versionstamp) {
      const result = await kv.atomic()
        .check({ key: decodedKey, versionstamp })
        .set(decodedKey, decodedValue)
        .commit();
      if (!result.ok) throw new Error("conflict");
      return { versionstamp: result.versionstamp };
    }
    const result = await kv.set(decodedKey, decodedValue);
    return { versionstamp: result.versionstamp };
  }

  async delete(
    key: KeyPartTag[],
    versionstamp?: string | null,
  ): Promise<{ existed: boolean }> {
    const decodedKey = decodeKey(key);
    const kv = this.require();
    const current = await kv.get(decodedKey);
    const existed = current.versionstamp !== null;
    if (versionstamp) {
      const result = await kv.atomic()
        .check({ key: decodedKey, versionstamp })
        .delete(decodedKey)
        .commit();
      if (!result.ok) throw new Error("conflict");
      return { existed };
    }
    await kv.delete(decodedKey);
    return { existed };
  }

  async list(params: {
    prefix: KeyPartTag[];
    start?: KeyPartTag[] | null;
    end?: KeyPartTag[] | null;
    limit?: number;
    reverse?: boolean;
  }): Promise<ListResult> {
    const limit = params.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("limit must be an integer from 1 to 500");
    }
    const prefix = decodeKey(params.prefix);
    const start = params.start && params.start.length > 0 ? decodeKey(params.start) : undefined;
    const end = params.end && params.end.length > 0 ? decodeKey(params.end) : undefined;
    const selector: Deno.KvListSelector = { prefix, start, end };
    const extra = start ? 1 : 0;
    const iter = this.require().list(selector, {
      limit: limit + 1 + extra,
      reverse: params.reverse ?? false,
      consistency: "strong",
    });
    const rows: Deno.KvEntry<unknown>[] = [];
    for await (const row of iter) {
      rows.push(row);
      if (rows.length >= limit + 1 + extra) break;
    }
    if (start && rows.length > 0 && keysEqual(rows[0].key, start)) {
      rows.shift();
    }
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      entries: page.map((row) => ({
        found: true,
        key: encodeKey(row.key),
        value: encodeValue(row.value),
        versionstamp: row.versionstamp,
      })),
      cursor: hasMore ? encodeKey(page[page.length - 1].key) : null,
    };
  }

  async atomic(params: AtomicParams): Promise<{ ok: boolean; versionstamp: string | null }> {
    let op = this.require().atomic();
    for (const check of params.checks ?? []) {
      op = op.check({ key: decodeKey(check.key), versionstamp: check.versionstamp });
    }
    for (const item of params.sets ?? []) {
      op = op.set(decodeKey(item.key), decodeValue(item.value));
    }
    for (const key of params.deletes ?? []) {
      op = op.delete(decodeKey(key));
    }
    for (const mutate of params.mutates ?? []) {
      if (mutate.type !== "sum" && mutate.type !== "min" && mutate.type !== "max") {
        throw new Error("mutation type must be sum, min, or max");
      }
      op = op.mutate({
        type: mutate.type,
        key: decodeKey(mutate.key),
        value: new Deno.KvU64(BigInt(mutate.value)),
      });
    }
    const result = await op.commit();
    if (!result.ok) return { ok: false, versionstamp: null };
    return { ok: true, versionstamp: result.versionstamp };
  }

  async exportPrefix(prefix: KeyPartTag[]): Promise<{ entries: KvEntry[] }> {
    const entries: KvEntry[] = [];
    const iter = this.require().list(
      { prefix: decodeKey(prefix) },
      { consistency: "strong" },
    );
    for await (const row of iter) {
      entries.push({
        found: true,
        key: encodeKey(row.key),
        value: encodeValue(row.value),
        versionstamp: row.versionstamp,
      });
    }
    return { entries };
  }

  async importEntries(entries: { key: KeyPartTag[]; value: Tag }[]): Promise<{ count: number }> {
    const kv = this.require();
    let pending = 0;
    let op = kv.atomic();
    let count = 0;
    const flush = async () => {
      if (pending === 0) return;
      const result = await op.commit();
      if (!result.ok) throw new Error("import failed");
      op = kv.atomic();
      pending = 0;
    };
    for (const entry of entries) {
      op = op.set(decodeKey(entry.key), decodeValue(entry.value));
      pending++;
      count++;
      if (pending === 10) await flush();
    }
    await flush();
    return { count };
  }

  async countPrefix(prefix: KeyPartTag[]): Promise<{ count: number }> {
    let count = 0;
    const iter = this.require().list({ prefix: decodeKey(prefix) }, { consistency: "strong" });
    for await (const _row of iter) count++;
    return { count };
  }

  async deletePrefix(prefix: KeyPartTag[]): Promise<{ count: number }> {
    const kv = this.require();
    const keys: Deno.KvKey[] = [];
    const iter = kv.list({ prefix: decodeKey(prefix) }, { consistency: "strong" });
    for await (const row of iter) keys.push(row.key);
    let pending = 0;
    let op = kv.atomic();
    const flush = async () => {
      if (pending === 0) return;
      const result = await op.commit();
      if (!result.ok) throw new Error("prefix delete failed");
      op = kv.atomic();
      pending = 0;
    };
    for (const key of keys) {
      op = op.delete(key);
      pending++;
      if (pending === 10) await flush();
    }
    await flush();
    return { count: keys.length };
  }

  private require(): Deno.Kv {
    if (!this.kv) throw new Error("no database is open");
    return this.kv;
  }
}
