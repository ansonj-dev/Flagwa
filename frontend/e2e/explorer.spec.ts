import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("genuine backend evidence, ranged COG pixels, comparison and provenance", async ({
  page,
  request,
}) => {
  const records = await (await request.get("/backend/api/v1/results")).json();
  const result = records.data.find(
    (item: { metadata: { location: string } }) =>
      item.metadata.location === "kuttanad",
  );
  expect(result).toBeTruthy();
  const ranges: number[] = [],
    errors: string[] = [];
  page.on("response", (response) => {
    if (
      response.request().headers().range &&
      (response.url().includes("/layers/") ||
        response.url().includes("/geotiff"))
    )
      ranges.push(response.status());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/explore/kuttanad");
  await expect(
    page.getByRole("heading", { name: "Potential inundation", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText("These are radar-derived potential inundation candidates.", {
        exact: false,
      })
      .first(),
  ).toBeVisible();
  await expect(page.locator(".metric-grid")).toContainText(
    (result.statistics.candidate_area_m2 / 1e6).toFixed(2),
  );
  await expect(page.locator(".map-stage")).toHaveClass(/raster-ready/);
  await expect
    .poll(() => ranges.filter((status) => status === 206).length)
    .toBeGreaterThan(0);
  const readPixels = () =>
    page
      .locator(".map-canvas canvas")
      .first()
      .evaluate((canvas) => {
        const element = canvas as HTMLCanvasElement,
          context = element.getContext("webgl2")!,
          data = new Uint8Array(element.width * element.height * 4);
        context.readPixels(
          0,
          0,
          element.width,
          element.height,
          context.RGBA,
          context.UNSIGNED_BYTE,
          data,
        );
        let amber = 0,
          visible = 0;
        for (let index = 0; index < data.length; index += 4) {
          if (
            data[index] > 100 &&
            data[index + 1] > 75 &&
            data[index + 2] < 115 &&
            data[index] > data[index + 2] * 1.4
          )
            amber++;
          if (data[index] + data[index + 1] + data[index + 2] > 40) visible++;
        }
        return { amber, visible };
      });
  await expect
    .poll(async () => (await readPixels()).visible)
    .toBeGreaterThan(1000);
  await expect.poll(async () => (await readPixels()).amber).toBeGreaterThan(20);
  expect(
    await page
      .locator(".map-canvas canvas")
      .first()
      .evaluate((canvas) => canvas.getBoundingClientRect().height),
  ).toBe(1000);
  await page.screenshot({
    path: "test-results/explorer-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Compare observations", exact: true })
    .click();
  await expect(page).toHaveURL(/\/compare$/);
  const divider = page.getByRole("slider", {
    name: "Before and after comparison divider",
  });
  await expect(divider).toBeVisible();
  await divider.focus();
  await divider.press("ArrowRight");
  await expect(divider).toHaveValue("60");
  await divider.press("Shift+ArrowLeft");
  await expect(divider).toHaveValue("59");
  for (const canvas of await page.locator(".map-canvas canvas").all()) {
    await expect
      .poll(() =>
        canvas.evaluate((element) => {
          const canvas = element as HTMLCanvasElement,
            context = canvas.getContext("webgl2")!,
            data = new Uint8Array(canvas.width * canvas.height * 4);
          context.readPixels(
            0,
            0,
            canvas.width,
            canvas.height,
            context.RGBA,
            context.UNSIGNED_BYTE,
            data,
          );
          let grayscale = 0;
          for (let index = 0; index < data.length; index += 16)
            if (
              data[index] > 100 &&
              Math.abs(data[index] - data[index + 1]) < 4 &&
              Math.abs(data[index] - data[index + 2]) < 4
            )
              grayscale++;
          return grayscale;
        }),
      )
      .toBeGreaterThan(1000);
  }
  await page.screenshot({
    path: "test-results/comparison-desktop.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Evidence and provenance", exact: true })
    .click();
  await expect(
    page.getByText(result.metadata.source_scenes[0], { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Study location").selectOption("xingu");
  await page.getByRole("tab", { name: "Summary", exact: true }).click();
  await expect(
    page.getByText("No completed analysis for this location"),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("story imagery, radar lab controls, mobile sheets and accessible views", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#hero-title")).toHaveText("FLAGWA");
  await expect(page.locator(".place-item")).toHaveCount(8);
  const image = await page.request.get("/earth.jpg");
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image/");
  await page.screenshot({
    path: "test-results/story-desktop.png",
    fullPage: true,
  });
  const violations = (await new AxeBuilder({ page }).analyze()).violations;
  expect(
    violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Radar Lab" })
    .click();
  await page.getByRole("button", { name: "forest", exact: true }).click();
  await expect(page.locator("[aria-live=polite]")).toContainText(
    "Branches, trunks",
  );
  await page.getByRole("checkbox", { name: "Night", exact: true }).check();
  await expect(page.locator(".lab-scene")).toHaveClass(/night/);
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/explore/kuttanad");
    await expect(page.getByRole("heading", { name: /Kuttanad/ })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    if (width <= 768) {
      await page
        .getByRole("button", { name: "Full-height evidence panel" })
        .click();
      await expect(page.locator(".explorer")).toHaveClass(/sheet-full/);
      await expect(
        page.getByRole("heading", {
          name: "Potential inundation",
          exact: true,
        }),
      ).toBeVisible();
    }
    await page.screenshot({
      path: `test-results/explorer-${width}.png`,
      animations: "disabled",
    });
    if (width === 1280)
      expect(
        (await new AxeBuilder({ page }).analyze()).violations.map((item) => ({
          id: item.id,
          targets: item.nodes.map((node) => node.target),
        })),
      ).toEqual([]);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/radar-lab");
  await expect(page.locator("h1")).toContainText("Make sense");
});

test("layers, missing community data, experimental workbench, restricted access and zoom remain honest", async ({
  page,
}) => {
  await page.goto("/explore/kuttanad");
  await expect(
    page.getByRole("heading", { name: "Potential inundation", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Community context", exact: true })
    .click();
  await expect(
    page.getByText("Missing coverage is not zero exposure.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(/^Unavailable:/)).toContainText("population");
  await page.getByRole("button", { name: "Map layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Backscatter change/ }).check();
  await expect(page.locator(".map-legend")).toContainText(
    "Derived change · dB",
  );
  await page.getByRole("slider", { name: /Derived layer opacity/ }).fill(".5");
  await expect(page.getByText("50%", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Use contextual optical basemap" })
    .click();
  await expect(
    page.getByText("Context only · optical basemap, not NISAR", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".fatal-error")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Scientific workbench", exact: true })
    .click();
  await page.getByLabel("Analysis theme").selectOption("glacier");
  await expect(page.getByText("Experimental", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Queue scientific analysis" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Restricted operator access", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Restricted operations are disabled",
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await page.screenshot({
    path: "test-results/explorer-200-percent.png",
    animations: "disabled",
  });
  await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  await page.goto("/radar-lab");
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.map(
      (item) => item.id,
    ),
  ).toEqual([]);
  await page.goto("/about");
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.map(
      (item) => item.id,
    ),
  ).toEqual([]);
});
