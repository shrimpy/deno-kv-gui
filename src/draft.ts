import { isSpecial, jsonToTag, tagToJson, type Tag } from "../shared/tags.ts";

export type ValueKind =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "bigint"
  | "u64"
  | "bytes"
  | "date"
  | "json"
  | "tagged";

export interface ValueDraft {
  kind: ValueKind;
  text: string;
  bool: boolean;
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function emptyDraft(): ValueDraft {
  return { kind: "string", text: "", bool: false };
}

export function draftFromTag(tag: Tag): ValueDraft {
  if (tag.t === "array" || tag.t === "object") {
    if (isSpecial(tag)) {
      return { kind: "tagged", text: JSON.stringify(tag, null, 2), bool: false };
    }
    return { kind: "json", text: JSON.stringify(tagToJson(tag), null, 2), bool: false };
  }
  switch (tag.t) {
    case "null":
      return { kind: "null", text: "", bool: false };
    case "boolean":
      return { kind: "boolean", text: "", bool: tag.v };
    case "string":
    case "number":
    case "bigint":
    case "u64":
    case "bytes":
      return { kind: tag.t, text: String(tag.v), bool: false };
    case "date":
      return { kind: "date", text: toLocalInput(tag.v), bool: false };
  }
}

export function tagFromDraft(draft: ValueDraft): Tag {
  switch (draft.kind) {
    case "null":
      return { t: "null" };
    case "string":
      return { t: "string", v: draft.text };
    case "number": {
      const value = Number(draft.text);
      if (!Number.isFinite(value)) throw new Error("enter a finite number");
      return { t: "number", v: value };
    }
    case "boolean":
      return { t: "boolean", v: draft.bool };
    case "bigint":
      return { t: "bigint", v: BigInt(draft.text.trim()).toString() };
    case "u64": {
      const value = BigInt(draft.text.trim());
      if (value < 0n || value > 18446744073709551615n) throw new Error("u64 is out of range");
      return { t: "u64", v: value.toString() };
    }
    case "bytes": {
      const text = draft.text.trim();
      if (!text) throw new Error("enter base64 bytes");
      return { t: "bytes", v: text };
    }
    case "date": {
      const date = new Date(draft.text);
      if (Number.isNaN(date.getTime())) throw new Error("enter a valid date");
      return { t: "date", v: date.toISOString() };
    }
    case "json":
      return jsonToTag(JSON.parse(draft.text || "null"));
    case "tagged":
      return JSON.parse(draft.text) as Tag;
  }
}
