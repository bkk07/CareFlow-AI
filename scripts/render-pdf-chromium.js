/**
 * Chromium PDF renderer helper for scripts/export-architecture-pdf.py.
 *
 * Usage:
 *   node render-pdf-chromium.js <input.html> <output.pdf> "<doc title>"
 *
 * Uses puppeteer (bundled Chromium, no system dependencies). Adds a
 * "Title · page / total" footer on every page via header/footer template.
 */
const path = require("path");

async function main() {
  const [htmlPath, pdfPath, title] = process.argv.slice(2);
  if (!htmlPath || !pdfPath) {
    console.error("Usage: node render-pdf-chromium.js <input.html> <output.pdf> [title]");
    process.exit(2);
  }
  const puppeteer = require("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
  });
  try {
    const page = await browser.newPage();
    await page.goto("file:///" + path.resolve(htmlPath).replace(/\\/g, "/"), {
      waitUntil: "networkidle0",
      timeout: 120000,
    });
    const safeTitle = (title || "Architecture").replace(/</g, "&lt;");
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate:
        `<div style="width:100%;font-size:8pt;font-family:'Segoe UI',Arial,sans-serif;` +
        `color:#6b7280;padding:0 15mm 0 15mm;">` +
        `<div style="border-top:1px solid #e5e7eb;padding-top:4px;text-align:right;">` +
        `${safeTitle} &nbsp;·&nbsp; <span class="pageNumber"></span> / <span class="totalPages"></span>` +
        `</div></div>`,
      margin: { top: "18mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });
    console.log("CHROMIUM-PDF-OK " + pdfPath);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("CHROMIUM-PDF-FAIL " + (e && e.message));
  process.exit(1);
});
