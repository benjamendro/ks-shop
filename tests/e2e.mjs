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

  const nav = (page, go) =>
    page.locator(`[data-go="${go}"]`).filter({ visible: true }).first();

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

  async function waitReady(page) {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector("#app.ready", { timeout: 120000 });
  }

  async function searchTofu(page) {
    await page.fill("#q", "טופו");
    await page.waitForFunction(() => {
      const n = document.querySelectorAll("#catalog-list article.product").length;
      const c = document.querySelector("#catalog-count")?.textContent || "";
      return n >= 5 && /טופו|מוצרים/.test(c);
    }, { timeout: 15000 });
    await page.locator("#q").blur();
    await page.evaluate(() => { document.getElementById("suggest")?.setAttribute("hidden", ""); });
  }

  await withPage({ width: 1280, height: 800 }, "desktop", async (page) => {
    await waitReady(page);
    if (!(await page.locator("#cat-grid").isVisible())) {
      throw new Error("home category grid should be visible");
    }

    await searchTofu(page);
    const cards = page.locator("#catalog-list article.product");
    const n = await cards.count();
    if (n < 5) throw new Error(`tofu search expected many results, got ${n}`);
    const firstName = await cards.first().locator(".name").innerText();
    if (!firstName.includes("טופו")) throw new Error(`first result not tofu: ${firstName}`);
    const pills = await cards.first().locator(".item-prices span").count();
    if (pills < 6) throw new Error(`expected per-store prices, got ${pills}`);
    if (await page.locator(".group-h").count() < 1) throw new Error("expected brand group headings");

    await page.selectOption("#sort-by", "price-asc");
    await page.waitForTimeout(200);
    const prices = await page.$$eval("#catalog-list article.product .price-range", (els) =>
      els.slice(0, 5).map((el) => {
        const t = el.childNodes[0]?.textContent || el.textContent;
        const m = t.replace(/[^\d.]/g, " ").trim().split(/\s+/)[0];
        return parseFloat(m);
      })
    );
    for (let i = 1; i < prices.length; i++) {
      if (!(prices[i] + 0.001 >= prices[i - 1])) {
        throw new Error(`price sort not ascending: ${prices.join(", ")}`);
      }
    }

    await cards.first().locator('button[data-act="+"]').click();
    await page.waitForTimeout(150);
    if ((await page.locator("#nav-list-count").innerText()) !== "1") {
      throw new Error("list badge expected 1 after first add");
    }
    if (!(await page.locator("#fab-cart").isVisible())) throw new Error("FAB should appear after add");
    // stepper now visible
    if ((await cards.first().locator(".qty button[data-act='+']").count()) < 1) {
      throw new Error("add button should become a stepper");
    }
    await page.screenshot({ path: path.join(OUT, "desktop-search-tofu.png"), fullPage: true });

    // add two more from search
    await cards.nth(1).locator("button.add, button[data-act='+']").first().click();
    await cards.nth(2).locator("button.add, button[data-act='+']").first().click();

    // category browse
    await page.locator("#q-clear").click();
    await page.waitForSelector("#cat-grid", { state: "visible" });
    await page.locator(".cat-tile", { hasText: "חלב" }).first().click();
    await page.waitForSelector("#catalog-list article.product");
    const dairyN = await page.locator("#catalog-list article.product").count();
    if (dairyN < 1) throw new Error("dairy category empty");
    await page.locator("#catalog-list article.product").nth(0).locator('button[data-act="+"]').click();
    await page.locator("#catalog-list article.product").nth(1).locator('button[data-act="+"]').click();
    await page.screenshot({ path: path.join(OUT, "desktop-category.png"), fullPage: false });

    const badge = Number(await page.locator("#nav-list-count").innerText());
    if (badge < 5) throw new Error(`expected 5+ items, got ${badge}`);

    await nav(page, "list").click();
    await page.waitForSelector("#shop-list article");
    const listN = await page.locator("#shop-list article").count();
    if (listN < 5) throw new Error(`list page has ${listN} items`);
    if (!(await page.locator("#cta-compare").isVisible())) throw new Error("missing compare CTA");
    const estimate = await page.locator("#list-total").innerText();
    if (!estimate.includes("₪")) throw new Error(`missing list estimate: ${estimate}`);
    // bump quantity of first item
    await page.locator("#shop-list article .qty button[data-act='+']").first().click();
    await page.waitForTimeout(100);

    await page.locator("#cta-compare").click();
    await page.waitForSelector("#compare-root .compare-hero, #compare-root .store-card");
    const hero = await page.locator("#compare-root").innerText();
    if (!hero.includes("₪")) throw new Error(`compare unexpected: ${hero.slice(0, 200)}`);
    if ((await page.locator(".matrix").count()) < 1) throw new Error("missing price matrix");
    if ((await page.locator(".store-card").count()) < 2) throw new Error("expected ranked store cards");
    await page.screenshot({ path: path.join(OUT, "desktop-compare.png"), fullPage: true });

    await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector("#app.ready", { timeout: 120000 });
    await nav(page, "list").click();
    const persisted = await page.locator("#shop-list article").count();
    if (persisted < 5) throw new Error(`list did not persist, got ${persisted}`);
    await page.screenshot({ path: path.join(OUT, "desktop-list-persisted.png"), fullPage: true });
  });

  await withPage({ width: 390, height: 844 }, "mobile", async (page) => {
    await waitReady(page);
    await searchTofu(page);
    const cards = page.locator("#catalog-list article.product");
    if ((await cards.count()) < 5) throw new Error("mobile tofu search too few");
    if ((await cards.first().locator(".item-prices span").count()) < 6) {
      throw new Error("mobile card missing per-store prices");
    }
    await page.selectOption("#sort-by", "price-asc");
    await page.waitForTimeout(200);
    await cards.first().locator('button[data-act="+"]').click();
    await cards.nth(1).locator("button.add, button[data-act='+']").first().click();
    await page.screenshot({ path: path.join(OUT, "mobile-search-tofu.png"), fullPage: true });

    await page.locator("#q-clear").click();
    await page.locator(".cat-tile", { hasText: "חלב" }).first().click();
    await page.waitForSelector("#catalog-list article.product");
    await page.locator("#catalog-list article.product").nth(0).locator('button[data-act="+"]').click();
    await page.locator("#catalog-list article.product").nth(2).locator('button[data-act="+"]').click();

    await nav(page, "list").click();
    await page.waitForSelector("#shop-list article");
    if (!(await page.locator("#cta-compare").isVisible())) throw new Error("mobile list missing CTA");
    await page.screenshot({ path: path.join(OUT, "mobile-list.png"), fullPage: true });

    await page.locator("#cta-compare").click();
    await page.waitForSelector("#compare-root .store-card, #compare-root .compare-hero");
    if ((await page.locator(".matrix").count()) < 1) throw new Error("mobile missing matrix");
    await page.screenshot({ path: path.join(OUT, "mobile-compare.png"), fullPage: true });
  });

  await browser.close();
  if (pageErrors.length) {
    console.error("page errors:\n" + pageErrors.join("\n"));
  }
  if (errors.length) {
    console.error("FAIL:\n" + errors.join("\n"));
    process.exit(1);
  }
  if (pageErrors.length) process.exit(1);
  console.log("OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
