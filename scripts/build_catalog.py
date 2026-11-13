#!/usr/bin/env python3
"""Fetch the full Kiryat Shmona price catalog from Over.org.il and build
compact JSON files for the PWA.

Uses the public, unauthenticated Over REST table API (no key). Pulls every
current price row for the city supermarket branches (and optional pharmacy /
convenience stores), joins promotions, classifies products, and writes:

  web/data/meta.json       stores, categories, coverage, as-of dates
  web/data/products.json   compact catalog, barcode-merged across chains
  web/data/stats.json      build report (counts, category coverage)
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

# Allow running from any cwd
ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

from classify import (  # noqa: E402
    CATEGORIES,
    classify,
    is_junk,
    category_maps,
    _self_test,
)

AMMAN = ZoneInfo("Asia/Amman")
BASE = "https://www.over.org.il"
UA = "ks-shop/2.0 (Kiryat Shmona basket comparison; personal use)"
COLS = (
    "chain,store_id,item_code,item_code_bare,item_name,manufacturer_name,"
    "quantity,unit_qty,unit_of_measure,is_weighted,item_price,"
    "unit_of_measure_price,as_of,allow_discount"
)
PROMO_COLS = (
    "chain,store_id,promotion_id,description,start_date,end_date,reward_type,"
    "discount_type,discount_rate,discounted_price,min_qty,max_qty,"
    "min_purchase_amount,club_id,additional_is_coupon,additional_restrictions,remarks"
)
PROMO_ITEM_COLS = (
    "chain,promotion_id,item_code,item_code_bare,is_gift_item,reward_type,"
    "discount_type,discount_rate,discounted_price,min_qty,max_qty,is_weighted"
)

# Core supermarket branches in Kiryat Shmona, plus optional kinds.
# Display names are cleaned for the app.
STORES = [
    {"chain": "cerberus:ramilevi", "store_id": "38", "chain_name": "רמי לוי",
     "store_name": "רמי לוי", "short": "רמי לוי", "address": "אזור תעשייה צפוני",
     "kind": "supermarket", "color": "#1f7a4d"},
    {"chain": "cerberus:yohananof", "store_id": "39", "chain_name": "יוחננוף",
     "store_name": "יוחננוף", "short": "יוחננוף", "address": "שדרות תל חי 93",
     "kind": "supermarket", "color": "#c45c26"},
    {"chain": "carrefour:carrefour", "store_id": "129", "chain_name": "קרפור",
     "store_name": "קרפור", "short": "קרפור", "address": "טשרניחובסקי 4",
     "kind": "supermarket", "color": "#184fa2"},
    {"chain": "bina:supersapir", "store_id": "22", "chain_name": "נטו חיסכון",
     "store_name": "נטו חיסכון / סופר ספיר", "short": "נטו", "address": "היהלום 8, א.ת. דרומי",
     "kind": "supermarket", "color": "#0f7a8a"},
    {"chain": "shufersal:shufersal", "store_id": "97", "chain_name": "שופרסל",
     "store_name": "שופרסל דיל (ביג)", "short": "שופרסל דיל", "address": "מתחם ביג",
     "kind": "supermarket", "color": "#d12c2c"},
    {"chain": "shufersal:shufersal", "store_id": "250", "chain_name": "שופרסל",
     "store_name": "שופרסל צומת מצודות", "short": "צומת מצודות", "address": "צומת מצודות",
     "kind": "supermarket", "color": "#9b1c1c"},
    # Optional pharmacy
    {"chain": "superpharm:superpharm", "store_id": "192", "chain_name": "סופר-פארם",
     "store_name": "סופר-פארם ביג", "short": "ס-פארם ביג", "address": "מתחם ביג, א.ת. דרומי",
     "kind": "pharmacy", "color": "#0b6e4f"},
    {"chain": "superpharm:superpharm", "store_id": "42", "chain_name": "סופר-פארם",
     "store_name": "סופר-פארם צומת גיבור", "short": "ס-פארם גיבור", "address": "הנשיא 4",
     "kind": "pharmacy", "color": "#0b6e4f"},
    {"chain": "shufersal:shufersal", "store_id": "657", "chain_name": "Be",
     "store_name": "Be קריית שמונה", "short": "Be", "address": "קניון שמונה סנטר, טשרניחובסקי 4",
     "kind": "pharmacy", "color": "#6b2d5b"},
    # Optional convenience (in town + nearby junctions)
    {"chain": "cerberus:paz_bo", "store_id": "313", "chain_name": "יינות ביתן / יילו",
     "store_name": "יילו שדרות תל חי", "short": "יילו תל חי", "address": "שדרות תל חי",
     "kind": "convenience", "color": "#f0a202", "nearby": False},
    {"chain": "cerberus:doralon", "store_id": "658", "chain_name": "דור אלון",
     "store_name": "דור אלון צומת הגומא", "short": "צומת הגומא", "address": "כביש 90, צומת הגומא",
     "kind": "convenience", "color": "#e07a3d", "nearby": True},
    {"chain": "cerberus:paz_bo", "store_id": "430", "chain_name": "יינות ביתן / יילו",
     "store_name": "יילו צומת כח", "short": "צומת כח", "address": "מפגש כביש 90 עם כביש 899",
     "kind": "convenience", "color": "#f0a202", "nearby": True},
]


def now_iso() -> str:
    return datetime.now(AMMAN).isoformat(timespec="seconds")


def api(path: str, params: dict | None = None, timeout: int = 90, retries: int = 5):
    url = BASE + path
    if params:
        clean = {k: v for k, v in params.items() if v is not None}
        url += "?" + urllib.parse.urlencode(clean, doseq=True)
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": UA})
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode())
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
            time.sleep(1.2 * (attempt + 1))
    raise RuntimeError(f"API failed after {retries} retries: {url[:180]} :: {last}")


def fetch_pages(table: str, params: dict, label: str, order: str = "item_code", max_rows: int | None = None) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    limit = 1000
    while True:
        data = api(
            f"/api/prices/table/{table}",
            {**params, "current": "true", "limit": limit, "offset": offset, "order": order},
        )
        chunk = data.get("rows") or []
        rows.extend(chunk)
        has_more = bool(data.get("has_more"))
        print(f"  [{label}] {table} offset={offset} got={len(chunk)} total={len(rows)} has_more={has_more} ms={data.get('elapsed_ms')}", flush=True)
        if not has_more or not chunk:
            break
        if max_rows is not None and len(rows) >= max_rows:
            break
        offset += limit
        time.sleep(0.05)
    return rows


def bare_code(row: dict) -> str:
    raw = str(row.get("item_code_bare") or row.get("item_code") or "").strip()
    raw = raw.lstrip("0") or raw
    return raw


def is_barcode(code: str) -> bool:
    return code.isdigit() and 8 <= len(code) <= 14


def store_key(chain: str, store_id: str) -> str:
    return f"{chain}:{store_id}"


def to_float(v) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def to_int_flag(v) -> int:
    return 1 if str(v) in ("1", "true", "True", "yes") else 0


def better_name(a: str, b: str) -> str:
    a = (a or "").strip()
    b = (b or "").strip()
    if not a:
        return b
    if not b:
        return a
    # Prefer the longer Hebrew-looking name
    return a if len(a) >= len(b) else b


def club_flag(club_id) -> int:
    s = str(club_id or "").strip()
    if not s or s in ("0", "0 - כלל הלקוחות", "כלל הלקוחות"):
        return 0
    return 1


def build() -> dict:
    fails = _self_test()
    if fails:
        raise SystemExit("Classifier self-test failed:\n" + "\n".join(fails))

    out_dir = ROOT / "web" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = ROOT / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    # Coverage snapshot
    coverage = {}
    for s in STORES:
        sk = store_key(s["chain"], s["store_id"])
        data = api("/api/prices/table/prices_coverage", {
            "chain": s["chain"], "store_id": s["store_id"], "limit": 1,
            "order": "-snapshot_date",
            "columns": "snapshot_date,price_file_time,price_items,promo_file_time,promo_count",
        })
        row = (data.get("rows") or [{}])[0]
        coverage[sk] = row
        print(f"coverage {s['short']}: items={row.get('price_items')} promos={row.get('promo_count')} as_of={row.get('snapshot_date')} file={row.get('price_file_time')}", flush=True)

    # Fetch prices per store (parallel, modest concurrency)
    prices_by_store: dict[str, list[dict]] = {}

    def job_prices(s: dict) -> tuple[str, list[dict]]:
        sk = store_key(s["chain"], s["store_id"])
        rows = fetch_pages(
            "prices_market",
            {"chain": s["chain"], "store_id": s["store_id"], "columns": COLS},
            label=s["short"],
            order="item_code",
        )
        return sk, rows

    resume = "--fresh" not in sys.argv
    print(f"Fetching prices for {len(STORES)} stores (resume={resume})...", flush=True)
    need = []
    for s in STORES:
        sk = store_key(s["chain"], s["store_id"])
        rawp = raw_dir / f"prices_{sk.replace(':','_')}.json"
        if resume and rawp.exists():
            data = json.loads(rawp.read_text(encoding="utf-8"))
            rows = data["rows"] if isinstance(data, dict) else data
            prices_by_store[sk] = rows
            print(f"  resume {sk} ({len(rows)} rows)", flush=True)
        else:
            need.append(s)
    if need:
        with ThreadPoolExecutor(max_workers=3) as pool:
            futs = [pool.submit(job_prices, s) for s in need]
            for fut in as_completed(futs):
                sk, rows = fut.result()
                prices_by_store[sk] = rows
                (raw_dir / f"prices_{sk.replace(':','_')}.json").write_text(
                    json.dumps({"n": len(rows), "rows": rows}, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8",
                )
                print(f"  saved {sk} ({len(rows)} rows)", flush=True)

    # Promotions per store
    promos_by_store: dict[str, list[dict]] = {}

    def job_promos(s: dict) -> tuple[str, list[dict]]:
        sk = store_key(s["chain"], s["store_id"])
        rows = fetch_pages(
            "prices_promotions",
            {"chain": s["chain"], "store_id": s["store_id"], "columns": PROMO_COLS},
            label=f"promo:{s['short']}",
            order="promotion_id",
        )
        return sk, rows

    print("Fetching promotions...", flush=True)
    need_p = []
    for s in STORES:
        sk = store_key(s["chain"], s["store_id"])
        rawp = raw_dir / f"promos_{sk.replace(':','_')}.json"
        if resume and rawp.exists():
            data = json.loads(rawp.read_text(encoding="utf-8"))
            rows = data["rows"] if isinstance(data, dict) else data
            promos_by_store[sk] = rows
            print(f"  resume promos {sk} ({len(rows)})", flush=True)
        else:
            need_p.append(s)
    if need_p:
        with ThreadPoolExecutor(max_workers=3) as pool:
            futs = [pool.submit(job_promos, s) for s in need_p]
            for fut in as_completed(futs):
                sk, rows = fut.result()
                promos_by_store[sk] = rows
                (raw_dir / f"promos_{sk.replace(':','_')}.json").write_text(
                    json.dumps({"n": len(rows), "rows": rows}, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8",
                )
                print(f"  promos {sk}: {len(rows)}", flush=True)

    # Promo items per chain, filtered to promotion IDs we actually have in KS stores
    wanted: dict[str, set[str]] = {}
    for s in STORES:
        sk = store_key(s["chain"], s["store_id"])
        wanted.setdefault(s["chain"], set())
        for p in promos_by_store.get(sk, []):
            pid = str(p.get("promotion_id") or "").strip()
            if pid:
                wanted[s["chain"]].add(pid)

    promo_items: dict[tuple[str, str], list[dict]] = {}  # (chain, promo_id) -> items

    def fetch_promo_items_for_chain(chain: str, pids: set[str]) -> dict[tuple[str, str], list[dict]]:
        # Filter by promotion_id in batches (the national items table is huge).
        out: dict[tuple[str, str], list[dict]] = {}
        ids = sorted(pids)
        batch_size = 40
        keep = 0
        for i in range(0, len(ids), batch_size):
            batch = ids[i:i + batch_size]
            rows = fetch_pages(
                "prices_promotion_items",
                {"chain": chain, "promotion_id": ",".join(batch), "columns": PROMO_ITEM_COLS},
                label=f"promo-items:{chain}[{i+1}-{i+len(batch)}/{len(ids)}]",
                order="promotion_id,item_code",
                max_rows=2000,  # if a batch is huge it is almost certainly a blanket deal
            )
            for r in rows:
                pid = str(r.get("promotion_id") or "").strip()
                if pid in pids:
                    out.setdefault((chain, pid), []).append(r)
                    keep += 1
        print(f"  promo-items {chain}: kept={keep} promos={len(out)} of {len(pids)} ids", flush=True)
        return out

    print("Fetching promotion items by chain...", flush=True)
    need_i = {}
    for chain, pids in wanted.items():
        if not pids:
            continue
        rawp = raw_dir / f"promo_items_{chain.replace(':','_')}.json"
        if resume and rawp.exists():
            data = json.loads(rawp.read_text(encoding="utf-8"))
            n = 0
            for pid, items in (data.get("by_pid") or {}).items():
                if pid in pids:
                    promo_items[(chain, pid)] = items
                    n += len(items)
            print(f"  resume promo-items {chain}: kept={n} cached", flush=True)
        else:
            need_i[chain] = pids
    if need_i:
        with ThreadPoolExecutor(max_workers=3) as pool:
            futs = {pool.submit(fetch_promo_items_for_chain, chain, pids): chain
                    for chain, pids in need_i.items()}
            for fut in as_completed(futs):
                part = fut.result()
                promo_items.update(part)
                chain = futs[fut]
                by_pid = {}
                for (ch, pid), items in part.items():
                    by_pid[pid] = items
                (raw_dir / f"promo_items_{chain.replace(':','_')}.json").write_text(
                    json.dumps({"by_pid": by_pid}, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8",
                )

    # Index stores
    store_ids = [store_key(s["chain"], s["store_id"]) for s in STORES]
    store_index = {sk: i for i, sk in enumerate(store_ids)}
    n_stores = len(STORES)

    # Merge products by barcode (8–14 digits). Short/internal codes stay chain-scoped.
    products: dict[str, dict] = {}

    def product_key(chain: str, code: str) -> str:
        if is_barcode(code):
            return code
        return f"{chain}:{code}"

    for s in STORES:
        sk = store_key(s["chain"], s["store_id"])
        si = store_index[sk]
        for r in prices_by_store.get(sk, []):
            code = bare_code(r)
            if not code:
                continue
            name = (r.get("item_name") or "").strip()
            price = to_float(r.get("item_price"))
            if is_junk(name, price):
                continue
            if price is None:
                continue
            unit_p = to_float(r.get("unit_of_measure_price"))
            weighted = to_int_flag(r.get("is_weighted"))
            pk = product_key(s["chain"], code)
            rec = products.get(pk)
            if rec is None:
                rec = {
                    "c": pk if is_barcode(code) else code,
                    "n": name,
                    "m": (r.get("manufacturer_name") or "").strip(),
                    "q": (r.get("quantity") or "").strip(),
                    "u": (r.get("unit_qty") or r.get("unit_of_measure") or "").strip(),
                    "w": weighted,
                    "p": [None] * n_stores,
                    "up": [None] * n_stores,  # unit price, dropped later if unused
                    "t": [None] * n_stores,
                    "_src": 0,
                }
                products[pk] = rec
            else:
                rec["n"] = better_name(rec["n"], name)
                manu = (r.get("manufacturer_name") or "").strip()
                if manu and (not rec["m"] or len(manu) > len(rec["m"])):
                    rec["m"] = manu
                if rec["w"] == 0 and weighted:
                    rec["w"] = 1
                if (r.get("quantity") and not rec["q"]) or (
                    r.get("quantity") and rec["q"] in ("1.00", "1", "1.0") and r.get("quantity") not in ("1.00", "1", "1.0")
                ):
                    rec["q"] = str(r.get("quantity")).strip()
                    rec["u"] = (r.get("unit_qty") or rec["u"] or "").strip()
            rec["p"][si] = round(price, 2)
            if unit_p is not None:
                rec["up"][si] = round(unit_p, 2)
            rec["t"][si] = r.get("as_of") or None
            rec["_src"] += 1

    # Attach promotions: list per product, compact
    # Skip blanket/store-wide deals (e.g. a coupon attached to thousands of barcodes)
    # so the catalog stays small and the badges stay meaningful.
    BLANKET = 60
    blanket_skipped = 0
    print("Attaching promotions...", flush=True)
    for s in STORES:
        sk = store_key(s["chain"], s["store_id"])
        si = store_index[sk]
        for promo in promos_by_store.get(sk, []):
            pid = str(promo.get("promotion_id") or "").strip()
            items = promo_items.get((s["chain"], pid)) or []
            if not items:
                continue
            if len(items) > BLANKET:
                blanket_skipped += 1
                continue
            desc = (promo.get("description") or "").strip()
            until = (promo.get("end_date") or "")[:10]
            club = club_flag(promo.get("club_id"))
            coupon = to_int_flag(promo.get("additional_is_coupon"))
            for it in items:
                code = bare_code(it)
                if not code:
                    continue
                pk = product_key(s["chain"], code)
                rec = products.get(pk)
                if rec is None:
                    continue
                dp = to_float(it.get("discounted_price") if it.get("discounted_price") is not None else promo.get("discounted_price"))
                mq = to_float(it.get("min_qty") if it.get("min_qty") is not None else promo.get("min_qty"))
                xq = to_float(it.get("max_qty") if it.get("max_qty") is not None else promo.get("max_qty"))
                entry = {"s": si, "d": desc}
                if dp is not None:
                    entry["dp"] = round(dp, 2)
                if mq is not None and mq != 1:
                    entry["mq"] = mq if mq != int(mq) else int(mq)
                elif mq is not None:
                    entry["mq"] = int(mq) if mq == int(mq) else mq
                if xq is not None:
                    entry["xq"] = xq if xq != int(xq) else int(xq)
                if club:
                    entry["club"] = 1
                if coupon:
                    entry["cpn"] = 1
                if until:
                    entry["until"] = until
                lst = rec.setdefault("pr", [])
                if len(lst) < 8:
                    lst.append(entry)

    print(f"Promotions attached (skipped {blanket_skipped} blanket deals with >{BLANKET} items)", flush=True)

    # Classify + compact
    cat_counts: dict[str, int] = {c["id"]: 0 for c in CATEGORIES}
    sub_counts: dict[str, int] = {}
    unmatched_samples = []
    out_products = []
    tofu_n = 0

    print(f"Classifying {len(products)} products...", flush=True)
    for rec in products.values():
        # drop unit-price array if it adds little (keep only for weighted)
        if rec["w"]:
            rec["up"] = rec["up"]
        else:
            rec.pop("up", None)
        # as-of: keep max date only at product level to save space? keep per-store if they differ
        dates = [t for t in rec["t"] if t]
        rec["t"] = max(dates) if dates else ""
        cat, sub, why = classify(rec["n"], rec["m"])
        if cat == "other":
            kinds = {
                STORES[i]["kind"]
                for i, price in enumerate(rec["p"])
                if price is not None
            }
            if kinds and kinds <= {"pharmacy"}:
                cat, sub, why = "hygiene", "pharmacy", "pharmacy-store"
        rec["k"] = cat
        rec["ks"] = sub
        cat_counts[cat] = cat_counts.get(cat, 0) + 1
        sub_counts[sub] = sub_counts.get(sub, 0) + 1
        if cat == "other":
            if len(unmatched_samples) < 40:
                unmatched_samples.append({"n": rec["n"], "m": rec["m"], "c": rec["c"]})
        if "טופו" in (rec["n"] or ""):
            tofu_n += 1
        rec.pop("_src", None)
        # trim empty promo
        if not rec.get("pr"):
            rec.pop("pr", None)
        else:
            # cap 4 promos per store to control size, prefer those with discounted_price
            by_s: dict[int, list] = {}
            for p in rec["pr"]:
                by_s.setdefault(p["s"], []).append(p)
            trimmed = []
            for slist in by_s.values():
                slist.sort(key=lambda p: (0 if "dp" in p else 1, 0 if not p.get("club") else 1, -len(p.get("d") or "")))
                trimmed.extend(slist[:3])
            rec["pr"] = trimmed
        out_products.append(rec)

    # Sort: more stores first, then name
    def store_count(p):
        return sum(1 for x in p["p"] if x is not None)

    out_products.sort(key=lambda p: (-store_count(p), p["n"]))

    generated = now_iso()
    as_of_dates = []
    stores_out = []
    for s in STORES:
        sk = store_key(s["chain"], s["store_id"])
        cov = coverage.get(sk) or {}
        as_of = cov.get("snapshot_date") or ""
        as_of_dates.append(as_of)
        stores_out.append({
            "id": sk,
            "chain": s["chain"],
            "chain_name": s["chain_name"],
            "store_id": s["store_id"],
            "name": s["store_name"],
            "short": s["short"],
            "address": s["address"],
            "kind": s["kind"],
            "nearby": bool(s.get("nearby")),
            "color": s["color"],
            "as_of": as_of,
            "file_time": cov.get("price_file_time") or "",
            "n_items": int(cov.get("price_items") or 0),
            "n_promos": int(cov.get("promo_count") or 0),
        })

    meta = {
        "generated_at": generated,
        "timezone": "Asia/Amman",
        "as_of": max(as_of_dates) if as_of_dates else generated[:10],
        "source": "https://www.over.org.il/api/prices",
        "source_law": "https://www.gov.il/he/pages/cpfta_prices_regulations",
        "attribution": "המחירים לפי קובצי שקיפות המחירים שהרשתות מפרסמות, דרך גרסאות לעם (over.org.il). מחיר מדף; מבצעים מוצגים בנפרד ואינם מקוזזים אוטומטית.",
        "city": "קריית שמונה",
        "n_products": len(out_products),
        "n_tofu": tofu_n,
        "stores": stores_out,
        **category_maps(),
        "category_source": {
            "method": "keyword classifier modeled on the Shufersal / Rami Levy department tree",
            "note": "לקובצי החוק ול-Over אין שדה קטגוריה. הסיווג נעשה לפי מילות מפתח בעברית, בעדיפות לביטויים ספציפיים, עם דריסת 'קפוא' לקטגוריית הקפואים.",
        },
    }

    stats = {
        "generated_at": generated,
        "n_products": len(out_products),
        "n_tofu": tofu_n,
        "by_category": cat_counts,
        "by_subcategory": sub_counts,
        "unmatched_n": cat_counts.get("other", 0),
        "unmatched_share": round(cat_counts.get("other", 0) / max(len(out_products), 1), 4),
        "unmatched_samples": unmatched_samples,
        "rows_fetched": {sk: len(v) for sk, v in prices_by_store.items()},
        "promos_fetched": {sk: len(v) for sk, v in promos_by_store.items()},
        "classifier_examples": "passed",
    }

    products_path = out_dir / "products.json"
    meta_path = out_dir / "meta.json"
    stats_path = out_dir / "stats.json"
    # compact JSON
    products_path.write_text(json.dumps(out_products, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    stats_path.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n==== BUILD DONE ====")
    print(f"products={len(out_products)} tofu={tofu_n} size={products_path.stat().st_size/1024/1024:.2f} MB")
    print(f"unmatched={stats['unmatched_n']} ({stats['unmatched_share']*100:.1f}%)")
    for c in CATEGORIES:
        print(f"  {c['emoji']} {c['name']}: {cat_counts.get(c['id'], 0)}")
    return stats


if __name__ == "__main__":
    build()
