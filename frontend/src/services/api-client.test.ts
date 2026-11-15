import assert from "node:assert/strict";
import { test } from "vitest";
import { ApiError, createApiClient } from "./api-client.ts";

test("reads the actual success envelope without inventing missing values", async () => {
  const client = createApiClient(
    "https://example.invalid",
    async () =>
      new Response(JSON.stringify({ success: true, data: { value: null } })),
  );
  assert.deepEqual(await client.get("/health/live"), { value: null });
});

test("preserves provider errors rather than reporting successful empty data", async () => {
  const client = createApiClient(
    "",
    async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: { code: "ASF_SEARCH_FAILED", message: "Provider unavailable" },
          meta: { request_id: "synthetic-test-request" },
        }),
        { status: 502 },
      ),
  );
  await assert.rejects(
    client.get("/api/v1/catalog/nisar/search"),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 502 &&
      error.code === "ASF_SEARCH_FAILED",
  );
});

test("rejects arbitrary endpoint destinations", async () => {
  await assert.rejects(
    createApiClient("").get("//untrusted.invalid/secret"),
    (error: unknown) =>
      error instanceof ApiError && error.code === "INVALID_ENDPOINT",
  );
});

test("non-JSON failures have a useful explicit error", async () => {
  const client = createApiClient(
    "",
    async () => new Response("<html>sleeping service</html>", { status: 503 }),
  );
  await assert.rejects(
    client.get("/health/ready"),
    (error: unknown) =>
      error instanceof ApiError && error.code === "INVALID_RESPONSE",
  );
});
test("catalogue arrays and provider pagination metadata are retained", async () => {
  const client = createApiClient(
    "",
    async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: [{ scene_id: "SYNTHETIC_SOFTWARE_ONLY_SCENE" }],
          meta: { offset: 10, limit: 10, has_more: true },
        }),
      ),
  );
  const page = await client.postPage<{ scene_id: string }[]>(
    "/api/v1/catalog/nisar/search",
    {},
  );
  assert.equal(page.data.length, 1);
  assert.equal(page.meta.has_more, true);
  assert.equal(page.meta.offset, 10);
});
