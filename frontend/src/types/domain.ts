import type { Geometry, FeatureCollection } from "geojson";
export type JsonRecord = Record<string, unknown>;
export type Theme =
  "flood" | "forest" | "agriculture" | "glacier" | "wildfire" | "deformation";
export interface LocationRecord {
  id: string;
  name: string;
  slug: string;
  country: string;
  continent: string;
  hazard_type: Theme;
  geometry: Geometry | null;
  description: string;
  is_active: boolean;
}
export interface Availability {
  location: string;
  known_catalogue_scenes: number;
  completed_results: number;
  availability_status: string;
  operational_claim: boolean;
  note: string;
}
export interface CaseStudy {
  id: string;
  slug: string;
  location_id: string;
  title: string;
  scientific_question: string;
  vulnerability_context: string;
  data_status: string;
  description: string;
}
export interface Capability {
  product: string;
  status: string;
  operational?: boolean;
  method?: string;
  requires?: string;
}
export interface Providers {
  ASF: { enabled: boolean; live_health: string };
  Earthdata: { configured: boolean; authentication_verified: boolean };
  Bhoonidhi: { enabled: boolean; live_tested: boolean };
  analysis_capabilities: Record<Theme, Capability>;
}
export interface Scene {
  scene_id: string;
  dataset: string | null;
  product_type: string | null;
  data_maturity: string | null;
  acquisition_datetime: string | null;
  processing_datetime?: string | null;
  flight_direction: string | null;
  geometry: Geometry | null;
  polarizations: string[];
  frequency: string | null;
  source: string;
  orbit_information: JsonRecord;
  download_available: boolean;
  download_status?: string;
  metadata: JsonRecord;
}
export interface ResultMetadata extends JsonRecord {
  location?: string;
  source_scenes?: string[];
  acquisition_dates?: string[];
  analysis_type?: string;
  algorithm_version?: string;
  parameters?: JsonRecord;
  frequency?: string;
  frequency_group?: string;
  polarization?: string;
  processing_level?: string;
  data_maturity?: string[];
  class_legend?: Record<string, string>;
  units?: string;
  operational?: boolean;
  synthetic?: boolean;
  uncertainty_notes?: string[];
  validation_sources?: unknown[];
  validation_history?: unknown[];
  context_provenance?: JsonRecord;
  study_aoi?: Geometry;
  study_boundary?: JsonRecord;
  geometry_semantics?: string;
}
export interface AnalysisResult {
  id: string;
  analysis_job_id: string;
  result_type: string;
  statistics: JsonRecord;
  validation_status: string;
  uncertainty_notes: string[];
  metadata: ResultMetadata;
}
export type JobState =
  "QUEUED" | "RUNNING" | "VALIDATING" | "COMPLETED" | "FAILED" | "CANCELLED";
export interface Job {
  id: string;
  location_id: string | null;
  job_type: string;
  status: JobState;
  progress: number;
  input_scenes: string[];
  parameters: JsonRecord;
  created_at: string;
  started_at: string | null;
  heartbeat_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}
export interface ContextLayer {
  id: string;
  layer_type: string;
  source: string;
  version: string;
  provenance: JsonRecord;
}
export interface Exposure {
  analysis_id: string;
  validation_status: string;
  synthetic?: boolean;
  estimates: {
    context_layer_id: string;
    layer_type: string;
    source: string;
    version: string;
    provenance: JsonRecord;
    exposure: JsonRecord & { features?: FeatureCollection["features"] };
  }[];
  unavailable_layer_types: string[];
  limitations: string[];
}
export interface DatasetInfo {
  dataset_path: string;
  shape: number[];
  dtype: string;
  fill_value: unknown;
  attributes: JsonRecord;
}
export interface Inspection {
  scene_id: string;
  datasets: DatasetInfo[];
  identification: JsonRecord;
  frequency_groups: string[];
}
export interface LayerManifest {
  enabled: boolean;
  layers: Partial<
    Record<"before_power" | "after_power" | "change_geotiff", { href: string }>
  >;
  reason?: string;
}
export interface OperatorSession {
  enabled: boolean;
  authorized: boolean;
}
export interface JsonSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: (string | number)[];
  const?: string;
  default?: unknown;
  anyOf?: JsonSchema[];
  $ref?: string;
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  minItems?: number;
  maxItems?: number;
  format?: string;
}
export interface OpenAPI {
  paths: Record<
    string,
    {
      post?: {
        requestBody?: {
          content: { "application/json": { schema: JsonSchema } };
        };
      };
    }
  >;
  components: { schemas: Record<string, JsonSchema> };
}
