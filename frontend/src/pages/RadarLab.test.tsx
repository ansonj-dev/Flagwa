// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RadarLab } from "./RadarLab";

vi.mock("../features/radar-lab/ObservationLab", () => ({
  ObservationLab: () => <div>Observation workspace test boundary</div>,
}));
afterEach(cleanup);
function setup() {
  return render(
    <MemoryRouter>
      <RadarLab />
    </MemoryRouter>,
  );
}

test("surface switching updates the diagram, mechanism and qualitative profile without numerical measurement claims", () => {
  const { container } = setup();
  const waterTrace = container
    .querySelector(".lab-profile-line")
    ?.getAttribute("d");
  const waterScattering = container
    .querySelector(".lab-scattering path")
    ?.getAttribute("d");
  for (const [label, mechanism] of [
    ["Forest", "Volume scattering"],
    ["Built-up", "Double-bounce scattering"],
    ["Exposed soil", "Roughness & dielectric response"],
  ]) {
    fireEvent.click(screen.getByRole("button", { name: label, exact: true }));
    expect(screen.getByRole("heading", { name: mechanism })).toBeTruthy();
    expect(
      container.querySelector(".lab-profile-line")?.getAttribute("d"),
    ).not.toBe(waterTrace);
    expect(
      container.querySelector(".lab-scattering path")?.getAttribute("d"),
    ).not.toBe(waterScattering);
  }
  expect(
    screen.getByText("QUALITATIVE CONCEPT — NOT OBSERVED NISAR DATA."),
  ).toBeTruthy();
  expect(container.querySelector(".lab-profile")?.textContent).toContain(
    "NO SCALE",
  );
  expect(container.querySelector(".lab-profile")?.textContent).not.toMatch(
    /\d|dB|gamma/i,
  );
});

test("cloud and night affect context only and leave the concept return unchanged", () => {
  const { container } = setup();
  const trace = container.querySelector(".lab-profile-line")?.getAttribute("d");
  fireEvent.click(screen.getByRole("switch", { name: "Cloud cover" }));
  expect(container.querySelector(".lab-clouds")).toBeNull();
  fireEvent.click(screen.getByRole("switch", { name: "Night", exact: true }));
  expect(container.querySelector(".lab-scene.night")).toBeTruthy();
  expect(container.querySelector(".lab-beam")).toBeTruthy();
  expect(container.querySelector(".lab-profile-line")?.getAttribute("d")).toBe(
    trace,
  );
  expect(screen.getByText(/Radar provides its own illumination/)).toBeTruthy();
});

test("concept channels explain transmit/receive and corresponding illustrative GCOV terms", () => {
  setup();
  fireEvent.change(screen.getByLabelText("Illustrative polarization channel"), {
    target: { value: "HV" },
  });
  expect(
    screen.getByText(
      /Cross-polarization: transmit horizontal, receive vertical/,
    ),
  ).toBeTruthy();
  expect(screen.getByText(/GCOV power term HVHV/)).toBeTruthy();
  expect(
    screen.getByText(/not a claim of acquisition availability/),
  ).toBeTruthy();
});

test("mode tabs and direct concept CTA open the observation boundary; explorer stays location-specific", async () => {
  setup();
  fireEvent.click(
    screen.getByRole("button", { name: "Explore a Real NISAR Observation" }),
  );
  expect(
    await screen.findByText("Observation workspace test boundary"),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("tab", { name: "Inspect real observations" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  fireEvent.keyDown(
    screen.getByRole("tab", { name: "Inspect real observations" }),
    { key: "Home" },
  );
  expect(
    screen
      .getByRole("tab", { name: "Learn the signal" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(
    screen
      .getByRole("link", { name: "Open the Full FLAGWA Explorer" })
      .getAttribute("href"),
  ).toBe("/explore/kuttanad");
});
