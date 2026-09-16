import { expect, test } from "@playwright/test";
import { seed } from "./seed";

/**
 * Happy path: a real patient signs in, searches, picks a live slot,
 * confirms, and finds the visit waiting on My visits.
 */
test("happy path: search, book, and see the visit", async ({ page }) => {
  const s = await seed("happy");

  await page.goto("/");
  await page.fill("#login-email", s.patientEmail);
  await page.fill("#login-password", s.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Find the right doctor, book in minutes",
    }),
  ).toBeVisible();

  await page.getByLabel("Specialty").fill(s.specialty);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("1 doctor found")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: s.doctorName }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Book visit" }).click();
  await expect(
    page.getByRole("heading", { name: `Book with ${s.doctorName}` }),
  ).toBeVisible();

  const slot = page.locator("button.slot").first();
  await expect(slot).toBeVisible({ timeout: 20_000 });
  await slot.click();
  await page.getByRole("button", { name: "Confirm booking" }).click();

  await expect(page.getByText("Booked! See you soon.")).toBeVisible();
  await expect(page).toHaveURL(/\/visits/, { timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: "Upcoming visits (1)" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".pill-confirmed").first()).toBeVisible();
});
