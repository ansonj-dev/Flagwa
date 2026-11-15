// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SchemaForm } from "./SchemaForm";
import type { JsonSchema, OpenAPI } from "../types/domain";
const syntheticSoftwareContract: OpenAPI = {
  paths: {},
  components: { schemas: {} },
};
afterEach(cleanup);
test("software-only array and threshold defaults match visible fields and submitted payload", async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  const schema: JsonSchema = {
    type: "object",
    required: ["classes", "threshold"],
    properties: {
      classes: {
        type: "array",
        title: "Classes",
        items: { type: "integer" },
        default: [1],
      },
      threshold: { type: "number", title: "Threshold", default: -3 },
    },
  };
  render(
    <SchemaForm
      schema={schema}
      contract={syntheticSoftwareContract}
      onSubmit={submit}
    />,
  );
  await waitFor(() =>
    expect(
      (screen.getByLabelText(/Classes/) as HTMLTextAreaElement).value,
    ).toContain("1"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({ classes: [1], threshold: -3 }),
  );
});
test("arbitrary JSON object fields are editable and invalid JSON cannot submit", async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  const schema: JsonSchema = {
    type: "object",
    required: ["aoi"],
    properties: { aoi: { type: "object", title: "AOI" } },
  };
  render(
    <SchemaForm
      schema={schema}
      contract={syntheticSoftwareContract}
      onSubmit={submit}
    />,
  );
  fireEvent.change(screen.getByLabelText(/AOI/), {
    target: { value: "invalid" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/AOI/), {
    target: { value: '{"type":"Polygon","coordinates":[]}' },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({
      aoi: { type: "Polygon", coordinates: [] },
    }),
  );
});
