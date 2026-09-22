import type { KeyPartTag, Tag } from "../shared/tags.ts";
import { Session, type AtomicParams } from "./session.ts";

const session = new Session();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Request = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
};

async function dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "ping":
      return { pong: true, app: "Deno KV" };
    case "open":
      await session.open(String(params.target ?? ""));
      return { open: true };
    case "close":
      session.close();
      return { open: false };
    case "get":
      return await session.get(params.key as KeyPartTag[]);
    case "set":
      return await session.set(
        params.key as KeyPartTag[],
        params.value as Tag,
        (params.versionstamp as string | null | undefined) ?? null,
      );
    case "delete":
      return await session.delete(
        params.key as KeyPartTag[],
        (params.versionstamp as string | null | undefined) ?? null,
      );
    case "list":
      return await session.list({
        prefix: (params.prefix as KeyPartTag[]) ?? [],
        start: (params.start as KeyPartTag[] | null) ?? null,
        end: (params.end as KeyPartTag[] | null) ?? null,
        limit: params.limit as number | undefined,
        reverse: params.reverse as boolean | undefined,
      });
    case "atomic":
      return await session.atomic(params as AtomicParams);
    case "exportPrefix":
      return await session.exportPrefix((params.prefix as KeyPartTag[]) ?? []);
    case "importEntries":
      return await session.importEntries(
        (params.entries as { key: KeyPartTag[]; value: Tag }[]) ?? [],
      );
    case "countPrefix":
      return await session.countPrefix((params.prefix as KeyPartTag[]) ?? []);
    case "deletePrefix":
      return await session.deletePrefix((params.prefix as KeyPartTag[]) ?? []);
    default:
      throw new Error(`unknown method: ${method}`);
  }
}

async function respond(id: number | undefined, ok: boolean, payload: unknown): Promise<void> {
  const body = ok
    ? { id, ok: true, result: payload }
    : { id, ok: false, error: payload instanceof Error ? payload.message : String(payload) };
  await Deno.stdout.write(encoder.encode(`${JSON.stringify(body)}\n`));
}

let carry = "";
const reader = Deno.stdin.readable.getReader();
try {
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    let newline = carry.indexOf("\n");
    while (newline >= 0) {
      const line = carry.slice(0, newline).trim();
      carry = carry.slice(newline + 1);
      newline = carry.indexOf("\n");
      if (!line) continue;
      let request: Request;
      try {
        request = JSON.parse(line) as Request;
      } catch {
        await respond(undefined, false, "invalid json");
        continue;
      }
      try {
        const result = await dispatch(request.method ?? "", request.params ?? {});
        await respond(request.id, true, result);
      } catch (error) {
        await respond(request.id, false, error);
      }
    }
  }
} finally {
  session.close();
  reader.releaseLock();
}
