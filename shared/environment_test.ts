import { assertEquals } from "jsr:@std/assert@1";
import {
  connectUrl,
  environmentFromDatabaseName,
  needsProductionConfirm,
} from "./environment.ts";

Deno.test("environment from database name", () => {
  assertEquals(environmentFromDatabaseName("myapp-production"), "production");
  assertEquals(environmentFromDatabaseName("my-app-preview"), "preview");
  assertEquals(environmentFromDatabaseName("myapp--main"), "branch");
  assertEquals(
    environmentFromDatabaseName("myapp--feature-production"),
    "branch",
  );
  assertEquals(environmentFromDatabaseName("myapp"), null);
  assertEquals(environmentFromDatabaseName("  myapp-production  "), "production");
});

Deno.test("connect url shapes", () => {
  assertEquals(
    connectUrl("v2", "abc", ""),
    "https://api.deno.com/v2/databases/abc/connect",
  );
  assertEquals(
    connectUrl("classic", "abc", ""),
    "https://api.deno.com/databases/abc/connect",
  );
  assertEquals(
    connectUrl("custom", "abc", " https://example.test/connect "),
    "https://example.test/connect",
  );
  assertEquals(connectUrl("v2", "  ", ""), "");
});

Deno.test("production confirm", () => {
  assertEquals(needsProductionConfirm("production"), true);
  assertEquals(needsProductionConfirm("preview"), false);
  assertEquals(needsProductionConfirm("local"), false);
});
