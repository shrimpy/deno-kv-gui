export type KeyPartTag =
  | { t: "string"; v: string }
  | { t: "number"; v: number }
  | { t: "boolean"; v: boolean }
  | { t: "bigint"; v: string }
  | { t: "bytes"; v: string };

export type Tag =
  | { t: "null" }
  | { t: "string"; v: string }
  | { t: "number"; v: number }
  | { t: "boolean"; v: boolean }
  | { t: "bigint"; v: string }
  | { t: "bytes"; v: string }
  | { t: "date"; v: string }
  | { t: "u64"; v: string }
  | { t: "array"; v: Tag[] }
  | { t: "object"; v: Record<string, Tag> };

export function isSpecial(tag: Tag): boolean {
  switch (tag.t) {
    case "bigint":
    case "bytes":
    case "date":
    case "u64":
      return true;
    case "array":
      return tag.v.some(isSpecial);
    case "object":
      return Object.values(tag.v).some(isSpecial);
    default:
      return false;
  }
}

export function jsonToTag(value: unknown): Tag {
  if (value === null) return { t: "null" };
  if (typeof value === "string") return { t: "string", v: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite numbers are not supported");
    return { t: "number", v: value };
  }
  if (typeof value === "boolean") return { t: "boolean", v: value };
  if (Array.isArray(value)) return { t: "array", v: value.map(jsonToTag) };
  if (typeof value === "object") {
    const out: Record<string, Tag> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = jsonToTag(inner);
    }
    return { t: "object", v: out };
  }
  throw new Error(`unsupported JSON value: ${typeof value}`);
}

export function tagToJson(tag: Tag): unknown {
  if (isSpecial(tag)) throw new Error("value contains KV types that are not JSON");
  switch (tag.t) {
    case "null":
      return null;
    case "string":
    case "number":
    case "boolean":
      return tag.v;
    case "array":
      return tag.v.map(tagToJson);
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(tag.v)) out[key] = tagToJson(inner);
      return out;
    }
    default:
      throw new Error("value contains KV types that are not JSON");
  }
}

export function tagPreview(tag: Tag, max = 80): string {
  const text = previewInner(tag);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function previewInner(tag: Tag): string {
  switch (tag.t) {
    case "null":
      return "null";
    case "string":
      return JSON.stringify(tag.v);
    case "number":
    case "boolean":
      return String(tag.v);
    case "bigint":
      return `${tag.v}n`;
    case "u64":
      return `u64:${tag.v}`;
    case "bytes":
      return `bytes:${tag.v}`;
    case "date":
      return tag.v;
    case "array":
    case "object":
      try {
        return JSON.stringify(tagToJson(tag));
      } catch {
        return JSON.stringify(tag);
      }
  }
}

export function formatKey(parts: KeyPartTag[]): string {
  if (parts.length === 0) return "(empty key)";
  return parts.map(formatPart).join(" / ");
}

function formatPart(part: KeyPartTag): string {
  switch (part.t) {
    case "string":
      return part.v === "" ? '""' : part.v;
    case "number":
      return String(part.v);
    case "boolean":
      return String(part.v);
    case "bigint":
      return `${part.v}n`;
    case "bytes":
      return `bytes:${part.v}`;
  }
}
