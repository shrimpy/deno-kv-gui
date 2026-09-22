import type { KeyPartTag, Tag } from "../shared/tags.ts";

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function b64ToBytes(value: string): Uint8Array {
  let bin: string;
  try {
    bin = atob(value);
  } catch {
    throw new Error("bytes value is not valid base64");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function isKvU64(value: unknown): value is { value: bigint } {
  return typeof value === "object" &&
    value !== null &&
    value.constructor?.name === "KvU64" &&
    "value" in value &&
    typeof (value as { value: unknown }).value === "bigint";
}

export function encodeValue(value: unknown): Tag {
  if (value === null) return { t: "null" };
  if (value === undefined) throw new Error("undefined is not a KV value");
  if (typeof value === "string") return { t: "string", v: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite numbers are not supported");
    return { t: "number", v: value };
  }
  if (typeof value === "boolean") return { t: "boolean", v: value };
  if (typeof value === "bigint") return { t: "bigint", v: value.toString() };
  if (value instanceof Uint8Array) return { t: "bytes", v: bytesToB64(value) };
  if (isKvU64(value)) return { t: "u64", v: value.value.toString() };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("invalid date");
    return { t: "date", v: value.toISOString() };
  }
  if (Array.isArray(value)) return { t: "array", v: value.map(encodeValue) };
  if (typeof value === "object") {
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      throw new Error("only Uint8Array bytes are supported");
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      const name = value.constructor?.name ?? "object";
      throw new Error(`unsupported value type: ${name}`);
    }
    const out: Record<string, Tag> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = encodeValue(inner);
    }
    return { t: "object", v: out };
  }
  throw new Error(`unsupported value type: ${typeof value}`);
}

export function decodeValue(tag: Tag): unknown {
  switch (tag.t) {
    case "null":
      return null;
    case "string":
      return tag.v;
    case "number":
      if (!Number.isFinite(tag.v)) throw new Error("non-finite numbers are not supported");
      return tag.v;
    case "boolean":
      return tag.v;
    case "bigint":
      return BigInt(tag.v);
    case "bytes":
      return b64ToBytes(tag.v);
    case "date": {
      const date = new Date(tag.v);
      if (Number.isNaN(date.getTime())) throw new Error("invalid date");
      return date;
    }
    case "u64": {
      const n = BigInt(tag.v);
      if (n < 0n || n > 18446744073709551615n) {
        throw new Error("u64 is out of range");
      }
      return new Deno.KvU64(n);
    }
    case "array":
      return tag.v.map(decodeValue);
    case "object": {
      const out: Record<string, unknown> = Object.create(null);
      for (const [key, inner] of Object.entries(tag.v)) out[key] = decodeValue(inner);
      return out;
    }
  }
}

export function encodeKey(key: Deno.KvKey): KeyPartTag[] {
  return key.map(encodeKeyPart);
}

export function decodeKey(parts: KeyPartTag[]): Deno.KvKey {
  return parts.map(decodeKeyPart);
}

function encodeKeyPart(part: Deno.KvKeyPart): KeyPartTag {
  if (typeof part === "string") return { t: "string", v: part };
  if (typeof part === "number") return { t: "number", v: part };
  if (typeof part === "boolean") return { t: "boolean", v: part };
  if (typeof part === "bigint") return { t: "bigint", v: part.toString() };
  if (part instanceof Uint8Array) return { t: "bytes", v: bytesToB64(part) };
  throw new Error("unsupported key part");
}

function decodeKeyPart(part: KeyPartTag): Deno.KvKeyPart {
  switch (part.t) {
    case "string":
      return part.v;
    case "number":
      return part.v;
    case "boolean":
      return part.v;
    case "bigint":
      return BigInt(part.v);
    case "bytes":
      return b64ToBytes(part.v);
  }
}

export function keysEqual(left: Deno.KvKey, right: Deno.KvKey): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    const a = left[i];
    const b = right[i];
    if (typeof a === "bigint" || typeof b === "bigint") {
      if (typeof a !== "bigint" || typeof b !== "bigint" || a !== b) return false;
      continue;
    }
    if (a instanceof Uint8Array || b instanceof Uint8Array) {
      if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
      if (a.length !== b.length || a.some((byte, index) => byte !== b[index])) return false;
      continue;
    }
    if (a !== b) return false;
  }
  return true;
}
