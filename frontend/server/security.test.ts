import { afterAll, beforeAll, expect, test } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { once } from "node:events";
import { createGateway } from "./gateway";
import type { GatewayConfig } from "./gateway";
let upstream: Server, gateway: Server, base: string;
let observedKey: string | string[] | undefined;
const syntheticOperatorPassphrase = "software-test-only-passphrase-1234",
  syntheticAdminKey = "software-test-only-backend-key";
beforeAll(async () => {
  upstream = createServer((req, res) => {
    observedKey = req.headers["x-admin-key"];
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        success: true,
        data: { id: "synthetic-software-only-job", method: req.method },
      }),
    );
  }).listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const address = upstream.address() as { port: number };
  const config: GatewayConfig = {
    backendUrl: `http://127.0.0.1:${address.port}`,
    adminKey: syntheticAdminKey,
    operatorSecret: syntheticOperatorPassphrase,
    production: false,
    bridge: false,
    databaseUrl: "",
    storageRoot: "/unconfigured",
    storageBackend: "local",
    bucket: "",
    region: "us-east-1",
    pgSsl: false,
  };
  gateway = createServer(createGateway(config)).listen(0, "127.0.0.1");
  await once(gateway, "listening");
  base = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;
});
afterAll(async () => {
  await Promise.all([
    new Promise<void>((resolve) => gateway.close(() => resolve())),
    new Promise<void>((resolve) => upstream.close(() => resolve())),
  ]);
});
test("public requests never forward supplied administrator keys and reject writes", async () => {
  const read = await fetch(`${base}/backend/api/v1/results`, {
    headers: { "X-Admin-Key": "untrusted-browser-key" },
  });
  expect(read.status).toBe(200);
  expect(observedKey).toBeUndefined();
  const write = await fetch(`${base}/backend/api/v1/analysis/flood`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  expect(write.status).toBe(403);
});
test("operator requires origin, HttpOnly signed cookie and server-held key", async () => {
  const unauthenticated = await fetch(
    `${base}/operator/api/v1/analysis/flood`,
    { method: "POST", headers: { Origin: base } },
  );
  expect(unauthenticated.status).toBe(401);
  const crossOrigin = await fetch(`${base}/operator/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: "https://untrusted.invalid",
    },
    body: JSON.stringify({ password: syntheticOperatorPassphrase }),
  });
  expect(crossOrigin.status).toBe(403);
  const login = await fetch(`${base}/operator/session`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: base },
    body: JSON.stringify({ password: syntheticOperatorPassphrase }),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");
  expect(await login.text()).not.toContain(syntheticAdminKey);
  const write = await fetch(`${base}/operator/api/v1/analysis/flood`, {
    method: "POST",
    headers: {
      Cookie: cookie.split(";")[0],
      Origin: base,
      "content-type": "application/json",
      "X-Admin-Key": "untrusted-browser-key",
    },
    body: "{}",
  });
  expect(write.status).toBe(200);
  expect(observedKey).toBe(syntheticAdminKey);
  const csrf = await fetch(`${base}/operator/api/v1/analysis/flood`, {
    method: "POST",
    headers: {
      Cookie: cookie.split(";")[0],
      Origin: "https://untrusted.invalid",
    },
  });
  expect(csrf.status).toBe(401);
});
test("unconfigured artifact bridge is explicit, never a demo observation", async () => {
  const response = await fetch(
    `${base}/gateway/results/00000000-0000-4000-8000-000000000001/layers`,
  );
  expect((await response.json()).data.enabled).toBe(false);
});
