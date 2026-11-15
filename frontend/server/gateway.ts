import express from "express";
import type { Request, Response } from "express";
import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { Readable } from "node:stream";
import pg from "pg";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { config as dotenv } from "dotenv";

export interface GatewayConfig {
  backendUrl: string;
  adminKey: string;
  operatorSecret: string;
  production: boolean;
  bridge: boolean;
  databaseUrl: string;
  storageRoot: string;
  storageBackend: string;
  bucket: string;
  region: string;
  endpoint?: string;
  accessKey?: string;
  secretKey?: string;
  pgSsl: boolean;
}
export function readConfig(): GatewayConfig {
  dotenv({ path: resolve(".env.server"), quiet: true });
  return {
    backendUrl: process.env.FLAGWA_BACKEND_URL ?? "http://127.0.0.1:8000",
    adminKey: process.env.ADMIN_API_KEY ?? "",
    operatorSecret: process.env.OPERATOR_ACCESS_SECRET ?? "",
    production: process.env.NODE_ENV === "production",
    bridge: process.env.FLAGWA_ENABLE_ARTIFACT_BRIDGE === "true",
    databaseUrl: process.env.FLAGWA_DATABASE_URL ?? "",
    storageRoot: resolve(process.env.FLAGWA_STORAGE_ROOT ?? "../storage"),
    storageBackend: process.env.STORAGE_BACKEND ?? "local",
    bucket: process.env.S3_BUCKET ?? "",
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT_URL || undefined,
    accessKey: process.env.S3_ACCESS_KEY_ID,
    secretKey: process.env.S3_SECRET_ACCESS_KEY,
    pgSsl: process.env.PG_SSL === "true",
  };
}
export const artifactRoles = [
  "before_power",
  "after_power",
  "change_geotiff",
] as const;
const identifier =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function safeObjectKey(key: string) {
  if (
    !key ||
    isAbsolute(key) ||
    key.includes("\\") ||
    key.includes("\0") ||
    key.split("/").includes("..") ||
    key.includes(":")
  )
    throw new Error("Invalid object key");
  return key;
}
export function allowedOperatorPath(method: string, path: string) {
  if (method === "GET")
    return /^\/api\/v1\/results\/[0-9a-f-]+\/interpretation$/.test(path);
  return (
    method === "POST" &&
    (/^\/api\/v1\/analysis\/(flood|forest|agriculture|glacier|wildfire|deformation)$/.test(
      path,
    ) ||
      /^\/api\/v1\/jobs\/[0-9a-f-]+\/(cancel|retry)$/.test(path) ||
      /^\/api\/v1\/results\/[0-9a-f-]+\/validation$/.test(path) ||
      /^\/api\/v1\/scenes\/[A-Za-z0-9_.-]{1,300}\/download$/.test(path))
  );
}
export function rangeSelection(header: string | undefined, size: number) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) throw new Error("Only one byte range is supported");
  const start = Number(match[1]),
    end = match[2]
      ? Math.min(Number(match[2]), size - 1)
      : Math.min(start + 8 * 1024 * 1024 - 1, size - 1);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start ||
    end - start > 8 * 1024 * 1024
  )
    throw new Error("Invalid byte range");
  return { start, end, partial: true };
}
export function createGateway(config: GatewayConfig) {
  const app = express(),
    backend = new URL(config.backendUrl);
  if (
    !["http:", "https:"].includes(backend.protocol) ||
    backend.username ||
    backend.password ||
    backend.search ||
    backend.hash
  )
    throw new Error("Invalid trusted backend URL");
  const enabled = Boolean(
      config.adminKey && config.operatorSecret.length >= 16,
    ),
    cookieName = "flagwa_operator";
  const failures = new Map<string, { count: number; until: number }>();
  const pool =
    config.bridge && config.databaseUrl
      ? new pg.Pool({
          connectionString: config.databaseUrl,
          ssl: config.pgSsl ? { rejectUnauthorized: true } : undefined,
          max: 3,
          connectionTimeoutMillis: 3000,
          idleTimeoutMillis: 10_000,
        })
      : null;
  const s3 =
    config.storageBackend === "s3" && config.bridge
      ? new S3Client({
          region: config.region,
          endpoint: config.endpoint,
          forcePathStyle: Boolean(config.endpoint),
          ...(config.accessKey && config.secretKey
            ? {
                credentials: {
                  accessKeyId: config.accessKey,
                  secretAccessKey: config.secretKey,
                },
              }
            : {}),
        })
      : null;
  app.disable("x-powered-by");
  app.use(
    ["/operator", "/gateway", "/backend"],
    express.json({ limit: "1mb" }),
  );
  const fail = (res: Response, status: number, code: string, message: string) =>
    res
      .status(status)
      .json({
        success: false,
        error: { code, message },
        meta: { request_id: randomUUID() },
      });
  const good = (res: Response, data: unknown) =>
    res.json({
      success: true,
      data,
      meta: { request_id: randomUUID(), timestamp: new Date().toISOString() },
    });
  const sign = (data: string) =>
    createHmac("sha256", config.operatorSecret)
      .update(data)
      .digest("base64url");
  function authorized(req: Request) {
    if (!enabled) return false;
    const cookie = req.headers.cookie
      ?.split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!cookie) return false;
    const [data, signature] = cookie.split(".");
    if (!data || !signature) return false;
    const expected = Buffer.from(sign(data)),
      supplied = Buffer.from(signature);
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    )
      return false;
    try {
      return (
        JSON.parse(Buffer.from(data, "base64url").toString()).expires >
        Date.now()
      );
    } catch {
      return false;
    }
  }
  function sameOrigin(req: Request) {
    try {
      return Boolean(
        req.headers.origin &&
        new URL(req.headers.origin).host === req.headers.host,
      );
    } catch {
      return false;
    }
  }
  app.get("/operator/session", (req, res) =>
    good(res, { enabled, authorized: authorized(req) }),
  );
  app.post("/operator/session", (req, res) => {
    if (!enabled)
      return fail(
        res,
        503,
        "OPERATOR_DISABLED",
        "The server has not configured restricted operator access.",
      );
    if (!sameOrigin(req))
      return fail(
        res,
        403,
        "ORIGIN_REJECTED",
        "Operator requests must come from this application.",
      );
    const address = req.ip ?? "unknown",
      entry = failures.get(address);
    if (entry && entry.until > Date.now() && entry.count >= 5)
      return fail(
        res,
        429,
        "LOGIN_RATE_LIMITED",
        "Too many attempts. Retry after ten minutes.",
      );
    const supplied = Buffer.from(
        typeof req.body?.password === "string" ? req.body.password : "",
      ),
      expected = Buffer.from(config.operatorSecret);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      if (failures.size > 5000) failures.clear();
      failures.set(address, {
        count: entry && entry.until > Date.now() ? entry.count + 1 : 1,
        until: Date.now() + 600_000,
      });
      return fail(
        res,
        401,
        "OPERATOR_UNAUTHORIZED",
        "The operator passphrase was not accepted.",
      );
    }
    failures.delete(address);
    const data = Buffer.from(
      JSON.stringify({
        nonce: randomBytes(16).toString("hex"),
        expires: Date.now() + 3600_000,
      }),
    ).toString("base64url");
    res.cookie(cookieName, `${data}.${sign(data)}`, {
      httpOnly: true,
      secure: config.production,
      sameSite: "strict",
      path: "/operator",
      maxAge: 3600_000,
    });
    return good(res, { enabled: true, authorized: true });
  });
  app.post("/operator/logout", (req, res) => {
    if (!sameOrigin(req))
      return fail(
        res,
        403,
        "ORIGIN_REJECTED",
        "Same-origin requests are required.",
      );
    res.clearCookie(cookieName, { path: "/operator" });
    return good(res, { authorized: false });
  });
  async function proxy(req: Request, res: Response, operator: boolean) {
    const prefix = operator ? "/operator" : "/backend",
      path = req.path.slice(prefix.length);
    const trustedRead =
      req.method === "GET" &&
      !req.headers.origin &&
      req.headers["sec-fetch-site"] === "same-origin";
    if (operator && (!authorized(req) || !(sameOrigin(req) || trustedRead)))
      return fail(
        res,
        401,
        "OPERATOR_REQUIRED",
        "Restricted operator access is required.",
      );
    const publicAllowed =
      ((req.method === "GET" || req.method === "HEAD") &&
        ([
          "/health/live",
          "/health/ready",
          "/health/providers",
          "/openapi.json",
        ].includes(path) ||
          /^\/api\/v1\/(locations|case-studies|catalog\/nisar\/scenes|scenes|jobs|results|community|exports)(\/[^?#]*)?$/.test(
            path,
          )) &&
        !path.endsWith("/interpretation")) ||
      (req.method === "POST" &&
        [
          "/api/v1/catalog/nisar/search",
          "/api/v1/catalog/nisar/compatibility-check",
        ].includes(path));
    if (!(operator ? allowedOperatorPath(req.method, path) : publicAllowed))
      return fail(
        res,
        403,
        "ROUTE_NOT_ALLOWED",
        "This route is not permitted by the frontend gateway.",
      );
    const headers: Record<string, string> = {
      Accept: req.headers.accept ?? "application/json",
    };
    if (operator) headers["X-Admin-Key"] = config.adminKey;
    if (req.headers.range) headers.Range = req.headers.range;
    if (req.method === "POST") headers["Content-Type"] = "application/json";
    try {
      const response = await fetch(
        `${config.backendUrl.replace(/\/$/, "")}${path}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`,
        {
          method: req.method,
          headers,
          body: req.method === "POST" ? JSON.stringify(req.body) : undefined,
          redirect: "error",
          signal: AbortSignal.timeout(60_000),
        },
      );
      res.status(response.status);
      for (const name of [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "content-disposition",
        "etag",
        "x-request-id",
      ]) {
        const value = response.headers.get(name);
        if (value) res.setHeader(name, value);
      }
      if (response.body && req.method !== "HEAD")
        Readable.fromWeb(response.body as never)
          .on("error", () => res.destroy())
          .pipe(res);
      else res.end();
    } catch {
      if (!res.headersSent)
        fail(
          res,
          502,
          "BACKEND_UNAVAILABLE",
          "The backend is unreachable or slow. Check service readiness and retry.",
        );
    }
  }
  app.use("/backend", (req, res) => {
    req.url = `/backend${req.url}`;
    void proxy(req, res, false);
  });
  app.use("/operator/api", (req, res) => {
    req.url = `/operator/api${req.url}`;
    void proxy(req, res, true);
  });
  async function lookup(resultId: string) {
    if (!config.bridge || !pool) return null;
    const result = await pool.query<{ metadata_json: Record<string, unknown> }>(
      "SELECT r.metadata_json FROM analysis_results r JOIN analysis_jobs j ON j.id=r.analysis_job_id WHERE r.id=$1 AND j.status='COMPLETED'",
      [resultId],
    );
    return result.rows[0]?.metadata_json ?? null;
  }
  app.get("/gateway/results/:resultId/layers", async (req, res) => {
    if (!identifier.test(req.params.resultId))
      return fail(
        res,
        422,
        "INVALID_RESULT_ID",
        "Select an existing result UUID.",
      );
    if (!config.bridge || !pool)
      return good(res, {
        enabled: false,
        layers: {},
        reason:
          "Prepared observations are not exposed by the public backend. Configure the optional read-only artifact bridge.",
      });
    try {
      const metadata = await lookup(req.params.resultId);
      if (!metadata)
        return fail(
          res,
          404,
          "RESULT_NOT_FOUND",
          "No completed result record exists.",
        );
      const artifacts = metadata.artifacts as
        Record<string, string> | undefined;
      const layers = Object.fromEntries(
        artifactRoles
          .filter((role) => Boolean(artifacts?.[role]))
          .map((role) => [
            role,
            { href: `/gateway/results/${req.params.resultId}/layers/${role}` },
          ]),
      );
      return good(res, { enabled: true, layers });
    } catch {
      return fail(
        res,
        503,
        "ARTIFACT_BRIDGE_UNAVAILABLE",
        "The read-only artifact service cannot reach its configured metadata store.",
      );
    }
  });
  app.all("/gateway/results/:resultId/layers/:role", async (req, res) => {
    if (!["GET", "HEAD"].includes(req.method))
      return fail(
        res,
        405,
        "READ_ONLY",
        "Processed layer access is read-only.",
      );
    if (
      !identifier.test(req.params.resultId) ||
      !artifactRoles.includes(req.params.role as (typeof artifactRoles)[number])
    )
      return fail(
        res,
        404,
        "LAYER_NOT_FOUND",
        "This processed layer is not available.",
      );
    try {
      const metadata = await lookup(req.params.resultId),
        key = (metadata?.artifacts as Record<string, string> | undefined)?.[
          req.params.role
        ];
      if (!key)
        return fail(
          res,
          424,
          "LAYER_UNAVAILABLE",
          "The completed result has no requested observation layer.",
        );
      safeObjectKey(key);
      let size: number,
        path = "";
      if (s3)
        size =
          (
            await s3.send(
              new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
            )
          ).ContentLength ?? 0;
      else {
        const root = await realpath(config.storageRoot);
        path = await realpath(resolve(root, key));
        const child = relative(root, path);
        if (child.startsWith("..") || isAbsolute(child))
          throw new Error("Unsafe artifact");
        size = (await stat(path)).size;
      }
      let selected: ReturnType<typeof rangeSelection>;
      try {
        selected = rangeSelection(req.headers.range, size);
      } catch {
        res.setHeader("Content-Range", `bytes */${size}`);
        return res.status(416).end();
      }
      res
        .status(selected.partial ? 206 : 200)
        .set({
          "Content-Type": "image/tiff",
          "Accept-Ranges": "bytes",
          "Content-Length": String(selected.end - selected.start + 1),
          "Cache-Control": "public, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        });
      if (selected.partial)
        res.setHeader(
          "Content-Range",
          `bytes ${selected.start}-${selected.end}/${size}`,
        );
      if (req.method === "HEAD") return res.end();
      if (s3) {
        const object = await s3.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Range: `bytes=${selected.start}-${selected.end}`,
          }),
        );
        (object.Body as Readable).on("error", () => res.destroy()).pipe(res);
      } else
        createReadStream(path, { start: selected.start, end: selected.end })
          .on("error", () => res.destroy())
          .pipe(res);
    } catch {
      if (!res.headersSent)
        fail(
          res,
          503,
          "LAYER_UNAVAILABLE",
          "The selected processed layer cannot be read. No new measurement was generated.",
        );
    }
  });
  return app;
}
