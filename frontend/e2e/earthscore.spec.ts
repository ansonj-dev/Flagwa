import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { fromUrl } from "geotiff";
import type { ScoreSample } from "../src/features/earthscore/model";

test("Earthscore uses genuine COG values, links samples to the map, and exports retained evidence", async ({
  page,
  request,
  baseURL,
}) => {
  const results = await (await request.get("/backend/api/v1/results")).json();
  const result = results.data.find(
    (item: { metadata: { location: string } }) =>
      item.metadata.location === "kuttanad",
  );
  const errors: string[] = [],
    ranges: number[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (
      response.request().headers().range &&
      response.url().includes("/layers/")
    )
      ranges.push(response.status());
  });
  await page.goto("/earthscore/kuttanad");
  await expect(
    page.getByRole("heading", { name: "THE EARTHSCORE", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".earthscore-caption")).toContainText("192");
  await expect(
    page.getByRole("heading", { name: "A signal, told in field notes." }),
  ).toBeVisible();
  await expect(page.locator(".earthscore-dispatch-track")).toContainText(
    "DERIVED INTERVAL",
  );
  await expect(page.locator(".earthscore-dispatch")).toContainText(
    "RESEARCH LEAD",
  );
  await expect(page.locator(".earthscore-audio-status")).toHaveText(
    "Audio off",
  );
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Values & provenance" }).click();
  const download = await downloadEvent,
    provenance = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(provenance.analysis_id).toBe(result.id);
  expect(provenance.acquisition_dates).toEqual(
    result.metadata.acquisition_dates,
  );
  expect(provenance.artistic_encoding).toBe(true);
  expect(provenance.samples).toHaveLength(192);
  expect(provenance.overview.index).toBeGreaterThan(0);
  expect(ranges).toContain(206);
  const sample = provenance.samples.find(
    (item: ScoreSample) =>
      item.values.change !== null && item.values.change !== undefined,
  ) as ScoreSample;
  const manifest = await (
    await request.get(`/gateway/results/${result.id}/layers`)
  ).json();
  const tiff = await fromUrl(
    new URL(manifest.data.layers.change_geotiff.href, baseURL).href,
    { allowFullFile: false, maxRanges: 0 },
  );
  const image = await tiff.getImage(sample.pixel!.overview);
  const stored = await image.readRasters({
    window: [
      sample.pixel!.column,
      sample.pixel!.row,
      sample.pixel!.column + 1,
      sample.pixel!.row + 1,
    ],
    samples: [0],
    interleave: true,
  });
  expect(sample.values.change).toBe(Number(stored[0]));
  expect(10 * Math.log10(sample.storedValues!.before!)).toBe(
    sample.values.before,
  );
  await page.getByLabel("Sample / exact source value").selectOption(sample.id);
  await expect(page.getByTestId("earthscore-exact-value")).toHaveText(
    String(sample.values.change),
  );
  await expect(
    page.locator('[data-kind="change"] .earthscore-dispatch-value'),
  ).toHaveText(
    `${new Intl.NumberFormat("en", { maximumFractionDigits: 2, signDisplay: "always" }).format(sample.values.change!)} dB`,
  );
  await expect(page.locator(".earthscore-locator")).toHaveAttribute(
    "data-selected-sample",
    sample.id,
  );
  await page.getByLabel("Normalization maximum", { exact: true }).fill("0.01");
  await expect(page.getByTestId("earthscore-exact-value")).toHaveText(
    String(sample.values.change),
  );
  await page
    .getByRole("button", { name: "Reset normalization to sampled maximum" })
    .click();
  await page
    .getByLabel("Geographic region", { exact: true })
    .selectOption("all");
  const locator = page.locator(".earthscore-locator canvas");
  await expect(locator).toBeVisible();
  await expect
    .poll(async () =>
      Number(
        await page
          .locator(".earthscore-locator")
          .getAttribute("data-rendered-samples"),
      ),
    )
    .toBeGreaterThan(50);
  await locator.click({ position: { x: 110, y: 115 } });
  await expect(page.getByTestId("earthscore-selected-id")).not.toHaveText(
    sample.id,
  );
  const art = page.locator(".earthscore-canvas"),
    artBounds = (await art.boundingBox())!;
  await art.click({
    position: {
      x: artBounds.width * 0.49,
      y: 68 + ((0.2 + (0.5 / 24) * 0.6) * (artBounds.height - 128)) / 8,
    },
  });
  await expect(page.getByTestId("earthscore-selected-id")).toHaveText(
    sample.id,
  );
  await expect(page.locator(".earthscore-locator")).toHaveAttribute(
    "data-selected-sample",
    sample.id,
  );
  await expect(page.locator(".earthscore-locator")).toHaveAttribute(
    "data-selected-sample",
    await page.getByTestId("earthscore-selected-id").innerText(),
  );
  const pixels = await page
    .locator(".earthscore-canvas")
    .evaluate((element) => {
      const canvas = element as HTMLCanvasElement,
        data = canvas
          .getContext("2d")!
          .getImageData(0, 0, canvas.width, canvas.height).data;
      let cyan = 0;
      for (let index = 0; index < data.length; index += 4)
        if (
          data[index + 1] > 75 &&
          data[index + 2] > 80 &&
          data[index] < data[index + 1] * 0.8
        )
          cyan++;
      return cyan;
    });
  expect(pixels).toBeGreaterThan(200);
  await page.screenshot({
    path: "test-results/earthscore-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  const pngEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export artistic score" }).click();
  const artwork = await pngEvent;
  await artwork.saveAs("test-results/earthscore-export.png");
  const png = await readFile((await artwork.path())!);
  expect(png.readUInt32BE(16)).toBe(1800);
  expect(png.readUInt32BE(20)).toBeGreaterThan(1200);
  await page.locator(".earthscore-stage-buttons button").first().click();
  await expect(
    page.getByLabel("Available measurement", { exact: true }),
  ).toHaveValue("before");
  await expect(page.locator(".earthscore-locator")).toHaveAttribute(
    "data-stage",
    `observed-${result.metadata.acquisition_dates[0]}`,
  );
  await expect(page.locator(".earthscore-audio-status")).toHaveText(
    "Audio off",
  );
  await page.getByLabel("Earthscore location").selectOption("xingu");
  await expect(
    page.getByText("No completed scientific result for this location"),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("Earthscore audio is opt-in, pausable and stoppable; layouts and keyboard alternatives stay accessible", async ({
  page,
}) => {
  await page.goto("/earthscore/kuttanad");
  await expect(page.locator(".earthscore-caption")).toContainText("192");
  await page
    .getByRole("button", { name: "Play observation stages", exact: true })
    .click();
  await expect(page.locator(".earthscore-audio-status")).toHaveText(
    "Audio off",
  );
  await page
    .getByRole("button", { name: "Pause stage playback", exact: true })
    .click();
  await page
    .getByLabel("Available measurement", { exact: true })
    .selectOption("change");
  await page
    .getByRole("button", { name: "Play sonification", exact: true })
    .click();
  await expect(page.locator(".earthscore-audio-status")).toHaveText(
    "Playing documented values",
  );
  await page
    .getByRole("button", { name: "Pause sonification", exact: true })
    .click();
  await expect(page.locator(".earthscore-audio-status")).toHaveText("Paused");
  await page
    .getByRole("button", { name: "Resume sonification", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Mute sonification", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Unmute sonification", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Sonification volume", { exact: true }).fill("0.1");
  await page
    .getByRole("button", { name: "Stop sonification", exact: true })
    .click();
  await expect(page.locator(".earthscore-audio-status")).toHaveText(
    "Audio off",
  );
  for (const width of [1440, 768, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const violations = (
      await new AxeBuilder({ page }).analyze()
    ).violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    }));
    expect(violations).toEqual([]);
    await page.screenshot({
      path: `test-results/earthscore-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "THE EARTHSCORE", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close navigation", exact: true })
    .click();
  await page.locator(".earthscore-stage-buttons button").first().click();
  await expect(
    page.getByLabel("Available measurement", { exact: true }),
  ).toHaveValue("before");
});

test("Earthscore explicitly falls back to a reported aggregate when prepared spatial observations are unavailable", async ({
  page,
}) => {
  await page.route("**/gateway/results/*/layers", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          enabled: false,
          layers: {},
          reason: "Software acceptance test: bridge unavailable",
        },
      }),
    }),
  );
  await page.goto("/earthscore/kuttanad");
  await expect(page.locator(".earthscore-caption")).toContainText(
    "Whole-study aggregate",
  );
  await expect(page.getByTestId("earthscore-selected-id")).toHaveText(
    "study-aggregate",
  );
  await page.locator(".earthscore-stage-buttons button").first().click();
  await expect(page.getByTestId("earthscore-exact-value")).toHaveText(
    "Missing",
  );
  await expect(
    page.getByLabel("Available measurement", { exact: true }),
  ).toHaveValue("");
  await expect(page.locator(".earthscore-audio-status")).toHaveText(
    "Audio off",
  );
});

test("real geographic footprints render while optional contextual basemap tiles are stalled", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/Canvas/World_Dark_Gray_Base/MapServer/tile/**",
    async (route) => {
      await held;
      await route.abort();
    },
  );
  try {
    await page.goto("/earthscore/kuttanad");
    await expect(page.locator(".earthscore-caption")).toContainText("192");
    await expect
      .poll(async () =>
        Number(
          await page
            .locator(".earthscore-locator")
            .getAttribute("data-rendered-samples"),
        ),
      )
      .toBeGreaterThan(50);
    const cyan = await page
      .locator(".earthscore-locator canvas")
      .evaluate((element) => {
        const canvas = element as HTMLCanvasElement,
          context = canvas.getContext("webgl2")!,
          pixels = new Uint8Array(canvas.width * canvas.height * 4);
        context.readPixels(
          0,
          0,
          canvas.width,
          canvas.height,
          context.RGBA,
          context.UNSIGNED_BYTE,
          pixels,
        );
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4)
          if (
            pixels[index + 1] > 65 &&
            pixels[index + 1] > pixels[index] * 1.5 &&
            pixels[index + 2] > pixels[index] * 1.5
          )
            count++;
        return count;
      });
    expect(cyan).toBeGreaterThan(20);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});
