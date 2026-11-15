export interface ResponseMeta {
  request_id?: string;
  timestamp?: string;
  has_more?: boolean;
  limit?: number;
  offset?: number;
}

export class ApiError extends Error {
  status: number;
  code: string;
  requestId?: string;

  constructor(
    message: string,
    status = 0,
    code = "NETWORK_UNAVAILABLE",
    requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export function createApiClient(
  baseUrl: string,
  transport: typeof fetch = fetch,
) {
  const base = baseUrl.replace(/\/$/, "");

  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<{ data: T; meta: ResponseMeta }> {
    if (
      !path.startsWith("/") ||
      path.startsWith("//") ||
      path.includes("://")
    ) {
      throw new ApiError(
        "An application-relative endpoint is required.",
        400,
        "INVALID_ENDPOINT",
      );
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 30_000);
    try {
      const response = await transport(`${base}${path}`, {
        ...options,
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
        signal: controller.signal,
      });
      let envelope: {
        success?: boolean;
        data?: T;
        error?: { code?: string; message?: string };
        meta?: ResponseMeta;
      };
      try {
        envelope = await response.json();
      } catch {
        throw new ApiError(
          "The service returned an unreadable response. Check its status and retry.",
          response.status,
          "INVALID_RESPONSE",
        );
      }
      if (!response.ok || envelope.success !== true) {
        throw new ApiError(
          envelope.error?.message ?? "The request could not be completed.",
          response.status,
          envelope.error?.code ?? "REQUEST_FAILED",
          envelope.meta?.request_id,
        );
      }
      return { data: envelope.data as T, meta: envelope.meta ?? {} };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (options.signal?.aborted)
        throw new DOMException("Request cancelled", "AbortError");
      throw new ApiError(
        controller.signal.aborted
          ? "The backend took too long to respond. Retry when it is ready."
          : "The backend is unreachable. Check its address and service status.",
        0,
        controller.signal.aborted ? "REQUEST_TIMEOUT" : "NETWORK_UNAVAILABLE",
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }

  return {
    get: async <T>(path: string, signal?: AbortSignal) =>
      (await request<T>(path, { signal })).data,
    post: async <T>(path: string, body: unknown, signal?: AbortSignal) =>
      (
        await request<T>(path, {
          method: "POST",
          body: JSON.stringify(body),
          signal,
        })
      ).data,
    postPage: <T>(path: string, body: unknown, signal?: AbortSignal) =>
      request<T>(path, { method: "POST", body: JSON.stringify(body), signal }),
    url: (path: string) => `${base}${path}`,
  };
}
