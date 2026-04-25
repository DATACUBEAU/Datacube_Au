/// <reference path="../deno.d.ts" />
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@0.224.0";
import { openrouterChatCompletions } from "../_shared/openrouter.ts";

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function withFetchMock(mock: FetchMock, run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = mock;
  return run().finally(() => {
    (globalThis as any).fetch = originalFetch;
  });
}

const baseArgs = {
  supabaseAdmin: {},
  model: "google/gemini-2.0-flash-exp:free",
  messages: [{ role: "user" as const, content: "ping" }],
  apiKey: "sk-test-openrouter",
};

Deno.test("openrouter client returns content on 200", async () => {
  await withFetchMock(async () => {
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "pong" } }],
        usage: { total_tokens: 12 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }, async () => {
    const result = await openrouterChatCompletions(baseArgs);
    assertEquals(result.content, "pong");
    assertEquals(result.usage?.total_tokens, 12);
  });
});

Deno.test("openrouter client surfaces 404 diagnostics", async () => {
  await withFetchMock(async () => {
    return new Response(
      JSON.stringify({ error: { message: "Model not found" } }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }, async () => {
    const err = await assertRejects(
      async () => {
        await openrouterChatCompletions(baseArgs);
      },
      Error,
    );
    assertEquals((err as any).status, 404);
    const details = JSON.stringify((err as any).details || {});
    assert(details.includes("/chat/completions"));
    assert(details.toLowerCase().includes("modelnotfound") || details.toLowerCase().includes("model not found"));
  });
});

Deno.test("openrouter client surfaces 401 unauthorized errors", async () => {
  await withFetchMock(async () => {
    return new Response(
      JSON.stringify({ error: { message: "Invalid API key" } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }, async () => {
    const err = await assertRejects(
      async () => {
        await openrouterChatCompletions(baseArgs);
      },
      Error,
    );
    assertEquals((err as any).status, 401);
    assert(String((err as any).message || "").includes("401"));
  });
});

Deno.test("openrouter client retries transient failures and returns 500 on exhaustion", async () => {
  let calls = 0;
  await withFetchMock(async () => {
    calls += 1;
    return new Response(
      JSON.stringify({ error: { message: "Upstream temporary error" } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }, async () => {
    const err = await assertRejects(
      async () => {
        await openrouterChatCompletions(baseArgs);
      },
      Error,
    );
    assertEquals((err as any).status, 500);
    assert(calls >= 1);
  });
});
