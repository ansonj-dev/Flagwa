import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("Groundwire is a source-linked signal inbox with responsive filters", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/groundwire");
  await expect(
    page.getByRole("heading", { name: "GROUNDWIRE", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Signal feed", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".groundwire-message").first()).toBeVisible();
  await expect(page.locator(".groundwire-message").first()).toContainText(
    "Research lead · hypothesis",
  );
  await expect(page.locator(".groundwire-message").first()).toContainText(
    "Open evidence",
  );
  await expect(page.locator(".groundwire-polling")).toContainText(
    "RESULTS POLL EVERY 30 SEC",
  );

  const areaFilter = page.getByRole("button", { name: /Kuttanad-Alappuzha/ });
  await areaFilter.click();
  await expect(areaFilter).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Review queue/ }).click();
  await expect(
    page.getByRole("button", { name: /Review queue/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /In progress/ }).click();
  await expect(
    page.getByRole("button", { name: /In progress/ }),
  ).toHaveAttribute("aria-pressed", "true");

  for (const width of [1440, 768, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const violations = (
      await new AxeBuilder({ page }).analyze()
    ).violations.map((violation) => violation.id);
    expect(violations).toEqual([]);
  }
  expect(errors).toEqual([]);
});
