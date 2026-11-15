import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  ArrowDownToLine,
  ArrowRight,
  FileCheck2,
  ScanLine,
  Sigma,
  TriangleAlert,
} from "lucide-react";
import type { AnalysisResult, LocationRecord } from "../types/domain";
import { api } from "../services/data";
import {
  candidateCaveat,
  classCounts,
  formatNumber,
  numeric,
  overviewMetrics,
  resultLabel,
} from "../utils/science";
import { useExplorer } from "../store/explorer";
import { Empty, StatusBadge, SectionTitle } from "./ui";
export function ResultOverview({
  result,
  location,
}: {
  result?: AnalysisResult;
  location?: LocationRecord;
}) {
  const setPanel = useExplorer((state) => state.setPanel);
  if (!result)
    return (
      <Empty title="No completed analysis for this location">
        {location?.is_active
          ? "Search for compatible scenes or review the processing prerequisites."
          : "This is a research case study. No operational detection or fabricated result is shown."}
        <button className="text-button" onClick={() => setPanel("analysis")}>
          Review scientific prerequisites <ArrowRight size={15} />
        </button>
      </Empty>
    );
  const flood = result.result_type === "potential_inundation",
    area = numeric(result.statistics.candidate_area_m2),
    counts = classCounts(result);
  const rows = Object.entries(counts)
    .filter(([key]) => key !== "invalid_observation")
    .map(([key, value]) => ({
      name: key.replaceAll("_", " "),
      pixels: numeric(value) ?? 0,
    }));
  return (
    <>
      <div className="result-header">
        <span className="eyebrow">
          {flood
            ? "GCOV · radar-derived"
            : result.metadata.processing_level || "Processed measurement"}
        </span>
        <h2>{resultLabel(result)}</h2>
        <StatusBadge status={result.validation_status} experimental={!flood} />
      </div>
      <div className="metric-grid">
        {overviewMetrics(result).map((metric) => (
          <div key={metric.label}>
            <span>{metric.label}</span>
            <strong>
              {formatNumber(metric.value, metric.digits)}{" "}
              <small>{metric.units}</small>
            </strong>
          </div>
        ))}
      </div>
      {flood && (
        <p className="caution">
          <TriangleAlert size={16} />
          <span>{candidateCaveat}</span>
        </p>
      )}
      <SectionTitle>Observation summary</SectionTitle>
      <dl className="data-list">
        <div>
          <dt>
            <ScanLine size={14} /> Valid pixels
          </dt>
          <dd>
            {formatNumber(
              result.statistics.valid_change_pixels ??
                result.statistics.valid_pixels,
            )}
          </dd>
        </div>
        <div>
          <dt>Grid resolution</dt>
          <dd>
            {Array.isArray(result.statistics.grid_resolution)
              ? result.statistics.grid_resolution.join(" × ") + " m"
              : "Not reported"}
          </dd>
        </div>
        <div>
          <dt>Grid CRS</dt>
          <dd>{String(result.statistics.grid_crs ?? "Not reported")}</dd>
        </div>
        <div>
          <dt>Algorithm</dt>
          <dd>{result.metadata.algorithm_version || "Not reported"}</dd>
        </div>
      </dl>
      {rows.length > 0 && (
        <>
          <SectionTitle>Class distribution</SectionTitle>
          <div
            className="chart"
            role="img"
            aria-label="Pixel counts by output classification"
          >
            <ResponsiveContainer width="100%" height={175}>
              <BarChart
                data={rows}
                layout="vertical"
                margin={{ left: 0, right: 12 }}
              >
                <CartesianGrid stroke="#ffffff09" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: "#9cabc0", fontSize: 10 }}
                  tickFormatter={(value) => `${(value / 1e6).toFixed(1)}M`}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
                  tick={{ fill: "#9cabc0", fontSize: 9 }}
                />
                <Tooltip
                  contentStyle={{
                    background: "#101e2a",
                    border: "1px solid #314251",
                    borderRadius: 4,
                    color: "#d9e2ed",
                  }}
                  formatter={(value) => [formatNumber(value), "pixels"]}
                />
                <Bar
                  dataKey="pixels"
                  fill="#20c8d2"
                  barSize={10}
                  radius={[0, 2, 2, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <details>
            <summary>Accessible class data</summary>
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Pixels</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{formatNumber(row.pixels)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
      <SectionTitle>Evidence, not certainty</SectionTitle>
      <ul className="uncertainty-list">
        {result.uncertainty_notes.slice(0, 3).map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <button
        className="secondary-button full"
        onClick={() => setPanel("evidence")}
      >
        <FileCheck2 size={17} /> Audit provenance and validation{" "}
        <ArrowRight size={16} />
      </button>
      <div className="download-row">
        <a href={api.url(`/api/v1/exports/${result.id}/geotiff`)}>
          <ArrowDownToLine size={15} /> GeoTIFF
        </a>
        <a href={api.url(`/api/v1/exports/${result.id}/geojson`)}>
          <ArrowDownToLine size={15} /> GeoJSON
        </a>
        <a href={api.url(`/api/v1/exports/${result.id}/summary`)}>
          <Sigma size={15} /> Summary
        </a>
      </div>
    </>
  );
}
