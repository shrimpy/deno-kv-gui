import { assertEquals } from "jsr:@std/assert@1";

Deno.test("worker ping and set/get over stdin", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--unstable-kv",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-net",
      "sidecar/main.ts",
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();
  const writer = child.stdin.getWriter();
  const encoder = new TextEncoder();
  const write = (value: unknown) => writer.write(encoder.encode(`${JSON.stringify(value)}\n`));

  await write({ id: 1, method: "ping" });
  await write({
    id: 2,
    method: "open",
    params: { target: ":memory:" },
  });
  await write({
    id: 3,
    method: "set",
    params: {
      key: [{ t: "string", v: "hello" }],
      value: { t: "string", v: "world" },
    },
  });
  await write({
    id: 4,
    method: "get",
    params: { key: [{ t: "string", v: "hello" }] },
  });
  await writer.close();

  const output = await child.output();
  const lines = new TextDecoder().decode(output.stdout).trim().split("\n").map((line) =>
    JSON.parse(line)
  );
  assertEquals(lines[0].result.pong, true);
  assertEquals(lines[0].result.app, "Deno KV");
  assertEquals(lines[1].result.open, true);
  assertEquals(typeof lines[2].result.versionstamp, "string");
  assertEquals(lines[3].result.found, true);
  assertEquals(lines[3].result.value, { t: "string", v: "world" });
});
