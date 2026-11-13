#!/usr/bin/env python3
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PTimeout

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8765")
OUT = Path(os.environ.get("SCREENSHOT_DIR", "/workspace/ks-shop/screenshots"))
OUT.mkdir(parents=True, exist_ok=True)
CHROME = "/home/box/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome"
errors = []
page_errors = []


def run_desktop(page):
    page.goto(BASE, wait_until="domcontentloaded", timeout=120000)
    page.wait_for_selector("#app.ready", timeout=120000)
    page.fill("#q", "טופו")
    page.wait_for_timeout(400)
    count_text = page.locator("#catalog-count").inner_text()
    cards = page.locator("#catalog-list article.product")
    n = cards.count()
    if n < 5:
        raise AssertionError(f"tofu search expected many results, got {n} ({count_text})")
    first = cards.first.locator(".name").inner_text()
    if "טופו" not in first:
        raise AssertionError(f"first result not tofu: {first}")
    cards.first.locator('button[data-act="+"]').click()
    page.wait_for_timeout(150)
    badge = page.locator("#nav-list-count").inner_text()
    if badge != "1":
        raise AssertionError(f"list badge expected 1, got {badge}")
    page.screenshot(path=str(OUT / "desktop-search-tofu.png"), full_page=True)

    page.locator("#q-clear").click()
    page.locator(".chip", has_text="חלב").first.click()
    page.wait_for_timeout(250)
    dairy_n = page.locator("#catalog-list article.product").count()
    if dairy_n < 1:
        raise AssertionError("dairy category empty")
    page.locator("#catalog-list article.product").nth(0).locator('button[data-act="+"]').click()
    page.locator("#catalog-list article.product").nth(1).locator('button[data-act="+"]').click()
    page.screenshot(path=str(OUT / "desktop-category.png"), full_page=False)

    page.locator(".bottom-nav button[data-go='compare']").click()
    page.wait_for_selector("#compare-root")
    page.wait_for_timeout(200)
    hero = page.locator("#compare-root").inner_text()
    if "₪" not in hero and "זול" not in hero:
        raise AssertionError(f"compare view unexpected: {hero[:200]}")
    page.screenshot(path=str(OUT / "desktop-compare.png"), full_page=True)

    page.reload(wait_until="domcontentloaded", timeout=120000)
    page.wait_for_selector("#app.ready", timeout=120000)
    page.locator(".bottom-nav button[data-go='list']").click()
    page.wait_for_timeout(200)
    list_n = page.locator("#shop-list article").count()
    if list_n < 2:
        raise AssertionError(f"list did not persist, got {list_n}")
    page.screenshot(path=str(OUT / "desktop-list-persisted.png"), full_page=True)


def run_mobile(page):
    page.goto(BASE, wait_until="domcontentloaded", timeout=120000)
    page.wait_for_selector("#app.ready", timeout=120000)
    page.fill("#q", "טופו")
    page.wait_for_timeout(400)
    n = page.locator("#catalog-list article.product").count()
    if n < 5:
        raise AssertionError(f"mobile tofu search got {n}")
    page.locator("#catalog-list article.product").first.locator('button[data-act="+"]').click()
    page.screenshot(path=str(OUT / "mobile-search-tofu.png"), full_page=True)
    page.locator(".bottom-nav button[data-go='compare']").click()
    page.wait_for_timeout(250)
    page.screenshot(path=str(OUT / "mobile-compare.png"), full_page=True)
    page.reload(wait_until="domcontentloaded", timeout=120000)
    page.wait_for_selector("#app.ready", timeout=120000)
    badge = page.locator("#nav-list-count").inner_text()
    if int(badge or 0) < 1:
        raise AssertionError(f"mobile list did not persist, badge={badge}")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME, args=["--no-sandbox"])
        # desktop
        ctx = browser.new_context(viewport={"width": 1280, "height": 800}, locale="he-IL")
        page = ctx.new_page()
        page.on("pageerror", lambda e: page_errors.append(f"desktop: {e}"))
        try:
            run_desktop(page)
            print("desktop OK")
        except Exception as e:
            errors.append(f"desktop: {e}")
            page.screenshot(path=str(OUT / "desktop-FAILURE.png"), full_page=True)
            print("desktop FAIL", e)
        ctx.close()

        ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            locale="he-IL",
            is_mobile=True,
            has_touch=True,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        )
        page = ctx.new_page()
        page.on("pageerror", lambda e: page_errors.append(f"mobile: {e}"))
        try:
            run_mobile(page)
            print("mobile OK")
        except Exception as e:
            errors.append(f"mobile: {e}")
            page.screenshot(path=str(OUT / "mobile-FAILURE.png"), full_page=True)
            print("mobile FAIL", e)
        ctx.close()
        browser.close()

    if errors or page_errors:
        print("FAIL")
        for e in errors + page_errors:
            print(" -", e)
        sys.exit(1)
    print("E2E passed")
    print("screenshots in", OUT)


if __name__ == "__main__":
    main()
