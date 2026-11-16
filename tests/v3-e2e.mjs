// v3 end-to-end: generic items, smart input, paste-import with review, compare.
import { chromium } from "playwright";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:8765/").replace(/\/?$/, "/");
const SHOT = process.env.SHOT_PREFIX || "/tmp/ks-v3";
const LIST = [
  "חלב 3% x2",
  "2 לחם",
  "ביצים L 12",
  "1 ק\"ג עגבניות",
  "- מלפפונים",
  "3 יוגורט",
  "קוטג'",
  "אורז 1 ק\"ג",
  "שמן קנולה",
  "פסטה x2",
  "גבינה צהובבה", // typo
  "משהו לארוחת שישי!!", // junk line
].join("\n");

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond, extra }); console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

async function scenario(browser, label, viewport, shots) {
  const ctx = await browser.newContext({ viewport, locale: "he-IL", isMobile: viewport.width < 800, hasTouch: viewport.width < 800, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("dialog", (d) => d.dismiss());
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#app.ready", { timeout: 180000 });
  ok(`${label}: boot`, true, `${Date.now() - t0} ms`);
  ok(`${label}: default route is list`, await page.locator("#panel-list.active").isVisible());
  await page.evaluate(() => { localStorage.removeItem("ks-shop-list-v1"); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#app.ready", { timeout: 180000 });

  // 1) typing generic items
  const inp = page.locator("#smart-input");
  await inp.fill("טופ");
  await page.waitForSelector("#smart-suggest .sg", { timeout: 5000 });
  const sugg = await page.locator("#smart-suggest .sg").allInnerTexts();
  ok(`${label}: autocomplete for "טופ"`, sugg.some((s) => s.includes("טופו")), sugg.slice(0, 3).join(" | ").replace(/\n/g, " "));
  await page.locator("#smart-suggest .sg", { hasText: "טופו" }).first().click();
  await inp.fill("2 חלב 3%");
  await inp.press("Enter");
  await inp.fill("חלב x3");
  await inp.press("Enter");
  await page.locator("[data-quick='לחם']").click();
  const cards = page.locator("#shop-list .gen-item");
  ok(`${label}: generic cards`, (await cards.count()) === 4, `${await cards.count()} cards`);
  const milk = page.locator("#shop-list .gen-item", { hasText: "חלב 3%" }).first();
  const milkQty = (await milk.locator(".qty span").first().innerText()).trim();
  ok(`${label}: "2 חלב 3%" parsed qty 2`, milkQty === "2", milkQty);
  const milkPlain = page.locator("#shop-list .gen-item").filter({ has: page.locator(".name", { hasText: /^חלב$/ }) }).first();
  ok(`${label}: "חלב x3" parsed qty 3`, (await milkPlain.locator(".qty span").first().innerText()).trim() === "3");
  ok(`${label}: tofu has cheapest pick`, /הכי זול/.test(await page.locator("#shop-list .gen-item", { hasText: "טופו" }).innerText()));
  // open per-store picks and swap sheet
  await milk.locator("summary").click();
  await milk.locator("[data-swap]").first().click();
  await page.waitForSelector("#pick-sheet:not([hidden]) .alt-row");
  ok(`${label}: swap sheet lists alternatives`, (await page.locator("#pick-sheet .alt-row").count()) > 1);
  await page.locator("#pick-sheet [data-close-sheet]").click();
  // organic preference toggle on tofu
  const tofu = page.locator("#shop-list .gen-item", { hasText: "טופו" }).first();
  await tofu.locator("summary").click();
  await tofu.locator("[data-pref='organic']").click();
  ok(`${label}: organic pref tag`, /אורגני/.test(await page.locator("#shop-list .gen-item", { hasText: "טופו" }).first().locator(".gtags").innerText()));
  await page.locator("#shop-list .gen-item", { hasText: "טופו" }).first().locator("[data-pref='organic']").click();
  if (shots) { await page.evaluate(() => window.scrollTo(0, 0)); await inp.fill("גבינה צ"); await page.waitForSelector("#smart-suggest .sg"); await page.waitForTimeout(150); await page.screenshot({ path: shots.entry }); await inp.fill(""); await page.locator("#smart-suggest").evaluate((e) => (e.hidden = true)); }

  // 2) paste import
  await page.locator("#open-import").click();
  await page.locator("#import-text").fill(LIST);
  await page.locator("#import-parse").click();
  await page.waitForSelector("#import-rows .imp-row");
  const rows = page.locator("#import-rows .imp-row");
  const n = await rows.count();
  ok(`${label}: import parsed 12 lines`, n === 12, `${n}`);
  const vals = await page.locator("#import-rows .imp-text").evaluateAll((els) => els.map((e) => e.value));
  const qtys = await page.locator("#import-rows .imp-qty .n").allInnerTexts();
  ok(`${label}: import labels cleaned`, vals[0] === "חלב 3%" && vals[1] === "לחם" && vals[4] === "מלפפונים", vals.slice(0, 5).join(" / "));
  ok(`${label}: import qtys`, qtys[0].startsWith("2") && qtys[1].startsWith("2") && qtys[3].startsWith("1") && qtys[5].startsWith("3"), qtys.join(","));
  const summary = await page.locator("#import-summary").innerText();
  ok(`${label}: summary shows unmatched`, /לא נמצאו/.test(summary), summary.split("\n")[0]);
  // fix the typo row: use suggestion chip if any, else retype
  const typoRow = rows.nth(10);
  const typoConf = await typoRow.getAttribute("class");
  const chip = typoRow.locator("[data-imp-alt]", { hasText: "גבינה צהובה" });
  if (await chip.count()) await chip.first().click();
  else { await typoRow.locator(".imp-text").fill("גבינה צהובה"); await typoRow.locator(".imp-text").press("Enter"); }
  await page.waitForTimeout(100);
  const fixedVal = await page.locator("#import-rows .imp-row").nth(10).locator(".imp-text").inputValue();
  const fixedCls = await page.locator("#import-rows .imp-row").nth(10).getAttribute("class");
  ok(`${label}: typo fixed`, /גבינה צהובה/.test(fixedVal) && !/conf-none/.test(fixedCls), `${typoConf} -> ${fixedVal} ${fixedCls}`);
  // delete junk row
  const junk = page.locator("#import-rows .imp-row").nth(11);
  ok(`${label}: junk line flagged`, /conf-(none|low)/.test(await junk.getAttribute("class")), await junk.getAttribute("class"));
  await junk.locator("[data-imp-del]").click();
  // bump yogurt qty
  await page.locator("#import-rows .imp-row").nth(5).locator("[data-imp-q][data-d='1']").click();
  ok(`${label}: qty stepper in review`, (await page.locator("#import-rows .imp-row").nth(5).locator(".imp-qty .n").innerText()).startsWith("4"));
  if (shots) { await page.locator("#import-sheet .sheet-card").evaluate((e) => (e.scrollTop = 0)); await page.screenshot({ path: shots.import }); }
  const addTxt = await page.locator("#import-add").innerText();
  await page.locator("#import-add").click();
  await page.waitForSelector("#import-sheet", { state: "hidden" });
  const total = await page.locator("#shop-list .list-item").count();
  ok(`${label}: list after import`, total >= 13, `${total} items; button "${addTxt}"`);

  // 3) compare
  await page.locator("#cta-compare").click();
  await page.waitForSelector("#panel-compare.active .compare-hero");
  const hero = await page.locator(".compare-hero").innerText();
  ok(`${label}: compare hero`, /₪/.test(hero), hero.replace(/\n/g, " ").slice(0, 120));
  const pickNames = await page.locator(".matrix .pick-name").count();
  ok(`${label}: matrix shows per-store picks`, pickNames > 20, `${pickNames} pick names`);
  const missCells = await page.locator(".matrix td.miss").count();
  ok(`${label}: matrix coverage`, true, `${missCells} missing cells`);
  if (shots) { await page.locator(".matrix-block").evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 150)); await page.waitForTimeout(150); await page.screenshot({ path: shots.compare }); }
  // exact SKU mode still works: catalog search + add exact
  await page.locator("[data-go='catalog']").filter({ visible: true }).first().click();
  await page.locator("#q").fill("במבה");
  await page.locator("#q").press("Enter");
  await page.waitForSelector("#gen-banner:not([hidden]) .gen-add-btn", { timeout: 8000 });
  ok(`${label}: catalog generic banner`, true, (await page.locator("#gen-banner").innerText()).split("\n")[0]);
  await page.locator("#catalog-list .product .qty button").first().click();
  await page.locator("[data-go='compare']").filter({ visible: true }).first().click();
  ok(`${label}: exact item in matrix`, (await page.locator(".matrix .gtag", { hasText: "מדויק" }).count()) >= 1);
  // baskets page still renders
  await page.locator("[data-go='baskets']").filter({ visible: true }).first().click();
  ok(`${label}: baskets page`, (await page.locator("#panel-baskets.active").innerText()).length > 100);
  ok(`${label}: no console errors`, errs.length === 0, errs.slice(0, 3).join(" | "));
  await ctx.close();
}

const browser = await chromium.launch();
try {
  await scenario(browser, "mobile", { width: 390, height: 844 }, process.env.NO_SHOTS ? null : { entry: `${SHOT}-entry.png`, import: `${SHOT}-import.png`, compare: `${SHOT}-compare.png` });
  await scenario(browser, "desktop", { width: 1366, height: 900 }, null);
} finally {
  await browser.close();
}
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
