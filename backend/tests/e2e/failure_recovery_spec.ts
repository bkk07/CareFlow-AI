import { expect, test } from "@playwright/test";
import { apiGet, apiPost, seed, setFaultMode } from "./seed";

/**
 * Failure recovery: with the vendor timing out, the booking parks
 * visibly instead of vanishing; once the vendor heals and the operator
 * retries, the same visit flips to confirmed.
 */
test("failure recovery: timeout parks, retry confirms", async ({ page }) => {
  const s = await seed("recovery");

  await setFaultMode("timeout");
  try {
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
    await page.getByRole("button", { name: "Book visit" }).click();
    await expect(
      page.getByRole("heading", { name: `Book with ${s.doctorName}` }),
    ).toBeVisible();

    const slot = page.locator("button.slot").first();
    await expect(slot).toBeVisible({ timeout: 20_000 });
    await slot.click();
    await page.getByRole("button", { name: "Confirm booking" }).click();

    // The vendor is dark: the UI says the slot is held, and the visit
    // shows up parked — never silently lost.
    await expect(
      page.getByText("slot is held while we confirm"),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/visits/, { timeout: 15_000 });
    await expect(
      page.locator(".pill-reconciliation_required").first(),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await setFaultMode("none");
  }

  // The vendor heals; the operator re-drives the parked booking.
  const mine = await apiGet("/appointments", s.patientToken);
  const parked = mine.find(
    (a: any) => a.state === "reconciliation_required",
  );
  expect(parked).toBeTruthy();
  const records = await apiGet("/reconciliation/records", s.ownerToken);
  const record = records.find(
    (r: any) => r.appointment_id === parked.id,
  );
  expect(record).toBeTruthy();
  const retried = await apiPost(
    `/reconciliation/records/${record.id}/retry`,
    {},
    s.ownerToken,
  );
  expect(retried.resolution_status).toBe("resolved");

  await page.reload();
  await expect(page.locator(".pill-confirmed").first()).toBeVisible({
    timeout: 15_000,
  });
});
