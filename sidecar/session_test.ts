import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { KeyPartTag, Tag } from "../shared/tags.ts";
import { Session } from "./session.ts";

function key(...parts: string[]): KeyPartTag[] {
  return parts.map((part) => ({ t: "string", v: part }));
}

function str(value: string): Tag {
  return { t: "string", v: value };
}

Deno.test("memory and file open, write, read, close", async () => {
  const memory = new Session();
  await memory.open(":memory:");
  await memory.set(key("a"), str("one"));
  const got = await memory.get(key("a"));
  assertEquals(got.found, true);
  assertEquals(got.value, str("one"));
  memory.close();

  const dir = await Deno.makeTempDir();
  const path = `${dir}/store.kv`;
  const file = new Session();
  await file.open(path);
  await file.set(key("file"), str("persisted"));
  file.close();

  const again = new Session();
  await again.open(path);
  const loaded = await again.get(key("file"));
  assertEquals(loaded.value, str("persisted"));
  again.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("remote open to a closed port fails", async () => {
  const session = new Session();
  await assertRejects(() =>
    Promise.race([
      session.open("http://127.0.0.1:9/connect"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2500)),
    ])
  );
  session.close();
});

Deno.test("list lookup create update delete", async () => {
  const session = new Session();
  await session.open(":memory:");
  const names = ["a", "b", "c", "d", "e"];
  for (const name of names) {
    await session.set(key("users", name), str(name));
  }

  const missing = await session.get(key("users", "missing"));
  assertEquals(missing.found, false);
  assertEquals(missing.versionstamp, null);

  const exact = await session.get(key("users", "c"));
  assertEquals(exact.found, true);
  assertEquals(exact.value, str("c"));

  await session.set(key("users", "c"), str("updated"));
  const updated = await session.get(key("users", "c"));
  assertEquals(updated.value, str("updated"));

  const page1 = await session.list({ prefix: key("users"), limit: 2 });
  assertEquals(page1.entries.map((entry) => entry.key[1].v), ["a", "b"]);
  assertEquals(page1.cursor?.[1].v, "b");

  const page2 = await session.list({ prefix: key("users"), start: page1.cursor, limit: 2 });
  assertEquals(page2.entries.map((entry) => entry.key[1].v), ["c", "d"]);

  const page3 = await session.list({ prefix: key("users"), start: page2.cursor, limit: 2 });
  assertEquals(page3.entries.map((entry) => entry.key[1].v), ["e"]);
  assertEquals(page3.cursor, null);

  const removed = await session.delete(key("users", "a"));
  assertEquals(removed.existed, true);
  assertEquals((await session.get(key("users", "a"))).found, false);

  const alreadyGone = await session.delete(key("users", "a"));
  assertEquals(alreadyGone.existed, false);
  session.close();
});

Deno.test("atomic check conflict and u64 sum", async () => {
  const session = new Session();
  await session.open(":memory:");
  const counter = key("stats", "views");
  await session.set(counter, { t: "u64", v: "10" });
  const first = await session.get(counter);
  await session.set(counter, { t: "u64", v: "11" });
  await assertRejects(
    () => session.set(counter, { t: "u64", v: "12" }, first.versionstamp),
    Error,
    "conflict",
  );

  const summed = await session.atomic({
    mutates: [{ type: "sum", key: counter, value: "5" }],
  });
  assertEquals(summed.ok, true);
  const after = await session.get(counter);
  assertEquals(after.value, { t: "u64", v: "16" });
  session.close();
});

Deno.test("export import and prefix delete", async () => {
  const session = new Session();
  await session.open(":memory:");
  await session.set(key("docs", "a"), { t: "u64", v: "3" });
  await session.set(key("docs", "b"), { t: "bytes", v: btoa("hi") });
  await session.set(key("other"), str("keep"));

  const exported = await session.exportPrefix(key("docs"));
  assertEquals(exported.entries.length, 2);
  assertEquals(await session.deletePrefix(key("docs")), { count: 2 });
  assertEquals((await session.get(key("docs", "a"))).found, false);
  assertEquals((await session.get(key("other"))).value, str("keep"));

  const imported = await session.importEntries(
    exported.entries.map((entry) => ({ key: entry.key, value: entry.value! })),
  );
  assertEquals(imported.count, 2);
  assertEquals((await session.get(key("docs", "a"))).value, { t: "u64", v: "3" });
  const bytes = (await session.get(key("docs", "b"))).value;
  assertEquals(bytes, { t: "bytes", v: btoa("hi") });
  session.close();
});
