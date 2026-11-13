import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";
const OUT = process.env.SCREENSHOT_DIR || "/workspace/ks-shop/screenshots";

async function run() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const pageErrors = [];

  async function withPage(viewport, name, fn) {
    const context = await browser.newContext({
      viewport,
      locale: "he-IL",
      isMobile: viewport.width < 800,
      hasTouch: viewport.width < 800,
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(`${name}: ${e.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") pageErrors.push(`${name} console: ${msg.text()}`);
    });
    try {
      await fn(page);
    } catch (e) {
      errors.push(`${name}: ${e.message || e}`);
      await page.screenshot({ path: path.join(OUT, `${name}-FAILURE.png`), fullPage: true }).catch(() => {});
    }
    await context.close();
  }

  await withPage({ width: 1280, height: 800 }, "desktop", async (page) => {
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForSelector("#app.ready", { timeout: 120000 });
    // Search tofu
    await page.fill("#q", "טופו");
    await page.waitForTimeout(300);
    const countText = await page.locator("#catalog-count").innerText();
    const cards = page.locator("#catalog-list article.product");
    const n = await cards.count();
    if (n < 5) throw new Error(`tofu search expected many results, got ${n} (${countText})`);
    const firstName = await cards.first().locator(".name").innerText();
    if (!firstName.includes("טופו")) throw new Error(`first result not tofu: ${firstName}`);
    // Add first item
    await cards.first().locator('button[data-act="+"]').click();
    await page.waitForTimeout(100);
    const badge = await page.locator("#nav-list-count").innerText();
    if (badge !== "1") throw new Error(`list badge expected 1, got ${badge}`);
    await page.screenshot({ path: path.join(OUT, "desktop-search-tofu.png"), fullPage: true });

    // Browse a category
    await page.locator("#q-clear").click();
    const dairy = page.locator(".chip", { hasText: "חלב" });
    await dairy.first().click();
    await page.waitForTimeout(200);
    const dairyN = await page.locator("#catalog-list article.product").count();
    if (dairyN < 1) throw new Error("dairy category empty");
    // add two more from category
    await page.locator("#catalog-list article.product").nth(0).locator('button[data-act="+"]').click();
    await page.locator("#catalog-list article.product").nth(1).locator('button[data-act="+"]').click();
    await page.screenshot({ path: path.join(OUT, "desktop-category.png"), fullPage: false });

    // Compare
    await page.locator(".bottom-nav button[data-go='compare']").click();
    await page.waitForSelector(".compare-hero, #compare-root .store-card, #compare-root .empty");
    const hero = await page.locator("#compare-root").innerText();
    if (!hero.includes("₪") && !hero.includes("זול")) throw new Error(`compare view unexpected: ${hero.slice(0,200)}`);
    await page.screenshot({ path: path.join(OUT, "desktop-compare.png"), fullPage: true });

    // Persistence
    await page.reload({ waitUntil: "networkidle", timeout: 120000 });
    await page.waitForSelector("#app.ready", { timeout: 120000 });
    await page.locator(".bottom-nav button[data-go='list']").click();
    const listItems = await page.locator("#shop-list article").count();
    if (listItems < 2) throw new Error(`list did not persist, got ${listItems}`);
    await page.screenshot({ path: path.join(OUT, "desktop-list-persisted.png"), fullPage: true });
  });

  await withPage({ width: 390, height: 844 }, "mobile", async (page) => {
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForSelector("#app.ready", { timeout: 120000 });
    await page.fill("#q", "טופו");
    await page.waitForTimeout(300);
    const n = await page.locator("#catalog-list article.product").count();
    if (n < 5) throw new Error(`mobile tofu search got ${n}`);
    await page.locator("#catalog-list article.product").first().locator('button[data-act="+"]').click();
    await page.screenshot({ path: path.join(OUT, "mobile-search-tofu.png"), fullPage: true });
    await page.locator(".bottom-nav button[data-go='compare']").click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, "mobile-compare.png"), fullPage: true });
    // persist
    await page.reload({ waitUntil: "networkidle", timeout: 120000 });
    await page.waitForSelector("#app.ready", { timeout: 120000 });
    const badge = await page.locator("#nav-list-count").innerText();
    if (Number(badge) < 1) throw new Error(`mobile list did not persist, badge=${badge}`);
  });

  await browser.close();
  if (errors.length || pageErrors.length) {
    console.error("FAIL");
    for (const e of [...errors, ...pageErrors]) console.error(" -", e);
    process.exit(1);
  }
  console.log("E2E passed");
  console.log("screenshots in", OUT);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
