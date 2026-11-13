/* הסל הזול — Kiryat Shmona supermarket price comparison PWA */
(() => {
  "use strict";

  const LS_LIST = "ks-shop-list-v1";
  const LS_SETTINGS = "ks-shop-settings-v1";
  const FINALS = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
  const ILS = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" });
  const PAGE = 40;

  const state = {
    meta: null,
    products: [],
    byCode: new Map(),
    list: [], // {c, qty}
    settings: { pharmacy: false, convenience: false, simplePromos: false },
    q: "",
    cat: "all",
    sub: "all",
    panel: "catalog",
    filtered: [],
    shown: 0,
    ready: false,
  };

  const $ = (id) => document.getElementById(id);
  const els = {};

  function norm(s) {
    return String(s || "")
      .replace(/[ךםןףץ]/g, (ch) => FINALS[ch] || ch)
      .replace(/["'״׳`´]/g, "")
      .replace(/[־–—-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_SETTINGS) || "null");
      if (raw && typeof raw === "object") Object.assign(state.settings, raw);
    } catch { /* keep defaults */ }
  }
  function saveSettings() {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
  }
  function loadList() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_LIST) || "null");
      if (raw && Array.isArray(raw.items)) {
        state.list = raw.items
          .filter((x) => x && x.c && Number(x.qty) > 0)
          .map((x) => ({ c: String(x.c), qty: Number(x.qty) }));
      }
    } catch { state.list = []; }
  }
  function saveList() {
    localStorage.setItem(LS_LIST, JSON.stringify({ items: state.list, updated: Date.now() }));
  }

  function enabledStoreIdx() {
    const stores = state.meta.stores;
    return stores
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => {
        if (s.kind === "supermarket") return true;
        if (s.kind === "pharmacy") return state.settings.pharmacy;
        if (s.kind === "convenience") return state.settings.convenience;
        return false;
      })
      .map(({ i }) => i);
  }

  function listQty(code) {
    const it = state.list.find((x) => x.c === code);
    return it ? it.qty : 0;
  }
  function setQty(code, qty) {
    qty = Math.max(0, Math.round(Number(qty) * 1000) / 1000);
    const i = state.list.findIndex((x) => x.c === code);
    if (qty <= 0) {
      if (i >= 0) state.list.splice(i, 1);
    } else if (i >= 0) {
      state.list[i].qty = qty;
    } else {
      state.list.push({ c: code, qty });
    }
    saveList();
    renderNavCount();
  }

  function fmtPrice(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return ILS.format(n);
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const [y, m, d] = String(iso).slice(0, 10).split("-");
    if (!y || !d) return iso;
    return `${d}.${m}.${y}`;
  }

  function priceRange(p, idxs) {
    const vals = idxs.map((i) => p.p[i]).filter((v) => v != null);
    if (!vals.length) return { min: null, max: null, n: 0 };
    return { min: Math.min(...vals), max: Math.max(...vals), n: vals.length };
  }

  function hasPromo(p, idxs) {
    if (!p.pr) return false;
    return p.pr.some((x) => idxs.includes(x.s));
  }

  function simplePromoUnit(p, storeIdx, qty) {
    if (!state.settings.simplePromos || !p.pr) return null;
    const cands = p.pr.filter(
      (x) =>
        x.s === storeIdx &&
        x.dp != null &&
        !x.club &&
        !x.cpn &&
        (x.mq == null || x.mq <= qty)
    );
    if (!cands.length) return null;
    // Prefer the cheapest effective deal
    let best = null;
    for (const pr of cands) {
      const mq = pr.mq || 1;
      // discounted_price in Over is often the deal total for min_qty (e.g. 2 for 15 => dp=15)
      // Heuristic: if dp < regular * mq * 0.95, treat dp as package price; else as unit price.
      const regular = p.p[storeIdx];
      if (regular == null) continue;
      let unit;
      if (pr.dp < regular * 0.95) {
        unit = pr.dp; // already a unit deal
      } else if (mq > 1 && pr.dp < regular * mq * 0.98) {
        unit = pr.dp / mq;
      } else if (mq > 1) {
        unit = pr.dp / mq;
      } else {
        unit = pr.dp;
      }
      if (!best || unit < best.unit) best = { unit, pr };
    }
    return best;
  }

  function applyFilters() {
    const q = norm(state.q);
    const tokens = q ? q.split(" ").filter(Boolean) : [];
    const idxs = enabledStoreIdx();
    const cat = state.cat;
    const sub = state.sub;
    const out = [];
    for (const p of state.products) {
      if (cat !== "all" && p.k !== cat) continue;
      if (sub !== "all" && p.ks !== sub) continue;
      // Hide items with no price in enabled stores
      let any = false;
      for (const i of idxs) {
        if (p.p[i] != null) { any = true; break; }
      }
      if (!any) continue;
      if (tokens.length) {
        const blob = p._n;
        let ok = true;
        for (const t of tokens) {
          if (!blob.includes(t) && !(p.c && String(p.c).includes(t))) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
      }
      out.push(p);
    }
    state.filtered = out;
  }

  function productCard(p, idxs, opts = {}) {
    const qty = listQty(p.c);
    const pr = priceRange(p, idxs);
    const promo = hasPromo(p, idxs);
    const manu = p.m ? ` · ${esc(p.m)}` : "";
    const size = [p.q && Number(p.q) !== 1 ? prettyQty(p.q) : "", p.u || ""].filter(Boolean).join(" ");
    const weight = p.w ? " · לפי משקל" : "";
    let priceHtml;
    if (pr.n === 0) priceHtml = `<div class="price-range">לא נמצא</div>`;
    else if (pr.min === pr.max) priceHtml = `<div class="price-range">${fmtPrice(pr.min)}</div>`;
    else priceHtml = `<div class="price-range">${fmtPrice(pr.min)}<span class="from">עד ${fmtPrice(pr.max)}</span></div>`;

    const qtyCtl = qty
      ? `<div class="qty" data-c="${esc(p.c)}">
           <button type="button" data-act="-">−</button>
           <span>${qty}</span>
           <button type="button" data-act="+">+</button>
         </div>`
      : `<div class="qty" data-c="${esc(p.c)}"><button class="add" type="button" data-act="+">הוספה</button></div>`;

    let pricesLine = "";
    if (opts.showStores) {
      const bits = idxs.map((i) => {
        const s = state.meta.stores[i];
        const v = p.p[i];
        const cls = v == null ? "miss" : (v === pr.min ? "best" : "");
        return `<span class="${cls}">${esc(s.short)}: ${v == null ? "אין" : fmtPrice(v)}</span>`;
      }).join("");
      pricesLine = `<div class="item-prices">${bits}</div>`;
    }

    return `<article class="product" data-c="${esc(p.c)}">
      <div>
        <div class="name">${esc(p.n)}${promo ? '<span class="badge">מבצע</span>' : ""}${p.w ? '<span class="badge">שקול</span>' : ""}</div>
        <div class="meta">${esc(size)}${manu}${weight}</div>
      </div>
      <div class="side">
        ${priceHtml}
        ${qtyCtl}
      </div>
      ${pricesLine}
    </article>`;
  }

  function prettyQty(q) {
    const n = Number(q);
    if (Number.isNaN(n)) return q;
    return Number.isInteger(n) ? String(n) : String(n);
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderNavCount() {
    const n = state.list.length;
    const el = $("nav-list-count");
    el.textContent = n;
    el.classList.toggle("on", n > 0);
  }

  function renderCats() {
    const cats = state.meta.categories || [];
    const counts = {};
    const idxs = enabledStoreIdx();
    for (const p of state.products) {
      let any = false;
      for (const i of idxs) if (p.p[i] != null) { any = true; break; }
      if (!any) continue;
      counts[p.k] = (counts[p.k] || 0) + 1;
    }
    const allN = Object.values(counts).reduce((a, b) => a + b, 0);
    const bits = [`<button class="chip ${state.cat === "all" ? "active" : ""}" data-cat="all">הכול <span class="n">${allN.toLocaleString("he-IL")}</span></button>`];
    for (const c of cats) {
      if (c.id === "other" && !counts[c.id]) continue;
      const n = counts[c.id] || 0;
      if (!n && c.id === "other") continue;
      bits.push(`<button class="chip ${state.cat === c.id ? "active" : ""}" data-cat="${c.id}">${c.emoji} ${esc(c.name)} <span class="n">${n.toLocaleString("he-IL")}</span></button>`);
    }
    els.cats.innerHTML = bits.join("");
    els.cats.hidden = false;
    renderSubs();
  }

  function renderSubs() {
    const cat = (state.meta.categories || []).find((c) => c.id === state.cat);
    if (!cat || state.cat === "all") {
      els.subs.classList.remove("open");
      els.subs.innerHTML = "";
      return;
    }
    const idxs = enabledStoreIdx();
    const counts = {};
    for (const p of state.products) {
      if (p.k !== state.cat) continue;
      let any = false;
      for (const i of idxs) if (p.p[i] != null) { any = true; break; }
      if (!any) continue;
      counts[p.ks] = (counts[p.ks] || 0) + 1;
    }
    const bits = [`<button class="sub ${state.sub === "all" ? "active" : ""}" data-sub="all">הכול</button>`];
    for (const s of cat.subs) {
      const n = counts[s.id] || 0;
      if (!n) continue;
      bits.push(`<button class="sub ${state.sub === s.id ? "active" : ""}" data-sub="${s.id}">${esc(s.name)} (${n})</button>`);
    }
    els.subs.innerHTML = bits.join("");
    els.subs.classList.add("open");
  }

  function renderCatalog(reset = true) {
    applyFilters();
    const idxs = enabledStoreIdx();
    const total = state.filtered.length;
    $("catalog-count").textContent = total
      ? `${total.toLocaleString("he-IL")} מוצרים`
      : "";
    $("catalog-empty").hidden = total > 0;
    if (reset) {
      els.catalogList.innerHTML = "";
      state.shown = 0;
    }
    const next = state.filtered.slice(state.shown, state.shown + PAGE);
    const html = next.map((p) => productCard(p, idxs, { showStores: !!state.q || state.panel === "list" })).join("");
    els.catalogList.insertAdjacentHTML("beforeend", html);
    state.shown += next.length;
    ensureSentinel();
  }

  let sentinel;
  function ensureSentinel() {
    if (sentinel) sentinel.remove();
    if (state.shown >= state.filtered.length) return;
    sentinel = document.createElement("div");
    sentinel.id = "sentinel";
    sentinel.style.height = "1px";
    els.catalogList.appendChild(sentinel);
    io.observe(sentinel);
  }
  const io = new IntersectionObserver((entries) => {
    if (!state.ready || state.panel !== "catalog") return;
    if (entries.some((e) => e.isIntersecting)) renderCatalog(false);
  }, { rootMargin: "600px" });

  function renderShopList() {
    const idxs = enabledStoreIdx();
    const root = $("shop-list");
    const empty = $("list-empty");
    $("list-count").textContent = state.list.length
      ? `${state.list.length} פריטים ברשימה`
      : "";
    if (!state.list.length) {
      root.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    root.innerHTML = state.list.map((it) => {
      const p = state.byCode.get(it.c);
      if (!p) {
        return `<article class="list-item"><div><div class="name">${esc(it.c)}</div><div class="meta">המוצר לא נמצא בקטלוג הנוכחי</div></div>
          <div class="qty" data-c="${esc(it.c)}"><button type="button" data-act="-">−</button><span>${it.qty}</span><button type="button" data-act="+">+</button></div></article>`;
      }
      return productCard(p, idxs, { showStores: true }).replace("class=\"product\"", "class=\"product list-item\"");
    }).join("");
  }

  function lineCost(p, storeIdx, qty) {
    const regular = p.p[storeIdx];
    if (regular == null) return null;
    const deal = simplePromoUnit(p, storeIdx, qty);
    if (deal) return { cost: deal.unit * qty, regular: regular * qty, promo: deal.pr };
    return { cost: regular * qty, regular: regular * qty, promo: null };
  }

  function compareBaskets() {
    const idxs = enabledStoreIdx();
    const items = state.list.map((it) => ({ ...it, p: state.byCode.get(it.c) })).filter((x) => x.p);
    const commonCodes = items
      .filter((it) => idxs.every((i) => it.p.p[i] != null))
      .map((it) => it.c);

    const rows = idxs.map((i) => {
      const store = state.meta.stores[i];
      let total = 0;
      let commonTotal = 0;
      const found = [];
      const missing = [];
      const promos = [];
      for (const it of items) {
        const lc = lineCost(it.p, i, it.qty);
        if (!lc) missing.push(it);
        else {
          total += lc.cost;
          found.push({ it, lc });
          if (commonCodes.includes(it.c)) commonTotal += lc.cost;
          if (lc.promo) promos.push({ it, lc });
        }
      }
      return { i, store, total, commonTotal, found, missing, promos, allIn: missing.length === 0 && items.length > 0 };
    });

    // Cheapest among stores that have the entire list; otherwise fewest missing, then total
    let winner = null;
    const complete = rows.filter((r) => r.allIn);
    const pool = complete.length ? complete : rows;
    for (const r of pool) {
      if (!items.length) break;
      if (
        !winner ||
        r.missing.length < winner.missing.length ||
        (r.missing.length === winner.missing.length && r.total < winner.total)
      ) {
        winner = r;
      }
    }

    // Split basket: each item from the cheapest enabled store
    const splitGroups = new Map();
    let splitTotal = 0;
    let splitMissing = [];
    for (const it of items) {
      let best = null;
      for (const i of idxs) {
        const lc = lineCost(it.p, i, it.qty);
        if (!lc) continue;
        if (!best || lc.cost < best.lc.cost) best = { i, lc };
      }
      if (!best) splitMissing.push(it);
      else {
        splitTotal += best.lc.cost;
        if (!splitGroups.has(best.i)) splitGroups.set(best.i, { i: best.i, items: [], total: 0 });
        const g = splitGroups.get(best.i);
        g.items.push({ it, lc: best.lc });
        g.total += best.lc.cost;
      }
    }

    return { items, rows, winner, commonCodes, splitTotal, splitGroups, splitMissing };
  }

  function renderCompare() {
    const root = $("compare-root");
    if (!state.list.length) {
      root.innerHTML = `<div class="empty"><h3>אין מה להשוות עדיין</h3><p>הוסיפו מוצרים לרשימה, ואז נחשב איפה הסל הכי זול.</p></div>`;
      return;
    }
    const cmp = compareBaskets();
    const w = cmp.winner;
    let hero;
    if (!w) {
      hero = `<div class="compare-hero"><h2>אין מחירים זמינים</h2><p>לא נמצא אף פריט בסניפים שנבחרו.</p></div>`;
    } else if (w.allIn) {
      hero = `<div class="compare-hero">
        <p>הסל המלא הכי זול ב־</p>
        <h2>${esc(w.store.name)}</h2>
        <div class="sum">${fmtPrice(w.total)}</div>
        <p>${esc(w.store.address)} · נכון ל־${fmtDate(w.store.as_of)}</p>
      </div>`;
    } else {
      hero = `<div class="compare-hero">
        <p>אף סניף לא מחזיק את כל הרשימה. הסל הזול ביותר מבין הפריטים שיש לו הוא</p>
        <h2>${esc(w.store.name)}</h2>
        <div class="sum">${fmtPrice(w.total)}</div>
        <p>חסרים ${w.missing.length} פריטים · נכון ל־${fmtDate(w.store.as_of)}</p>
      </div>`;
    }

    const cards = cmp.rows
      .slice()
      .sort((a, b) => a.missing.length - b.missing.length || a.total - b.total)
      .map((r) => {
        const win = w && r.i === w.i;
        const miss = r.missing.length
          ? `<details class="missing"><summary>חסרים ${r.missing.length} פריטים</summary><ul>${r.missing.map((m) => `<li>${esc(m.p.n)} × ${m.qty}</li>`).join("")}</ul></details>`
          : `<div class="hint">כל הפריטים נמצאו בסניף.</div>`;
        const common = cmp.commonCodes.length
          ? `<span class="pill">משותפים: ${fmtPrice(r.commonTotal)}</span>`
          : "";
        const promoN = r.promos.length
          ? `<span class="pill">מבצעים שחושבו: ${r.promos.length}</span>`
          : "";
        return `<article class="store-card ${win ? "winner" : ""}">
          <div class="head">
            <div>
              <h3>${win ? "🏆 " : ""}${esc(r.store.name)}</h3>
              <div class="addr">${esc(r.store.address)}${r.store.nearby ? " · ליד העיר" : ""} · ${fmtDate(r.store.as_of)}</div>
            </div>
            <div class="total">${fmtPrice(r.total)}</div>
          </div>
          <div class="stats">
            <span class="pill">${r.found.length} מתוך ${cmp.items.length} פריטים</span>
            ${common}
            ${promoN}
          </div>
          ${miss}
        </article>`;
      })
      .join("");

    const groups = [...cmp.splitGroups.values()].sort((a, b) => b.total - a.total);
    const splitHtml = `
      <div class="split">
        <h3>פיצול הסל — השילוב הזול ביותר</h3>
        <p class="hint">כל פריט נלקח מהסניף שבו הוא הכי זול (מבין הסניפים שסומנו). ${cmp.splitMissing.length ? `לא נמצאו ${cmp.splitMissing.length} פריטים באף סניף.` : ""}</p>
        <div class="total" style="font-size:1.4rem;font-weight:800;margin:6px 0">${fmtPrice(cmp.splitTotal)}</div>
        ${groups.map((g) => {
          const s = state.meta.stores[g.i];
          return `<p><strong>${esc(s.name)}</strong> — ${fmtPrice(g.total)} (${g.items.length} פריטים)</p>
            <ul>${g.items.map((x) => `<li>${esc(x.it.p.n)} × ${x.it.qty} · ${fmtPrice(x.lc.cost)}</li>`).join("")}</ul>`;
        }).join("")}
      </div>`;

    // Per-item cheapest table
    const idxs = enabledStoreIdx();
    const itemRows = cmp.items.map((it) => {
      const vals = idxs.map((i) => {
        const lc = lineCost(it.p, i, it.qty);
        return { i, lc };
      });
      const present = vals.filter((v) => v.lc);
      const min = present.length ? Math.min(...present.map((v) => v.lc.cost)) : null;
      const cells = vals.map((v) => {
        if (!v.lc) return `<span class="miss">${esc(state.meta.stores[v.i].short)}: אין</span>`;
        const cls = v.lc.cost === min ? "best" : "";
        return `<span class="${cls}">${esc(state.meta.stores[v.i].short)}: ${fmtPrice(v.lc.cost)}</span>`;
      }).join("");
      return `<article class="product">
        <div>
          <div class="name">${esc(it.p.n)} × ${it.qty}</div>
          <div class="meta">${min != null ? "הכי זול: " + fmtPrice(min) : "לא נמצא באף סניף"}</div>
        </div>
        <div class="item-prices" style="grid-column:1/-1">${cells}</div>
      </article>`;
    }).join("");

    root.innerHTML = `${hero}<div class="compare-grid">${cards}</div>${splitHtml}
      <h3 style="margin-top:18px">מחיר לפי פריט</h3>
      <div class="list">${itemRows}</div>
      <p class="hint">המחירים הם מחירי מדף כפי שפורסמו בקובץ השקיפות. מבצעי מועדון, קופון או תנאי מיוחד מסומנים במוצר ואינם מקוזזים אוטומטית, אלא אם הפעלתם «חשב מבצעים פשוטים».</p>`;
  }

  function renderAll() {
    renderNavCount();
    if (state.panel === "catalog") {
      renderCats();
      renderCatalog(true);
    } else if (state.panel === "list") {
      renderShopList();
    } else if (state.panel === "compare") {
      renderCompare();
    }
  }

  function showPanel(name) {
    state.panel = name;
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
    document.querySelectorAll(".bottom-nav button").forEach((b) => b.classList.toggle("active", b.dataset.go === name));
    const showSearch = name === "catalog";
    $("search-wrap").style.display = showSearch ? "" : "none";
    els.cats.hidden = !showSearch;
    if (!showSearch) els.subs.classList.remove("open");
    if (name === "catalog") {
      els.cats.hidden = false;
      renderCats();
      renderCatalog(true);
    } else if (name === "list") renderShopList();
    else if (name === "compare") renderCompare();
    window.scrollTo(0, 0);
  }

  function bind() {
    els.cats = $("cats");
    els.subs = $("subs");
    els.catalogList = $("catalog-list");

    $("q").addEventListener("input", (e) => {
      state.q = e.target.value;
      $("search-wrap").classList.toggle("has-q", !!state.q);
      if (state.panel !== "catalog") showPanel("catalog");
      else renderCatalog(true);
    });
    $("q-clear").addEventListener("click", () => {
      $("q").value = "";
      state.q = "";
      $("search-wrap").classList.remove("has-q");
      renderCatalog(true);
      $("q").focus();
    });

    els.cats.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cat]");
      if (!btn) return;
      state.cat = btn.dataset.cat;
      state.sub = "all";
      renderCats();
      renderCatalog(true);
    });
    els.subs.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-sub]");
      if (!btn) return;
      state.sub = btn.dataset.sub;
      renderSubs();
      renderCatalog(true);
    });

    document.body.addEventListener("click", (e) => {
      const btn = e.target.closest(".qty [data-act]");
      if (!btn) return;
      const wrap = btn.closest("[data-c]");
      const code = wrap && wrap.dataset.c;
      if (!code) return;
      const cur = listQty(code);
      const act = btn.dataset.act;
      const p = state.byCode.get(code);
      const step = p && p.w ? 0.5 : 1;
      setQty(code, act === "+" ? cur + step : cur - step);
      if (state.panel === "catalog") {
        // refresh just this card
        const card = wrap.closest("article");
        if (card) {
          const idxs = enabledStoreIdx();
          const prod = state.byCode.get(code);
          if (prod) card.outerHTML = productCard(prod, idxs, { showStores: !!state.q });
        }
        renderNavCount();
      } else if (state.panel === "list") renderShopList();
      else if (state.panel === "compare") renderCompare();
    });

    $("clear-list").addEventListener("click", () => {
      if (!state.list.length) return;
      if (confirm("לפנות את כל רשימת הקניות?")) {
        state.list = [];
        saveList();
        renderAll();
      }
    });

    document.querySelectorAll(".bottom-nav button").forEach((b) => {
      b.addEventListener("click", () => showPanel(b.dataset.go));
    });

    $("tog-pharm").checked = state.settings.pharmacy;
    $("tog-conv").checked = state.settings.convenience;
    $("tog-promo").checked = state.settings.simplePromos;
    const saveTog = () => {
      state.settings.pharmacy = $("tog-pharm").checked;
      state.settings.convenience = $("tog-conv").checked;
      state.settings.simplePromos = $("tog-promo").checked;
      saveSettings();
      renderAll();
    };
    $("tog-pharm").addEventListener("change", saveTog);
    $("tog-conv").addEventListener("change", saveTog);
    $("tog-promo").addEventListener("change", saveTog);

    // Install prompt
    let deferred;
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferred = e;
      $("install-btn").classList.add("show");
    });
    $("install-btn").addEventListener("click", async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      $("install-btn").classList.remove("show");
    });
  }

  async function fetchJson(url, onProgress) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`שגיאה בטעינת ${url}: ${res.status}`);
    if (!onProgress || !res.body || !res.headers.get("content-length")) {
      return res.json();
    }
    const total = Number(res.headers.get("content-length"));
    const reader = res.body.getReader();
    const chunks = [];
    let rec = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      rec += value.byteLength;
      onProgress(rec / total);
    }
    const blob = new Uint8Array(rec);
    let off = 0;
    for (const c of chunks) { blob.set(c, off); off += c.byteLength; }
    const text = new TextDecoder("utf-8").decode(blob);
    return JSON.parse(text);
  }

  function prepareProducts(products) {
    for (const p of products) {
      p._n = norm(`${p.n} ${p.m || ""}`);
      state.byCode.set(p.c, p);
    }
    state.products = products;
  }

  function fillAbout() {
    const m = state.meta;
    $("as-of").textContent = `נכון ל־${fmtDate(m.as_of)}`;
    $("about-source").innerHTML =
      `${esc(m.attribution || "")} עודכן ב־${esc(fmtDate(m.generated_at))} (${esc(m.timezone || "")}). ` +
      `בקטלוג ${Number(m.n_products).toLocaleString("he-IL")} מוצרים מ־${m.stores.length} סניפים. ` +
      `<a href="${esc(m.source)}" target="_blank" rel="noopener">Over.org.il</a>.`;
  }

  async function boot() {
    loadSettings();
    loadList();
    bind();
    const bar = $("boot-bar");
    const msg = $("boot-msg");
    try {
      msg.textContent = "טוען נתוני סניפים…";
      const meta = await fetchJson("data/meta.json");
      state.meta = meta;
      bar.style.width = "15%";
      msg.textContent = "טוען את הקטלוג המלא…";
      const products = await fetchJson("data/products.json", (p) => {
        bar.style.width = `${15 + Math.round(p * 80)}%`;
      });
      bar.style.width = "96%";
      msg.textContent = "מכין חיפוש וקטגוריות…";
      prepareProducts(products);
      fillAbout();
      // Drop list items that are gone? Keep them (shown as missing).
      state.ready = true;
      $("boot").style.display = "none";
      $("app").classList.add("ready");
      renderAll();
    } catch (err) {
      console.error(err);
      msg.textContent = "לא הצלחתי לטעון את הקטלוג. בדקו את החיבור ונסו לרענן. " + (err && err.message ? err.message : "");
    }

    if ("serviceWorker" in navigator) {
      try {
        const swUrl = new URL("sw.js", window.location.href);
        const scope = new URL("./", window.location.href).pathname;
        await navigator.serviceWorker.register(swUrl, { scope });
      } catch (e) { console.warn(e); }
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
