import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { decodeValue, encodeKey, encodeValue } from "./codec.ts";

Deno.test("codec round trip of supported values", () => {
  const date = new Date("2026-09-21T12:00:00.000Z");
  const samples: unknown[] = [
    null,
    "hello",
    42,
    1.5,
    true,
    false,
    12n,
    new Uint8Array([0, 255, 10]),
    date,
    new Deno.KvU64(18446744073709551615n),
    ["a", 1, null],
    { name: "ada", ok: true, n: 2 },
  ];
  for (const sample of samples) {
    const decoded = decodeValue(encodeValue(sample));
    if (sample instanceof Uint8Array) {
      assertEquals(Array.from(decoded as Uint8Array), Array.from(sample));
    } else if (sample instanceof Date) {
      assertEquals((decoded as Date).toISOString(), sample.toISOString());
    } else if (sample instanceof Deno.KvU64) {
      assertEquals((decoded as Deno.KvU64).value, sample.value);
    } else {
      assertEquals(decoded, sample);
    }
  }
});

Deno.test("codec nested u64", () => {
  const tag = encodeValue({ count: new Deno.KvU64(7n), label: "x" });
  assertEquals(tag, {
    t: "object",
    v: {
      count: { t: "u64", v: "7" },
      label: { t: "string", v: "x" },
    },
  });
  const decoded = decodeValue(tag) as { count: Deno.KvU64; label: string };
  assertEquals(decoded.count.value, 7n);
  assertEquals(decoded.label, "x");
});

Deno.test("codec rejects unsupported values", () => {
  assertThrows(() => encodeValue(undefined), Error, "undefined");
  assertThrows(() => encodeValue(NaN), Error, "non-finite");
  assertThrows(() => encodeValue(new Map()), Error, "unsupported value type");
  assertThrows(() => encodeValue(new Set()), Error, "unsupported value type");
  assertThrows(() => encodeValue(() => {}), Error, "unsupported value type");
});

Deno.test("codec key parts", () => {
  const key: Deno.KvKey = ["users", 1, true, 2n, new Uint8Array([1, 2])];
  const encoded = encodeKey(key);
  assertEquals(encoded.map((part) => part.t), ["string", "number", "boolean", "bigint", "bytes"]);
});
