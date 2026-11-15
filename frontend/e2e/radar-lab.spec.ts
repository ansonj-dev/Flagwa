import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("concept science, accessible mode controls and four responsive viewports", async ({
  page,
}) => {
  await page.goto("/radar-lab");
  await expect(
    page.getByRole("heading", {
      name: "Read the return, not just the surface.",
    }),
  ).toBeVisible();
  const trace = await page.locator(".lab-profile-line").getAttribute("d");
  await page.getByRole("switch", { name: "Cloud cover" }).uncheck();
  await page.getByRole("switch", { name: "Night", exact: true }).check();
  await expect(page.locator(".lab-scene")).toHaveClass(/night/);
  await expect(page.locator(".lab-beam")).toBeVisible();
  expect(await page.locator(".lab-profile-line").getAttribute("d")).toBe(trace);
  await page.getByRole("button", { name: "Forest", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Volume scattering" }),
  ).toBeVisible();
  expect(await page.locator(".lab-profile-line").getAttribute("d")).not.toBe(
    trace,
  );
  await page.getByLabel("Illustrative polarization channel").selectOption("HV");
  await expect(
    page.getByText(/Cross-polarization: transmit horizontal, receive vertical/),
  ).toBeVisible();
  await expect(
    page.getByText("QUALITATIVE CONCEPT — NOT OBSERVED NISAR DATA."),
  ).toBeVisible();
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    for (const selector of [
      ".lab-heading h1",
      ".lab-controls",
      ".lab-profile",
      ".lab-mode-switch",
    ]) {
      const box = await page.locator(selector).boundingBox();
      expect(box?.width).toBeGreaterThan(100);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    }
    await page.screenshot({
      path: `test-results/radar-lab-concept-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const violations = (await new AxeBuilder({ page }).analyze()).violations;
  expect(
    violations.map((item) => ({
      id: item.id,
      targets: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page.getByRole("tab", { name: "Learn the signal" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Inspect real observations" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/mode=observations/);
});

test("genuine NISAR metadata, inspection, preview pixels, COGs, downloads and empty locations", async ({
  page,
  request,
}) => {
  let envelope;
  await expect.poll(async () => {
    const response = await request.get("/backend/api/v1/results?limit=100");
    envelope = await response.json();
    return { status: response.status(), success: envelope.success, code: envelope.error?.code };
  }, { message: "The genuine backend must return its actual completed result records", timeout: 15_000 }).toEqual({ status: 200, success: true, code: undefined });
  const result = envelope.data.find(
    (item: { metadata: { location: string; synthetic?: boolean } }) =>
      item.metadata.location === "kuttanad" && item.metadata.synthetic !== true,
  );
  expect(result).toBeTruthy();
  const sceneId = result.metadata.source_scenes[0];
  const scene = (
    await (await request.get(`/backend/api/v1/scenes/${sceneId}`)).json()
  ).data;
  const inspection = (
    await (
      await request.get(
        `/backend/api/v1/scenes/${sceneId}/inspection?limit=1000`,
      )
    ).json()
  ).data;
  const errors: string[] = [];
  const ranges: number[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (
      response.request().headers().range &&
      (response.url().includes("/layers/") ||
        response.url().includes("/geotiff"))
    )
      ranges.push(response.status());
  });
  await page.goto("/radar-lab?mode=observations");
  await page.getByLabel("Study location").selectOption("kuttanad");
  await page.getByLabel("Completed analysis result").selectOption(result.id);
  await expect(
    page.getByRole("heading", { name: "Potential inundation", exact: true }),
  ).toBeVisible();
  const metadata = page.getByRole("region", {
    name: "Actual observation metadata",
  });
  await expect(metadata).toContainText(result.id);
  await expect(metadata).toContainText(result.metadata.algorithm_version);
  await expect(page.locator(".lab-validation")).toContainText(
    result.validation_status,
  );
  await expect(page.getByLabel("Relevant source scene")).toHaveValue(sceneId);
  const source = page.getByRole("region", { name: "Source scene inspection" });
  await expect(source).toContainText(scene.source);
  await expect(source).toContainText(scene.flight_direction);
  await expect(
    page.getByLabel("Catalogue polarization channel").locator("option"),
  ).toHaveText(scene.polarizations);
  const actualTerms = inspection.datasets
    .filter((item: { dataset_path: string }) =>
      /\/frequencyA\/(HHHH|HVHV|VHVH|VVVV)$/.test(item.dataset_path),
    )
    .map((item: { dataset_path: string }) =>
      item.dataset_path.split("/").at(-1),
    );
  await expect(
    page.getByLabel("Available inspected GCOV power term").locator("option"),
  ).toHaveText(actualTerms);
  const dataset = inspection.datasets[0];
  await page.getByLabel("Filter HDF5 dataset paths").fill(dataset.dataset_path);
  await page.locator(".lab-dataset-browser summary").first().click();
  await expect(page.locator(".lab-dataset-browser")).toContainText(
    dataset.dtype,
  );
  await expect(page.locator(".lab-dataset-browser")).toContainText(
    "Dataset attributes",
  );
  const image = page.locator(".lab-result-media > img");
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(100);
  const pixels = await image.evaluate((el) => {
    const image = el as HTMLImageElement;
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 100;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0, 100, 100);
    const values = context.getImageData(0, 0, 100, 100).data;
    return new Set(
      Array.from({ length: values.length / 4 }, (_, index) =>
        Array.from(values.slice(index * 4, index * 4 + 4)).join(","),
      ),
    ).size;
  });
  expect(pixels).toBeGreaterThan(2);
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `test-results/radar-lab-observations-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const violations = (await new AxeBuilder({ page }).analyze()).violations;
  expect(
    violations.map((item) => ({
      id: item.id,
      targets: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Processed map", exact: true })
    .click();
  await expect(page.locator(".map-stage")).toHaveClass(/raster-ready/);
  await expect
    .poll(() => ranges.filter((status) => status === 206).length)
    .toBeGreaterThan(0);
  const mapPixels = () =>
    page
      .locator(".map-canvas canvas")
      .first()
      .evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        const context = canvas.getContext("webgl2")!;
        const data = new Uint8Array(canvas.width * canvas.height * 4);
        context.readPixels(
          0,
          0,
          canvas.width,
          canvas.height,
          context.RGBA,
          context.UNSIGNED_BYTE,
          data,
        );
        let amber = 0;
        for (let index = 0; index < data.length; index += 4)
          if (
            data[index] > 100 &&
            data[index + 1] > 75 &&
            data[index + 2] < 115 &&
            data[index] > data[index + 2] * 1.4
          )
            amber++;
        return amber;
      });
  await expect.poll(mapPixels).toBeGreaterThan(20);
  await page
    .locator(".lab-result-media")
    .screenshot({ path: "test-results/radar-lab-genuine-map.png" });
  const manifest = (
    await (await request.get(`/gateway/results/${result.id}/layers`)).json()
  ).data;
  for (const [role, label] of [
    ["before_power", "Before power"],
    ["after_power", "After power"],
    ["change_geotiff", "Backscatter change"],
  ]) {
    if (!manifest.layers?.[role]) continue;
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator(".map-stage")).toHaveClass(/raster-ready/);
  }
  for (const [label, suffix] of [
    ["GeoTIFF", "geotiff"],
    ["GeoJSON", "geojson"],
    ["Summary JSON", "summary"],
  ]) {
    const href = await page
      .getByRole("link", { name: label, exact: true })
      .getAttribute("href");
    expect(href).toBe(`/backend/api/v1/exports/${result.id}/${suffix}`);
    const response = await request.get(href!, {
      headers: { Range: "bytes=0-99" },
    });
    expect(response.ok()).toBeTruthy();
  }
  await expect(
    page.getByRole("link", { name: "Open in FLAGWA Explorer" }),
  ).toHaveAttribute("href", `/explore/kuttanad/results/${result.id}`);
  await page.getByLabel("Study location").selectOption("xingu");
  await expect(
    page.getByText(
      "No processed NISAR observation is currently available for this study area.",
    ),
  ).toBeVisible();
  await page
    .getByRole("link", { name: /Open Catalogue and Compatibility/ })
    .click();
  await expect(page).toHaveURL(/\/explore\/xingu$/);
  await expect(
    page.getByRole("heading", { name: "Discover NISAR observations" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
