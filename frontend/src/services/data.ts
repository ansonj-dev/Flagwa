import { useQuery, useQueries } from "@tanstack/react-query";
import { createApiClient, ApiError } from "./api-client";
import type {
  AnalysisResult,
  Availability,
  CaseStudy,
  ContextLayer,
  Exposure,
  Inspection,
  Job,
  LayerManifest,
  LocationRecord,
  OpenAPI,
  OperatorSession,
  Providers,
  Scene,
} from "../types/domain";
export const api = createApiClient(
  import.meta.env.VITE_FLAGWA_API_BASE_URL || "/backend",
);
export const localApi = createApiClient("");
export const terminalStates = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
export function shouldPollJob(job?: Job) {
  return job && !terminalStates.has(job.status) ? 2500 : false;
}
export const retryQuery = (count: number, error: Error) =>
  count < 1 &&
  (!(error instanceof ApiError) ||
    ![401, 403, 404, 409, 422, 424, 501].includes(error.status));
export const useLocations = () =>
  useQuery({
    queryKey: ["locations"],
    queryFn: ({ signal }) =>
      api.get<LocationRecord[]>("/api/v1/locations?limit=100", signal),
    staleTime: 300_000,
  });
export const useCases = () =>
  useQuery({
    queryKey: ["cases"],
    queryFn: ({ signal }) =>
      api.get<CaseStudy[]>("/api/v1/case-studies", signal),
    staleTime: 300_000,
  });
export const useResults = () =>
  useQuery({
    queryKey: ["results"],
    queryFn: ({ signal }) =>
      api.get<AnalysisResult[]>("/api/v1/results?limit=100", signal),
    staleTime: 30_000,
  });
export const useProviders = () =>
  useQuery({
    queryKey: ["providers"],
    queryFn: ({ signal }) => api.get<Providers>("/health/providers", signal),
    staleTime: 60_000,
  });
export const useReady = () =>
  useQuery({
    queryKey: ["ready"],
    queryFn: ({ signal }) =>
      api.get<{ status: string }>("/health/ready", signal),
    refetchInterval: 30_000,
    retry: retryQuery,
  });
export const useAvailability = (slug?: string) =>
  useQuery({
    queryKey: ["availability", slug],
    queryFn: ({ signal }) =>
      api.get<Availability>(
        `/api/v1/locations/${encodeURIComponent(slug!)}/availability`,
        signal,
      ),
    enabled: Boolean(slug),
    staleTime: 30_000,
  });
export const useResult = (id?: string) =>
  useQuery({
    queryKey: ["result", id],
    queryFn: ({ signal }) =>
      api.get<AnalysisResult>(`/api/v1/results/${id}`, signal),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
export function useSourceScenes(result?: AnalysisResult) {
  return useQueries({
    queries: (result?.metadata.source_scenes ?? []).map((id) => ({
      queryKey: ["scene", id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.get<Scene>(`/api/v1/scenes/${encodeURIComponent(id)}`, signal),
      staleTime: 300_000,
    })),
  });
}
export const useManifest = (id?: string) =>
  useQuery({
    queryKey: ["layers", id],
    queryFn: ({ signal }) =>
      localApi.get<LayerManifest>(`/gateway/results/${id}/layers`, signal),
    enabled: Boolean(id),
    retry: false,
    staleTime: 60_000,
  });
export const useJob = (id?: string) =>
  useQuery({
    queryKey: ["job", id],
    queryFn: ({ signal }) => api.get<Job>(`/api/v1/jobs/${id}/status`, signal),
    enabled: Boolean(id),
    refetchInterval: (query) => shouldPollJob(query.state.data),
    retry: retryQuery,
  });
export const useJobs = () =>
  useQuery({
    queryKey: ["jobs"],
    queryFn: ({ signal }) => api.get<Job[]>("/api/v1/jobs?limit=50", signal),
    refetchInterval: (query) =>
      query.state.data?.some((job) => !terminalStates.has(job.status))
        ? 3000
        : false,
  });
export const useOperator = () =>
  useQuery({
    queryKey: ["operator"],
    queryFn: ({ signal }) =>
      localApi.get<OperatorSession>("/operator/session", signal),
    retry: false,
    staleTime: 10_000,
  });
export const useContext = (slug: string, type: string) =>
  useQuery({
    queryKey: ["context", slug, type],
    queryFn: ({ signal }) =>
      api.get<ContextLayer[]>(`/api/v1/community/${slug}/${type}`, signal),
    retry: false,
    staleTime: 60_000,
  });
export const useExposure = (slug: string, resultId?: string, distance = 100) =>
  useQuery({
    queryKey: ["exposure", slug, resultId, distance],
    queryFn: ({ signal }) =>
      api.get<Exposure>(
        `/api/v1/community/${slug}/exposure?result_id=${resultId}&distance_m=${distance}`,
        signal,
      ),
    enabled: Boolean(resultId),
    retry: false,
    staleTime: 60_000,
  });
export const useInspection = (sceneId?: string) =>
  useQuery({
    queryKey: ["inspection", sceneId],
    queryFn: ({ signal }) =>
      api.get<Inspection>(
        `/api/v1/scenes/${encodeURIComponent(sceneId!)}/inspection?limit=1000`,
        signal,
      ),
    enabled: Boolean(sceneId),
    retry: false,
  });
export const useContract = () =>
  useQuery({
    queryKey: ["openapi"],
    queryFn: async ({ signal }) => {
      const response = await fetch(api.url("/openapi.json"), { signal });
      if (!response.ok)
        throw new ApiError(
          "The API schema is unavailable.",
          response.status,
          "SCHEMA_UNAVAILABLE",
        );
      return response.json() as Promise<OpenAPI>;
    },
    staleTime: 300_000,
  });
