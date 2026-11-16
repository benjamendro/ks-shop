/* הסל הזול — Kiryat Shmona supermarket price comparison PWA */
(() => {
  "use strict";

  const LS_LIST = "ks-shop-list-v1";
  const LS_SETTINGS = "ks-shop-settings-v1";
  const LS_RECENTS = "ks-shop-recents-v1";
  const LS_GFREQ = "ks-shop-gfreq-v1";
  const G = window.KSGeneric;
  const STAPLES = ["חלב 3%", "לחם", "ביצים L 12", "גבינה לבנה", "קוטג׳", "עגבניות", "מלפפונים", "בצל", "תפוחי אדמה", "בננות", "אורז", "פסטה", "שמן קנולה", "סוכר", "קפה נמס", "חזה עוף", "טונה", "יוגורט", "נייר טואלט", "טחינה"];
  const FINALS = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
  const ILS = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" });
  const PAGE = 40;
  const PANELS = ["catalog", "list", "baskets", "compare", "more"];
  const UNIT_MAP = {
    "גרם": ["kg", 0.001, "לק״ג"],
    "גרמים": ["kg", 0.001, "לק״ג"],
    "קילוגרם": ["kg", 1, "לק״ג"],
    "מיליליטר": ["l", 0.001, "לליטר"],
    "מ\"ל": ["l", 0.001, "לליטר"],
    "ליטר": ["l", 1, "לליטר"],
    "ליטרים": ["l", 1, "לליטר"],
  };

  const state = {
    meta: null,
    products: [],
    byId: new Map(),
    list: [], // {c, qty} — c is the unique product id
    settings: { pharmacy: false, convenience: false, simplePromos: false, sort: "relevance" },
    q: "",
    cat: "all",
    sub: "all",
    brand: "all",
    sort: "relevance",
    panel: "catalog",
    filtered: [],
    brandOptions: [],
    shown: 0,
    ready: false,
    recents: [],
    suggestItems: [],
    suggestIdx: -1,
    baskets: null,
    gindex: null,
    gfreq: {},
    smartIdx: -1,
    smartItems: [],
    importRows: [],
  };

  const $ = (id) => document.getElementById(id);
  const els = {};
  let toastTimer = 0;
  let lastAction = null;
  let searchTimer = 0;
  let suggestTimer = 0;
  let suggestCloseTimer = 0;

  function norm(s) {
    return String(s || "")
      .replace(/[ךםןףץ]/g, (ch) => FINALS[ch] || ch)
      .replace(/["'״׳`´]/g, "")
      .replace(/[־–—-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_SETTINGS) || "null");
      if (raw && typeof raw === "object") Object.assign(state.settings, raw);
      if (state.settings.sort) state.sort = state.settings.sort;
    } catch { /* keep defaults */ }
  }
  function saveSettings() {
    state.settings.sort = state.sort;
    localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
  }
  function loadList() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_LIST) || "null");
      if (raw && Array.isArray(raw.items)) {
        state.list = raw.items
          .filter((x) => x && x.c && Number(x.qty) > 0)
          .map((x) => {
            const e = { c: String(x.c), qty: Number(x.qty) };
            if (x.g) {
              e.g = String(x.g);
              e.pref = x.pref && typeof x.pref === "object" ? x.pref : {};
              e.ex = Array.isArray(x.ex) ? x.ex.map(String) : [];
              e.lock = x.lock ? String(x.lock) : null;
            }
            return e;
          });
      } else if (Array.isArray(raw)) {
        // older accidental formats
        state.list = raw
          .filter((x) => x && x.c && Number(x.qty) > 0)
          .map((x) => ({ c: String(x.c), qty: Number(x.qty) }));
      }
    } catch { state.list = []; }
  }
  function saveList() {
    localStorage.setItem(LS_LIST, JSON.stringify({ items: state.list, updated: Date.now() }));
  }
  function loadRecents() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_RECENTS) || "null");
      if (Array.isArray(raw)) state.recents = raw.map(String).slice(0, 12);
    } catch { state.recents = []; }
  }
  function pushRecent(id) {
    if (!id) return;
    state.recents = [id, ...state.recents.filter((x) => x !== id)].slice(0, 12);
    localStorage.setItem(LS_RECENTS, JSON.stringify(state.recents));
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

  function listQty(id) {
    const it = state.list.find((x) => x.c === id);
    return it ? it.qty : 0;
  }

  function setQty(id, qty, { toast = false, silent = false } = {}) {
    qty = Math.max(0, Math.round(Number(qty) * 1000) / 1000);
    const i = state.list.findIndex((x) => x.c === id);
    const prev = i >= 0 ? state.list[i].qty : 0;
    const prevEntry = i >= 0 ? JSON.parse(JSON.stringify(state.list[i])) : null;
    if (qty <= 0) {
      if (i >= 0) state.list.splice(i, 1);
    } else if (i >= 0) {
      state.list[i].qty = qty;
    } else {
      state.list.push({ c: id, qty });
    }
    saveList();
    if (qty > 0 && !String(id).startsWith("g:")) pushRecent(id);
    if (!silent) {
      renderChrome();
      if (toast && qty !== prev) {
        const p = state.byId.get(id);
        const name = prevEntry && prevEntry.g ? prevEntry.g : (p ? p.n : id);
        if (prev === 0 && qty > 0) {
          lastAction = { type: "add", id, prev, qty };
          showToast(`${name} נוסף לרשימה`, true);
        } else if (qty === 0 && prev > 0) {
          lastAction = { type: "remove", id, prev, qty, entry: prevEntry, index: i };
          showToast(`${name} הוסר מהרשימה`, true);
        }
      }
    }
    return { prev, qty };
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
  function prettyQty(q) {
    const n = Number(q);
    if (Number.isNaN(n)) return q;
    return Number.isInteger(n) ? String(n) : String(n);
  }
  function cleanManu(m) {
    const s = String(m || "").trim();
    if (!s || /^[-–—._*\s]+$/.test(s)) return "";
    return s;
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

  function attachUnit(p) {
    if (p.w) {
      p._unit = { dim: "kg", qty: 1, label: "לק״ג" };
      return;
    }
    const q = Number(p.q);
    const u = String(p.u || "").trim();
    const m = UNIT_MAP[u];
    if (!q || q <= 0 || !m) {
      p._unit = null;
      return;
    }
    p._unit = { dim: m[0], qty: q * m[1], label: m[2] };
  }

  function unitPrice(p, price) {
    if (!p._unit || price == null || p._unit.qty <= 0) return null;
    return price / p._unit.qty;
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
    let best = null;
    for (const pr of cands) {
      const mq = pr.mq || 1;
      const regular = p.p[storeIdx];
      if (regular == null) continue;
      let unit;
      if (pr.dp < regular * 0.95) {
        unit = pr.dp;
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

  function lineCost(p, storeIdx, qty) {
    const regular = p.p[storeIdx];
    if (regular == null) return null;
    const deal = simplePromoUnit(p, storeIdx, qty);
    if (deal) return { cost: deal.unit * qty, regular: regular * qty, promo: deal.pr };
    return { cost: regular * qty, regular: regular * qty, promo: null };
  }

  function estimateCheapest() {
    const idxs = enabledStoreIdx();
    let total = 0;
    let priced = 0;
    let missing = 0;
    let units = 0;
    for (const it of state.list) {
      units += it.qty;
      let min = null;
      for (const i of idxs) {
        const lc = entryCost(it, i);
        if (lc && (min == null || lc.cost < min)) min = lc.cost;
      }
      if (min == null) { missing++; continue; }
      total += min;
      priced++;
    }
    return { total, priced, missing, units, n: state.list.length };
  }


  // ---------- Generic items (default mode): "חלב 3%" → best-value product per store ----------
  function isGen(it) { return !!(it && it.g); }
  function genRes(it) {
    if (!state.gindex || !isGen(it)) return null;
    return G.resolve(state.gindex, { t: it.g, pref: it.pref || {}, ex: it.ex || [], lock: it.lock || null }, { nStores: NS() });
  }
  function entryName(it) {
    if (isGen(it)) return it.g;
    const p = it.p || state.byId.get(it.c);
    return p ? p.n : it.c;
  }
  function entryCost(it, i) {
    if (isGen(it)) {
      const res = genRes(it);
      if (!res) return null;
      const pk = G.pick(res, i);
      if (!pk) return null;
      const lc = lineCost(pk.p, i, it.qty);
      return lc ? Object.assign({}, lc, { p: pk.p, pick: pk, res }) : null;
    }
    const p = it.p || state.byId.get(it.c);
    if (!p) return null;
    const lc = lineCost(p, i, it.qty);
    return lc ? Object.assign({}, lc, { p }) : null;
  }
  function genKey(text, pref) {
    return "g:" + G.norm(text) + (pref && Object.keys(pref).length ? ":" + JSON.stringify(pref) : "");
  }
  function loadGfreq() {
    try { state.gfreq = JSON.parse(localStorage.getItem(LS_GFREQ) || "{}") || {}; } catch { state.gfreq = {}; }
  }
  function bumpGfreq(text) {
    const k = G.norm(text);
    const e = state.gfreq[k] || { t: text, n: 0, last: 0 };
    e.t = text; e.n += 1; e.last = Date.now();
    state.gfreq[k] = e;
    const keys = Object.keys(state.gfreq);
    if (keys.length > 80) {
      keys.sort((a, b) => state.gfreq[a].last - state.gfreq[b].last).slice(0, keys.length - 80).forEach((x) => delete state.gfreq[x]);
    }
    try { localStorage.setItem(LS_GFREQ, JSON.stringify(state.gfreq)); } catch {}
  }
  function frequentItems(limit) {
    return Object.values(state.gfreq)
      .sort((a, b) => (b.n - a.n) || (b.last - a.last))
      .slice(0, limit || 10)
      .map((e) => e.t);
  }
  function lineSpec(raw) {
    const spec = G.parseItem(raw);
    const probe = G.resolve(state.gindex, { t: raw }, { nStores: NS() });
    const label = G.cleanLabel(raw, { dropWeight: probe.weighed });
    let qty = probe.weighed ? (probe.qtyGiven ? probe.qty : (spec.qty || 1)) : (spec.qty || 1);
    return { label, qty, weighed: probe.weighed };
  }
  // Add a typed need. Returns the list entry.
  function addGeneric(text, { qty = null, pref = null, silent = false } = {}) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    const ls = lineSpec(raw);
    const label = ls.label;
    const res = G.resolve(state.gindex, { t: label, pref: pref || {} }, { nStores: NS() });
    let q = qty != null ? qty : ls.qty;
    q = Math.max(res.weighed ? 0.5 : 1, Math.round(q * 1000) / 1000);
    const c = genKey(label, pref);
    const i = state.list.findIndex((x) => x.c === c);
    const prev = i >= 0 ? state.list[i].qty : 0;
    if (i >= 0) state.list[i].qty = Math.round((prev + q) * 1000) / 1000;
    else state.list.push({ c, g: label, qty: q, pref: pref || {}, ex: [], lock: null });
    saveList();
    bumpGfreq(label);
    if (!silent) {
      lastAction = { type: "add-generic", id: c, prev };
      const found = res.confidence !== "none";
      showToast(found ? `נוסף: ${label}${q !== 1 ? ` × ${q}` : ""}` : `נוסף «${label}» — לא נמצא מוצר מתאים, אפשר לערוך`, true);
    }
    return state.list.find((x) => x.c === c);
  }
  function genSummary(res) {
    const idxs = enabledStoreIdx();
    let best = null;
    for (const i of idxs) {
      const pk = G.pick(res, i);
      if (pk && (!best || pk.price < best.price)) best = Object.assign({ i }, pk);
    }
    const stores = idxs.filter((i) => G.pick(res, i)).length;
    return { best, stores, n: res.cands.length, total: idxs.length };
  }
  function previewHtml(res) {
    if (!res || res.confidence === "none") return `<span class="sg-miss">לא נמצא בסניפים בעיר</span>`;
    const s = genSummary(res);
    if (!s.best) return `<span class="sg-miss">לא נמצא בסניפים שנבחרו</span>`;
    return `${s.n} מוצרים מתאימים · ב־${s.stores}/${s.total} סניפים · הכי זול ${fmtPrice(s.best.price)} ב${esc(state.meta.stores[s.best.i].short)}`;
  }
  function NS() { return state.meta && state.meta.stores ? state.meta.stores.length : 6; }

  function relevanceScore(p, tokens, rawQ, isBarcode) {
    let s = 0;
    const name = p._n;
    const code = String(p.c || "");
    if (isBarcode) {
      if (code === rawQ) return 10000;
      if (code.startsWith(rawQ) || code.includes(rawQ)) return 8000 - Math.min(code.length, 100);
    } else if (rawQ && code.includes(rawQ) && /^\d{6,}$/.test(rawQ)) {
      s += 2000;
    }
    if (!tokens.length) return s;
    if (name === tokens.join(" ")) s += 900;
    else if (name.startsWith(tokens[0])) s += 240;
    let inName = 0;
    for (const t of tokens) {
      if (p._nameOnly.includes(t)) { s += 80; inName++; }
      else if (p._manu.includes(t)) s += 30;
      else if (name.includes(t)) s += 50;
    }
    if (inName === tokens.length) s += 120;
    s += Math.max(0, 40 - Math.min(name.length, 40)) * 0.2;
    return s;
  }

  function isHomeView() {
    return state.panel === "catalog" && !state.q.trim() && state.cat === "all";
  }

  function applyFilters() {
    const raw = state.q.trim();
    const q = norm(raw);
    const tokens = q ? q.split(" ").filter(Boolean) : [];
    const isBarcode = /^\d{8,}$/.test(raw);
    const idxs = enabledStoreIdx();
    const cat = state.cat;
    const sub = state.sub;
    const beforeBrand = [];

    for (const p of state.products) {
      if (cat !== "all" && p.k !== cat) continue;
      if (sub !== "all" && p.ks !== sub) continue;
      let any = false;
      for (const i of idxs) {
        if (p.p[i] != null) { any = true; break; }
      }
      if (!any) continue;
      if (tokens.length) {
        let ok = true;
        for (const t of tokens) {
          if (!p._n.includes(t) && !String(p.c).includes(t) && !(isBarcode && String(p.c).includes(raw))) {
            ok = false;
            break;
          }
        }
        if (!ok && isBarcode && String(p.c).includes(raw)) ok = true;
        if (!ok) continue;
        p._score = relevanceScore(p, tokens, raw, isBarcode);
      } else {
        p._score = 0;
      }
      beforeBrand.push(p);
    }

    const brandCounts = new Map();
    for (const p of beforeBrand) {
      const b = (p.m || "").trim() || "ללא יצרן";
      brandCounts.set(b, (brandCounts.get(b) || 0) + 1);
    }
    state.brandOptions = [...brandCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "he"))
      .slice(0, 18);

    let out = beforeBrand;
    if (state.brand !== "all") {
      out = beforeBrand.filter((p) => ((p.m || "").trim() || "ללא יצרן") === state.brand);
    }

    const mode = state.sort;
    out.sort((a, b) => {
      if (mode === "price-asc" || mode === "price-desc") {
        const va = priceRange(a, idxs).min;
        const vb = priceRange(b, idxs).min;
        const da = va == null ? Infinity : va;
        const db = vb == null ? Infinity : vb;
        return mode === "price-asc" ? da - db : db - da;
      }
      if (mode === "unit") {
        const va = unitPrice(a, priceRange(a, idxs).min);
        const vb = unitPrice(b, priceRange(b, idxs).min);
        const da = va == null ? Infinity : va;
        const db = vb == null ? Infinity : vb;
        return da - db;
      }
      if (mode === "name") return a.n.localeCompare(b.n, "he");
      // relevance
      if (tokens.length) return (b._score || 0) - (a._score || 0) || a.n.localeCompare(b.n, "he");
      return a.n.localeCompare(b.n, "he");
    });

    state.filtered = out;
  }

  function qtyCtl(p, qty, { removable = false } = {}) {
    const stepLabel = p && p.w ? "ק״ג" : "";
    if (qty) {
      return `<div class="qty" data-c="${esc(p ? p._id : "")}">
        <button type="button" data-act="-" aria-label="הפחתה">−</button>
        <span>${qty}${stepLabel ? `<small> ${stepLabel}</small>` : ""}</span>
        <button type="button" data-act="+" aria-label="הוספה">+</button>
        ${removable ? `<button type="button" class="remove" data-act="x" aria-label="הסרה">×</button>` : ""}
      </div>`;
    }
    return `<div class="qty" data-c="${esc(p ? p._id : "")}"><button class="add" type="button" data-act="+">הוספה</button></div>`;
  }

  function storePricePills(p, idxs, pr) {
    const bits = idxs.map((i) => {
      const s = state.meta.stores[i];
      const v = p.p[i];
      const cls = v == null ? "miss" : (v === pr.min ? "best" : "");
      return `<span class="${cls}">${esc(s.short)}: ${v == null ? "אין" : fmtPrice(v)}</span>`;
    }).join("");
    const missing = idxs.filter((i) => p.p[i] == null);
    const missLine = missing.length
      ? `<div class="missing-line">לא נמצא ב־${missing.map((i) => state.meta.stores[i].short).join(", ")}</div>`
      : "";
    return `<div class="item-prices">${bits}</div>${missLine}`;
  }

  function productCard(p, idxs, opts = {}) {
    const id = p._id;
    const qty = listQty(id);
    const pr = priceRange(p, idxs);
    const promo = hasPromo(p, idxs);
    const size = [p.q && Number(p.q) !== 1 ? prettyQty(p.q) : "", p.u || ""].filter(Boolean).join(" ");
    const manu = p.m ? `<span class="brand-name">${esc(p.m)}</span>` : "";
    const weight = p.w ? " · לפי משקל" : "";
    const up = pr.min != null ? unitPrice(p, pr.min) : null;
    let priceHtml;
    if (pr.n === 0) priceHtml = `<div class="price-range">לא נמצא</div>`;
    else if (pr.min === pr.max) priceHtml = `<div class="price-range">${fmtPrice(pr.min)}</div>`;
    else priceHtml = `<div class="price-range">${fmtPrice(pr.min)}<span class="from">עד ${fmtPrice(pr.max)}</span></div>`;
    if (up != null && p._unit) {
      priceHtml = priceHtml.replace(
        "</div>",
        `<span class="unit">${fmtPrice(up)} ${p._unit.label}</span></div>`
      );
    }

    const showStores = opts.showStores !== false;
    return `<article class="product${opts.listItem ? " list-item" : ""}" data-c="${esc(id)}">
      <div>
        <div class="name">${esc(p.n)}${promo ? '<span class="badge">מבצע</span>' : ""}${p.w ? '<span class="badge">שקול</span>' : ""}</div>
        <div class="meta">${manu}${manu && size ? " · " : ""}${esc(size)}${weight}</div>
      </div>
      <div class="side">
        ${priceHtml}
        ${qtyCtl(p, qty, { removable: !!opts.listItem })}
      </div>
      ${showStores ? storePricePills(p, idxs, pr) : ""}
    </article>`;
  }

  function renderChrome() {
    const n = state.list.length;
    document.querySelectorAll(".nav-list-count").forEach((el) => {
      el.textContent = n;
      el.classList.toggle("on", n > 0);
    });
    const est = estimateCheapest();
    const fab = $("fab-cart");
    const showFab = state.ready && n > 0 && state.panel === "catalog";
    fab.hidden = !showFab;
    document.body.classList.toggle("has-fab", showFab);
    $("fab-count").textContent = n;
    $("fab-total").textContent = est.priced ? `החל מ־${fmtPrice(est.total)}` : "";
  }

  function showToast(msg, undo) {
    const el = $("toast");
    el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" id="toast-undo">ביטול</button>' : ""}`;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
    const btn = $("toast-undo");
    if (btn) {
      btn.addEventListener("click", () => {
        if (!lastAction) return;
        if (lastAction.type === "replace-list") {
          state.list = lastAction.prev;
          saveList();
        } else if (lastAction.type === "remove" && lastAction.entry) {
          state.list.splice(Math.min(lastAction.index, state.list.length), 0, lastAction.entry);
          saveList();
        } else if (lastAction.type === "add-generic") {
          const j = state.list.findIndex((x) => x.c === lastAction.id);
          if (j >= 0) {
            if (lastAction.prev > 0) state.list[j].qty = lastAction.prev;
            else state.list.splice(j, 1);
          }
          saveList();
        } else {
          setQty(lastAction.id, lastAction.prev, { silent: true });
        }
        lastAction = null;
        el.hidden = true;
        refreshVisible();
      });
    }
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
      const n = counts[c.id] || 0;
      if (!n) continue;
      bits.push(`<button class="chip ${state.cat === c.id ? "active" : ""}" data-cat="${c.id}">${c.emoji} ${esc(c.name)} <span class="n">${n.toLocaleString("he-IL")}</span></button>`);
    }
    els.cats.innerHTML = bits.join("");

    const grid = $("cat-grid");
    const home = isHomeView();
    grid.hidden = !home || state.panel !== "catalog";
    if (home && state.panel === "catalog") {
      grid.innerHTML = cats
        .filter((c) => counts[c.id])
        .map((c) => `<button type="button" class="cat-tile" data-cat="${c.id}">
            <span class="emoji">${c.emoji}</span>${esc(c.name)}
            <span class="n">${(counts[c.id] || 0).toLocaleString("he-IL")} מוצרים</span>
          </button>`)
        .join("");
    }
    renderSubs();
  }

  function renderSubs() {
    const cat = (state.meta.categories || []).find((c) => c.id === state.cat);
    if (!cat || state.cat === "all") {
      els.subs.classList.remove("open");
      els.subs.innerHTML = "";
      els.subs.hidden = true;
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
    els.subs.hidden = false;
    els.subs.classList.add("open");
  }

  function renderBrands() {
    const el = $("brands");
    if (isHomeView() || state.brandOptions.length < 2) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    const bits = [`<button type="button" class="brand-chip ${state.brand === "all" ? "active" : ""}" data-brand="all">כל היצרנים</button>`];
    for (const [name, n] of state.brandOptions) {
      bits.push(`<button type="button" class="brand-chip ${state.brand === name ? "active" : ""}" data-brand="${esc(name)}">${esc(name)} <span class="n">${n}</span></button>`);
    }
    el.innerHTML = bits.join("");
    el.hidden = false;
  }

  function renderRecents() {
    const el = $("recents");
    if (!isHomeView() || !state.recents.length) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    const items = state.recents
      .map((id) => state.byId.get(id))
      .filter(Boolean)
      .slice(0, 10);
    if (!items.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = `<h3>נבחרו לאחרונה</h3><div class="recents-row">${items
      .map((p) => `<button type="button" class="recent-chip" data-recent="${esc(p._id)}">${esc(p.n)}</button>`)
      .join("")}</div>`;
  }

  function renderCatalog(reset = true) {
    const home = isHomeView();
    const metaLine = document.querySelector("#panel-catalog .meta-line");
    if (metaLine) metaLine.hidden = home;
    $("catalog-list").hidden = home;
    $("catalog-empty").hidden = true;
    if (home) {
      els.catalogList.innerHTML = "";
      state.shown = 0;
      $("catalog-count").textContent = "";
      renderBrands();
      return;
    }

    applyFilters();
    renderBrands();
    const idxs = enabledStoreIdx();
    const total = state.filtered.length;
    const banner = $("gen-banner");
    if (banner) {
      const q = (state.q || "").trim();
      if (q && state.gindex && !/^\d{5,}$/.test(q)) {
        const lbl = G.cleanLabel(q);
        const res = G.resolve(state.gindex, { t: lbl }, { nStores: NS() });
        banner.hidden = res.confidence === "none";
        banner.innerHTML = `<button type="button" class="gen-add-btn" data-add-generic="${esc(q)}"><strong>+ הוספת «${esc(lbl)}» כפריט כללי</strong><span>${previewHtml(res)} · בלי להתחייב למותג, נבחר הזול בכל סופר</span></button>`;
      } else banner.hidden = true;
    }
    $("catalog-count").textContent = total
      ? `${total.toLocaleString("he-IL")} מוצרים`
      : "";
    $("catalog-empty").hidden = total > 0;
    if (reset) {
      els.catalogList.innerHTML = "";
      state.shown = 0;
    }
    const next = state.filtered.slice(state.shown, state.shown + PAGE);
    const groupByBrand = state.sort === "relevance" || state.sort === "name";
    let html = "";
    let lastBrand = reset || state.shown === 0 ? null : "\0";
    // When appending, don't repeat the heading logic across pages awkwardly:
    // only emit a heading when the brand changes within this chunk, and if
    // grouping is on. For the first item of a non-reset page, skip a heading
    // if it would duplicate the last rendered brand.
    if (!reset && groupByBrand && next.length) {
      const prev = state.filtered[state.shown - 1];
      lastBrand = prev ? ((prev.m || "").trim() || "ללא יצרן") : null;
    }
    for (const p of next) {
      if (groupByBrand) {
        const b = (p.m || "").trim() || "ללא יצרן";
        if (b !== lastBrand) {
          html += `<h3 class="group-h">${esc(b)}</h3>`;
          lastBrand = b;
        }
      }
      html += productCard(p, idxs, { showStores: true });
    }
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
    if (isHomeView()) return;
    if (entries.some((e) => e.isIntersecting)) renderCatalog(false);
  }, { rootMargin: "600px" });

  function renderShopList() {
    const idxs = enabledStoreIdx();
    const root = $("shop-list");
    const empty = $("list-empty");
    const est = estimateCheapest();
    const hero = $("list-hero");
    const cta = $("cta-compare");
    if (!state.list.length) {
      root.innerHTML = "";
      empty.hidden = false;
      hero.hidden = true;
      cta.hidden = true;
      return;
    }
    empty.hidden = true;
    hero.hidden = false;
    cta.hidden = false;
    cta.disabled = false;
    $("list-count").textContent = `${est.n} פריטים` + (est.units !== est.n ? ` · ${est.units} יח׳` : "");
    $("list-total").textContent = est.priced
      ? `הכי זול משוער: ${fmtPrice(est.total)}${est.missing ? ` · ${est.missing} בלי מחיר` : ""} · מחיר בכל חנות בעמוד ההשוואה`
      : "אין מחיר זמין לפריטים שנבחרו";
    root.innerHTML = state.list.map((it) => {
      if (isGen(it)) return genericCard(it, idxs);
      const p = state.byId.get(it.c);
      if (!p) {
        return `<article class="product list-item">
          <div><div class="name">${esc(it.c)}</div><div class="meta">המוצר לא נמצא בקטלוג הנוכחי</div></div>
          ${qtyCtl({ _id: it.c, w: 0 }, it.qty, { removable: true })}
        </article>`;
      }
      return productCard(p, idxs, { showStores: true, listItem: true });
    }).join("");
  }

  function sizeText(p) {
    if (p.w) return "לפי משקל";
    return [p.q && Number(p.q) !== 1 ? prettyQty(p.q) : "", p.u || ""].filter(Boolean).join(" ");
  }

  function genericCard(it, idxs) {
    const res = genRes(it);
    const pref = it.pref || {};
    const conf = res ? res.confidence : "none";
    const s = res ? genSummary(res) : { best: null, stores: 0, total: idxs.length, n: 0 };
    const weighed = !!(res && res.weighed);
    const qtyHtml = qtyCtl({ _id: it.c, w: weighed ? 1 : 0 }, it.qty, { removable: true });
    const tags = [];
    tags.push(`<span class="gtag ${it.lock ? "lock" : "gen"}">${it.lock ? "🔒 מוצר נעול" : "כללי · הזול בכל סופר"}</span>`);
    if (pref.organic) tags.push(`<span class="gtag">אורגני</span>`);
    if (pref.form === "fresh") tags.push(`<span class="gtag">טרי</span>`);
    if (pref.form === "frozen") tags.push(`<span class="gtag">קפוא</span>`);
    if (pref.anySize) tags.push(`<span class="gtag">כל גודל</span>`);
    if (pref.mehadrin) tags.push(`<span class="gtag">מהדרין</span>`);
    if (pref.brand) tags.push(`<span class="gtag">מותג: ${esc(pref.brand)}</span>`);
    if (it.ex && it.ex.length) tags.push(`<span class="gtag">${it.ex.length} הוחרגו</span>`);
    if (weighed) tags.push(`<span class="gtag">בק״ג</span>`);
    let meta;
    if (conf === "none" || !s.best) {
      meta = `<div class="meta warn-line">לא נמצא מוצר מתאים בסניפים שנבחרו. נסו ניסוח כללי יותר (למשל «גבינה צהובה» במקום שם מסחרי) או ערכו.</div>`;
    } else {
      const bp = s.best.p;
      const up = s.best.unit != null && !weighed ? ` · ${fmtPrice(s.best.unit)} ${esc(s.best.unitLabel)}` : "";
      meta = `<div class="meta">הכי זול: <strong>${fmtPrice(s.best.price)}</strong>${weighed ? " לק״ג" : ""} ב${esc(state.meta.stores[s.best.i].short)} · ${esc(bp.n)}${up}</div>
        <div class="meta">${s.n} מוצרים שקולים · נמצא ב־${s.stores}/${s.total} סניפים${conf === "low" || conf === "medium" ? " · כדאי לבדוק" : ""}</div>`;
    }
    const rows = idxs.map((i) => {
      const pk = res ? G.pick(res, i) : null;
      const st = state.meta.stores[i];
      if (!pk) return `<li class="miss"><span class="st">${esc(st.short)}</span><span class="pn">אין מוצר מתאים</span><span></span></li>`;
      const best = s.best && pk.price === s.best.price;
      const up = pk.unit != null && !weighed ? `<small>${fmtPrice(pk.unit)} ${esc(pk.unitLabel)}</small>` : "";
      const mm = cleanManu(pk.p.m) || "";
      return `<li class="${best ? "best" : ""}"><span class="st">${esc(st.short)}</span>
        <span class="pn">${esc(pk.p.n)}<small>${esc(mm)}${mm ? " · " : ""}${esc(sizeText(pk.p))}</small></span>
        <span class="pp">${fmtPrice(pk.price)}${up}<button type="button" class="link-btn" data-swap="${esc(it.c)}" data-store="${i}">החלפה</button></span></li>`;
    }).join("");
    const brands = res ? res.brands.filter((b) => cleanManu(b)).slice(0, 60).sort((a, b) => a.localeCompare(b, "he")) : [];
    const pc = (k, on, label) => `<button type="button" class="pchip ${on ? "on" : ""}" data-pref="${k}" aria-pressed="${on ? "true" : "false"}">${label}</button>`;
    const prefs = `<div class="gen-prefs" data-pref-for="${esc(it.c)}">
        ${pc("organic", !!pref.organic, "אורגני")}${pc("fresh", pref.form === "fresh", "טרי")}${pc("frozen", pref.form === "frozen", "קפוא")}${pc("anySize", !!pref.anySize, "כל גודל")}${pc("mehadrin", !!pref.mehadrin, "מהדרין")}
        ${brands.length > 1 ? `<label class="brand-pick">מותג <select data-pref="brand"><option value="">כל מותג</option>${brands.map((b) => `<option value="${esc(b)}" ${pref.brand === b ? "selected" : ""}>${esc(cleanManu(b))}</option>`).join("")}</select></label>` : ""}
        ${it.lock || (it.ex && it.ex.length) ? pc("reset", false, "ביטול נעילה / החרגות") : ""}
        ${pc("edit", false, "✏️ עריכת הניסוח")}
      </div>`;
    const priceSide = s.best ? `<div class="price-range">${fmtPrice(s.best.price * it.qty)}<span class="from">הזול לכמות</span></div>` : `<div class="price-range">—</div>`;
    return `<article class="product list-item gen-item conf-${conf}" data-c="${esc(it.c)}">
      <div class="gen-main">
        <div class="name">${esc(it.g)}</div>
        ${meta}
        <div class="gtags">${tags.join("")}</div>
      </div>
      <div class="side">${priceSide}${qtyHtml}</div>
      <details class="gen-picks"${conf === "none" ? " open" : ""}>
        <summary>מה נבחר בכל סופר · החלפה והעדפות</summary>
        <ul class="pick-rows">${rows}</ul>
        ${prefs}
      </details>
    </article>`;
  }

  function quickChipsHtml() {
    const inList = new Set(state.list.filter(isGen).map((x) => G.norm(x.g)));
    const freq = frequentItems(8).filter((t) => !STAPLES.includes(t));
    const chip = (t) => {
      const on = inList.has(G.norm(t));
      return `<button type="button" class="qchip ${on ? "in" : ""}" data-quick="${esc(t)}">${on ? "✓ " : "+ "}${esc(t)}</button>`;
    };
    return (freq.length ? `<div class="qrow"><span class="qlabel">קניתם לאחרונה</span><div class="qscroll">${freq.map(chip).join("")}</div></div>` : "") +
      `<div class="qrow"><span class="qlabel">מוצרי יסוד</span><div class="qscroll">${STAPLES.map(chip).join("")}</div></div>`;
  }
  function renderQuickChips() {
    const el = $("quick-chips");
    if (el) el.innerHTML = quickChipsHtml();
  }

  function renderSmartSuggest() {
    const box = $("smart-suggest");
    const q = $("smart-input").value.trim();
    if (!q || !state.gindex) { box.hidden = true; state.smartItems = []; return; }
    const spec = G.parseItem(q);
    const typed = lineSpec(q);
    const items = [{ text: q, label: typed.label, qty: typed.qty, typed: true }];
    for (const s of G.suggest(state.gindex, q, 7)) {
      if (G.norm(s.text) === G.norm(typed.label)) continue;
      items.push({ text: (spec.qty ? spec.qty + " " : "") + s.text, label: s.text, qty: spec.qty || null });
    }
    state.smartItems = items.slice(0, 7);
    if (state.smartIdx >= state.smartItems.length) state.smartIdx = -1;
    box.innerHTML = state.smartItems.map((it, k) => {
      const res = G.resolve(state.gindex, { t: it.typed ? typed.label : it.label }, { nStores: NS() });
      const qty = it.qty && it.qty !== 1 ? it.qty : null;
      return `<button type="button" role="option" class="sg ${k === state.smartIdx ? "active" : ""}" data-smart="${k}" aria-selected="${k === state.smartIdx}">
        <span class="sg-t">${it.typed ? "<span class=\"sg-k\">הוספה</span> " : ""}<strong>${esc(it.label)}</strong>${qty ? ` <span class="sg-q">× ${qty}${res.weighed ? " ק״ג" : ""}</span>` : ""}</span>
        <span class="sg-m">${previewHtml(res)}</span>
      </button>`;
    }).join("");
    box.hidden = false;
  }
  function commitSmart(k) {
    const input = $("smart-input");
    const item = k != null && k >= 0 ? state.smartItems[k] : null;
    const text = item ? item.text : input.value.trim();
    if (!text) return;
    addGeneric(text);
    input.value = "";
    state.smartIdx = -1;
    state.smartItems = [];
    $("smart-suggest").hidden = true;
    renderShopList();
    renderQuickChips();
    renderChrome();
    input.focus();
  }

  // ---------- sheets ----------
  function openSheet(id) {
    const el = $(id);
    el.hidden = false;
    document.body.classList.add("sheet-open");
  }
  function closeSheets() {
    document.querySelectorAll(".sheet").forEach((s) => { s.hidden = true; });
    document.body.classList.remove("sheet-open");
  }
  function openSwap(c, storeIdx) {
    const it = state.list.find((x) => x.c === c);
    if (!it) return;
    const res = genRes(it);
    const st = state.meta.stores[storeIdx];
    const alts = G.alternatives(res, storeIdx, 40);
    $("pick-title").textContent = `${it.g} · ${st.short}`;
    $("pick-body").innerHTML = `<p class="hint">«נעילה» = רק המוצר הזה, בכל הסניפים (השוואה מדויקת). «לא זה» = מוציאים אותו ובוחרים את הבא בתור. מסודר לפי מחיר ליחידת מידה.</p>
      ${alts.length ? alts.map((a) => {
        const mm = cleanManu(a.p.m) || "";
        return `<div class="alt-row ${a.inPool ? "" : "out"}">
        <div class="alt-main"><div class="name">${esc(a.p.n)}</div><div class="meta">${esc(mm)}${mm ? " · " : ""}${esc(sizeText(a.p))}${a.inPool ? "" : " · מחוץ לטווח הגודל/ההעדפות"}</div></div>
        <div class="alt-side"><strong>${fmtPrice(a.price)}</strong>${a.unit != null ? `<small>${fmtPrice(a.unit)} ${esc(a.unitLabel)}</small>` : ""}
          <div class="alt-actions"><button type="button" class="ghost-btn small" data-lock="${esc(a.p._id)}" data-for="${esc(c)}">נעילה</button>
          <button type="button" class="ghost-btn small" data-exclude="${esc(a.p._id)}" data-for="${esc(c)}">לא זה</button></div></div>
      </div>`;
      }).join("") : `<p>אין מוצרים מתאימים בסניף הזה.</p>`}`;
    openSheet("pick-sheet");
  }

  // ---------- import ----------
  function fuzzyAlternatives(text) {
    const out = [];
    const seen = new Set();
    const spec = G.parseItem(text);
    const words = spec.base.split(" ").filter((w) => w.length > 1);
    for (const w of words) {
      for (const L of [w.length - 1, 4, 3]) {
        if (L < 2 || L > w.length) continue;
        for (const s of G.suggest(state.gindex, w.slice(0, L), 5)) {
          const k = G.norm(s.text);
          if (seen.has(k)) continue;
          seen.add(k);
          const r = G.resolve(state.gindex, { t: s.text }, { nStores: NS() });
          if (r.confidence !== "none") out.push(s.text);
          if (out.length >= 4) return out;
        }
      }
    }
    return out;
  }
  function buildImportRow(line) {
    const ls = lineSpec(line);
    const res = G.resolve(state.gindex, { t: ls.label }, { nStores: NS() });
    const alts = res.confidence === "high" ? [] : fuzzyAlternatives(ls.label);
    return { raw: line, text: ls.label, qty: ls.qty, res, alts, skip: false };
  }
  function renderImportRows() {
    const rows = state.importRows.filter((r) => !r.skip);
    const ok = rows.filter((r) => r.res.confidence === "high").length;
    const miss = rows.filter((r) => r.res.confidence === "none").length;
    const check = rows.length - ok - miss;
    $("import-summary").innerHTML = `<strong>${rows.length} פריטים</strong> · <span class="ok">✓ ${ok} זוהו</span> · <span class="chk">? ${check} לבדיקה</span> · <span class="bad">✗ ${miss} לא נמצאו</span><br><span class="hint">אפשר לתקן כל שורה בהקלדה או בלחיצה על הצעה. שורות שלא נמצאו לא יתווספו.</span>`;
    $("import-rows").innerHTML = state.importRows.map((r, k) => {
      if (r.skip) return "";
      const conf = r.res.confidence;
      const icon = conf === "high" ? "✓" : conf === "none" ? "✗" : "?";
      const altHtml = r.alts.length ? `<div class="imp-alts"><span>${conf === "none" ? "אולי התכוונתם:" : "או:"}</span> ${r.alts.map((a) => `<button type="button" class="qchip" data-imp-alt="${k}" data-text="${esc(a)}">${esc(a)}</button>`).join("")}</div>` : "";
      const step = r.res.weighed ? 0.5 : 1;
      return `<div class="imp-row conf-${conf}" data-row="${k}">
        <div class="imp-line">
          <span class="imp-icon" aria-hidden="true">${icon}</span>
          <input class="imp-text" data-imp-text="${k}" value="${esc(r.text)}" aria-label="פריט ${k + 1}" enterkeyhint="done" />
          <div class="qty imp-qty"><button type="button" data-imp-q="${k}" data-d="${-step}" aria-label="הפחתה">−</button><span class="n">${r.qty}${r.res.weighed ? "<small> ק״ג</small>" : ""}</span><button type="button" data-imp-q="${k}" data-d="${step}" aria-label="הוספה">+</button></div>
          <button type="button" class="imp-del" data-imp-del="${k}" aria-label="הסרת שורה">×</button>
        </div>
        <div class="imp-info">${r.raw.trim() !== r.text ? `<span class="imp-raw">«${esc(r.raw.trim())}»</span> ` : ""}${previewHtml(r.res)}</div>
        ${altHtml}
      </div>`;
    }).join("");
    const addable = rows.filter((r) => r.res.confidence !== "none").length;
    $("import-add").textContent = `הוספת ${addable} פריטים לרשימה`;
    $("import-add").disabled = addable === 0;
  }
  function parseImport(text) {
    const lines = G.splitList(text);
    state.importRows = lines.slice(0, 150).map(buildImportRow);
    $("import-step1").hidden = true;
    $("import-step2").hidden = false;
    renderImportRows();
  }
  function openImport(prefill) {
    $("import-step1").hidden = false;
    $("import-step2").hidden = true;
    if (prefill != null) $("import-text").value = prefill;
    openSheet("import-sheet");
    if (prefill) parseImport(prefill);
    else setTimeout(() => $("import-text").focus(), 40);
  }
  function commitImport() {
    let added = 0, skipped = 0;
    const prev = JSON.parse(JSON.stringify(state.list));
    for (const r of state.importRows) {
      if (r.skip) continue;
      if (r.res.confidence === "none") { skipped++; continue; }
      addGeneric(r.text, { qty: r.qty, silent: true });
      added++;
    }
    closeSheets();
    lastAction = { type: "replace-list", prev };
    if (state.panel !== "list") showPanel("list"); else { renderShopList(); renderQuickChips(); }
    renderChrome();
    showToast(`נוספו ${added} פריטים${skipped ? ` · ${skipped} לא זוהו ולא נוספו` : ""}`, true);
  }

  function bestTwoStoreSplit(items, idxs) {
    let best = null;
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        const i = idxs[a], j = idxs[b];
        let total = 0;
        let missing = 0;
        const groups = new Map([
          [i, { i, items: [], total: 0 }],
          [j, { i: j, items: [], total: 0 }],
        ]);
        for (const it of items) {
          const ci = entryCost(it, i);
          const cj = entryCost(it, j);
          if (!ci && !cj) { missing++; continue; }
          const pick = !ci ? { i: j, lc: cj } : !cj ? { i, lc: ci } : (ci.cost <= cj.cost ? { i, lc: ci } : { i: j, lc: cj });
          total += pick.lc.cost;
          const g = groups.get(pick.i);
          g.items.push({ it, lc: pick.lc });
          g.total += pick.lc.cost;
        }
        const used = [...groups.values()].filter((g) => g.items.length);
        if (!best || missing < best.missing || (missing === best.missing && total < best.total)) {
          best = { total, missing, stores: used, pair: [i, j] };
        }
      }
    }
    return best;
  }

  function compareBaskets() {
    const idxs = enabledStoreIdx();
    const items = state.list
      .map((it) => (isGen(it) ? { ...it } : { ...it, p: state.byId.get(it.c) }))
      .filter((x) => isGen(x) || x.p);
    const commonCodes = items
      .filter((it) => idxs.every((i) => entryCost(it, i) != null))
      .map((it) => it.c);

    const rows = idxs.map((i) => {
      const store = state.meta.stores[i];
      let total = 0;
      let commonTotal = 0;
      const found = [];
      const missing = [];
      const promos = [];
      for (const it of items) {
        const lc = entryCost(it, i);
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

    // Unconstrained split (each item from its cheapest store) — informational
    const splitGroups = new Map();
    let splitTotal = 0;
    const splitMissing = [];
    for (const it of items) {
      let best = null;
      for (const i of idxs) {
        const lc = entryCost(it, i);
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

    const two = bestTwoStoreSplit(items, idxs);
    return { items, rows, winner, commonCodes, splitTotal, splitGroups, splitMissing, two };
  }


  function lookupByBarcode(code) {
    if (!code) return null;
    const key = String(code);
    const direct = state.byId.get(key);
    if (direct && String(direct.c) === key) return direct;
    const hits = state.products.filter((p) => String(p.c) === key);
    if (!hits.length) return direct || null;
    const idxs = state.meta ? enabledStoreIdx() : [];
    hits.sort((a, b) => {
      const ca = idxs.filter((i) => a.p[i] != null).length;
      const cb = idxs.filter((i) => b.p[i] != null).length;
      return cb - ca;
    });
    return hits[0];
  }

  function resolveBasketProducts(item) {
    const codes = [item.barcode, ...(item.fallbacks || [])].filter(Boolean).map(String);
    const out = [];
    const seen = new Set();
    for (const c of codes) {
      const p = lookupByBarcode(c);
      if (p && !seen.has(p._id)) {
        out.push(p);
        seen.add(p._id);
      }
    }
    return out;
  }

  function priceBasketItem(item, storeIdx, qty = 1) {
    const products = resolveBasketProducts(item);
    for (const p of products) {
      const lc = lineCost(p, storeIdx, qty);
      if (lc) {
        return { p, lc, usedFallback: String(p.c) !== String(item.barcode || "") };
      }
    }
    return null;
  }

  function compareNamedBasket(basket) {
    const idxs = enabledStoreIdx();
    const items = basket.items || [];
    const rows = idxs.map((i) => {
      const store = state.meta.stores[i];
      let total = 0;
      const found = [];
      const missing = [];
      const promos = [];
      for (const item of items) {
        const hit = priceBasketItem(item, i);
        if (!hit) missing.push(item);
        else {
          total += hit.lc.cost;
          found.push({ item, ...hit });
          if (hit.lc.promo) promos.push({ item, ...hit });
        }
      }
      return { i, store, total, found, missing, promos, allIn: missing.length === 0 && items.length > 0 };
    });
    let winner = null;
    for (const r of rows) {
      if (!items.length) break;
      if (
        !winner ||
        r.missing.length < winner.missing.length ||
        (r.missing.length === winner.missing.length && r.total < winner.total)
      ) {
        winner = r;
      }
    }
    const comparable = winner
      ? rows.filter((r) => r.missing.length === winner.missing.length && r.found.length)
      : [];
    const dearest = comparable.length
      ? comparable.reduce((a, b) => (a.total >= b.total ? a : b))
      : null;
    const saved = winner && dearest && dearest.i !== winner.i ? dearest.total - winner.total : 0;
    const ranked = rows.slice().sort((a, b) => a.missing.length - b.missing.length || a.total - b.total);
    const mapped = items.filter((it) => resolveBasketProducts(it).length).length;
    return { items, rows, ranked, winner, dearest, saved, mapped };
  }

  function matchLabel(m) {
    if (m === "missing") return "חסר בקטלוג";
    if (m === "substitute") return "החלפה";
    if (m === "standard") return "מקביל סטנדרטי";
    if (m === "fallback") return "ברקוד גיבוי";
    return "התאמה מדויקת";
  }

  function renderBaskets() {
    const root = $("baskets-root");
    if (!root) return;
    const asOf = state.meta && state.meta.as_of ? fmtDate(state.meta.as_of) : "";
    if (!state.baskets || !state.baskets.length) {
      root.innerHTML = `<div class="empty">
        <h3>לא הצלחתי לטעון את הסלים</h3>
        <p>נסו לרענן את העמוד. ההשוואה מחושבת מול הקטלוג העדכני של הסניפים בעיר.</p>
      </div>`;
      return;
    }
    const intro = `<div class="baskets-intro">
      <h2>סלים מוכרים</h2>
      <p>שלושה סלי מדד שמשמשים בישראל להשוואת יוקר המחיה, מחושבים מול מחירי המדף הנוכחיים בסניפי קריית שמונה${asOf ? ` (נכון ל־${esc(asOf)})` : ""}. המחירים מתעדכנים עם הרענון היומי של הקטלוג.</p>
    </div>`;

    const cards = state.baskets.map((basket) => {
      const cmp = compareNamedBasket(basket);
      const w = cmp.winner;
      const src = (basket.sources || []).map((s) =>
        `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`
      ).join("");
      let hero;
      if (!w || !w.found.length) {
        hero = `<div class="basket-hero"><p>אין מחירים זמינים לסניפים שנבחרו.</p></div>`;
      } else {
        const missTxt = w.missing.length
          ? ` · חסרים ${w.missing.length} פריטים בסניף זה`
          : " · כל הפריטים שנמצאו בקטלוג";
        const saveTxt = cmp.saved > 0.009
          ? `<p class="save">חוסכים ${fmtPrice(cmp.saved)} לעומת ${esc(cmp.dearest.store.name)}</p>`
          : "";
        hero = `<div class="basket-hero">
          <p>הסניף הזול ביותר לקריית שמונה</p>
          <h4>${esc(w.store.name)}</h4>
          <div class="sum">${fmtPrice(w.total)}</div>
          ${saveTxt}
          <p>${w.found.length} מתוך ${cmp.items.length} פריטים${missTxt}</p>
        </div>`;
      }
      const rank = cmp.ranked.map((r, idx) => {
        const win = w && r.i === w.i;
        const delta = w && !win && r.missing.length === w.missing.length && r.total > w.total
          ? `<div class="delta">+${fmtPrice(r.total - w.total)} יותר</div>`
          : (win ? `<div class="delta">הכי זול</div>` : "");
        return `<article class="store-card ${win ? "winner" : ""}">
          <div class="head">
            <div>
              <h3><span class="rank">${idx + 1}</span>${win ? "🏆 " : ""}${esc(r.store.name)}</h3>
              <div class="addr">${esc(r.store.address || "")}${r.store.nearby ? " · ליד העיר" : ""}</div>
            </div>
            <div>
              <div class="total">${r.found.length ? fmtPrice(r.total) : "—"}</div>
              ${delta}
            </div>
          </div>
          <div class="stats">
            <span class="pill ${r.missing.length ? "warn" : "good"}">${r.found.length} מתוך ${cmp.items.length} פריטים</span>
          </div>
        </article>`;
      }).join("");

      const storeHead = cmp.rows.map((r) => `<th>${esc(r.store.name)}</th>`).join("");
      const body = cmp.items.map((item) => {
        const products = resolveBasketProducts(item);
        const catalogName = products.length ? products[0].n : "";
        const flag = item.match && item.match !== "exact"
          ? `<span class="basket-flag ${esc(item.match)}">${esc(matchLabel(item.match))}</span>`
          : "";
        const cells = cmp.rows.map((r) => {
          const hit = priceBasketItem(item, r.i);
          if (!hit) return `<td class="miss">חסר</td>`;
          const best = cmp.rows
            .map((x) => priceBasketItem(item, x.i))
            .filter(Boolean)
            .map((h) => h.lc.cost);
          const isBest = best.length && hit.lc.cost === Math.min(...best);
          const fb = hit.usedFallback ? `<div class="item-sub">גיבוי</div>` : "";
          return `<td class="${isBest ? "best" : ""}">${fmtPrice(hit.lc.cost)}${fb}</td>`;
        }).join("");
        const sub = [item.brand, item.size, catalogName && catalogName !== item.name ? catalogName : ""]
          .filter(Boolean).join(" · ");
        return `<tr>
          <td>
            ${flag}<span class="item-name">${esc(item.name)}</span>
            ${sub ? `<span class="item-sub">${esc(sub)}</span>` : ""}
            ${item.note && (item.match === "substitute" || item.match === "missing") ? `<span class="item-sub">${esc(item.note)}</span>` : ""}
          </td>
          ${cells}
        </tr>`;
      }).join("");

      const subst = (basket.items || []).filter((i) => i.match === "substitute").length;
      const missMap = (basket.items || []).filter((i) => i.match === "missing" || !resolveBasketProducts(i).length).length;

      return `<article class="basket-card" data-basket="${esc(basket.id)}">
        <div class="basket-head">
          <p class="basket-kicker">${esc(basket.publisher || "")} · ${esc(basket.date_label || basket.date || "")}</p>
          <h3>${esc(basket.title)}</h3>
          <p class="basket-kicker">${esc(basket.short || "")} · ${cmp.mapped} מתוך ${cmp.items.length} פריטים ממופים לקטלוג</p>
        </div>
        <p class="basket-desc">${esc(basket.description || "")}</p>
        ${basket.note ? `<p class="basket-note">${esc(basket.note)}</p>` : ""}
        <ul class="basket-sources">${src}</ul>
        ${hero}
        <div class="basket-actions">
          <button type="button" class="primary-btn" data-load-basket="${esc(basket.id)}">טען לרשימת הקניות</button>
        </div>
        <p class="hint coverage-pill">${subst ? `${subst} החלפות מסומנות בטבלה. ` : ""}${missMap ? `${missMap} פריטים לא נמצאו בקטלוג. ` : ""}הסכום כולל רק פריטים שיש להם מחיר בסניף.</p>
        <div class="basket-rank">${rank}</div>
        <details class="matrix-block">
          <summary>טבלת מחירים לפי מוצר</summary>
          <div class="matrix-wrap">
            <table class="matrix">
              <thead><tr><th>מוצר</th>${storeHead}</tr></thead>
              <tbody>${body}</tbody>
            </table>
          </div>
        </details>
      </article>`;
    }).join("");

    root.innerHTML = intro + cards;
  }

  function loadBasketToList(id) {
    const basket = (state.baskets || []).find((b) => b.id === id);
    if (!basket) return;
    const entries = [];
    for (const item of basket.items || []) {
      const products = resolveBasketProducts(item);
      if (!products.length) continue;
      entries.push({ c: products[0]._id, qty: 1 });
    }
    if (!entries.length) {
      showToast("לא נמצאו מוצרים לטעינה מהסל הזה", false);
      return;
    }
    if (state.list.length) {
      const ok = window.confirm(`הטעינה תחליף את הרשימה הנוכחית (${state.list.length} פריטים) ב־${entries.length} פריטים מ«${basket.title}». להמשיך?`);
      if (!ok) return;
    }
    lastAction = { type: "replace-list", prev: state.list.map((x) => ({ ...x })) };
    state.list = entries;
    saveList();
    const skipped = (basket.items || []).length - entries.length;
    const extra = skipped ? ` · ${skipped} פריטים לא נמצאו בקטלוג` : "";
    showToast(`נטענו ${entries.length} פריטים מ«${basket.title}» לרשימה${extra}`, true);
    renderChrome();
  }

  function renderCompare() {

    const root = $("compare-root");
    const asOf = state.meta && state.meta.as_of ? fmtDate(state.meta.as_of) : "";
    if (!state.list.length) {
      root.innerHTML = `<div class="empty">
        <h3>אין מה להשוות עדיין</h3>
        <p>הוסיפו מוצרים לרשימה, ואז נחשב איפה הסל הכי זול.</p>
        <button class="primary-btn compare-empty-actions" type="button" data-go="list">לבניית הרשימה</button>
      </div>`;
      return;
    }
    const cmp = compareBaskets();
    const w = cmp.winner;
    const comparable = cmp.rows.filter((r) => r.missing.length === (w ? w.missing.length : 0) && r.found.length);
    const dearest = comparable.length
      ? comparable.reduce((a, b) => (a.total >= b.total ? a : b))
      : null;
    const saved = w && dearest && dearest.i !== w.i ? dearest.total - w.total : 0;

    let hero;
    if (!w) {
      hero = `<div class="compare-hero"><h2>אין מחירים זמינים</h2><p>לא נמצא אף פריט בסניפים שנבחרו.</p></div>`;
    } else if (w.allIn) {
      hero = `<div class="compare-hero">
        <p>הסל המלא הכי זול ב־</p>
        <h2>${esc(w.store.name)}</h2>
        <div class="sum">${fmtPrice(w.total)}</div>
        ${saved > 0.009 ? `<p class="save">חוסכים ${fmtPrice(saved)} לעומת ${esc(dearest.store.name)}</p>` : ""}
        <p class="compare-meta">${esc(w.store.address)} · מחירי מדף נכון ל־${fmtDate(w.store.as_of || asOf)}</p>
      </div>`;
    } else {
      hero = `<div class="compare-hero">
        <p>אף סניף לא מחזיק את כל הרשימה. הזול ביותר מבין הפריטים שיש לו הוא</p>
        <h2>${esc(w.store.name)}</h2>
        <div class="sum">${fmtPrice(w.total)}</div>
        <p>חסרים ${w.missing.length} פריטים${saved > 0.009 ? ` · חוסכים ${fmtPrice(saved)} מול ${esc(dearest.store.name)} על הפריטים שנמצאו` : ""}</p>
        <p class="compare-meta">מחירי מדף נכון ל־${fmtDate(w.store.as_of || asOf)}</p>
      </div>`;
    }

    const ranked = cmp.rows
      .slice()
      .sort((a, b) => a.missing.length - b.missing.length || a.total - b.total);

    const cards = ranked
      .map((r, idx) => {
        const win = w && r.i === w.i;
        const miss = r.missing.length
          ? `<details class="missing"><summary>חסרים ${r.missing.length} פריטים</summary><ul>${r.missing.map((m) => `<li>${esc(entryName(m))} × ${m.qty}</li>`).join("")}</ul></details>`
          : `<div class="hint">כל הפריטים נמצאו בסניף.</div>`;
        const common = cmp.commonCodes.length
          ? `<span class="pill">משותפים לכל החנויות: ${fmtPrice(r.commonTotal)}</span>`
          : "";
        const promoN = r.promos.length
          ? `<span class="pill good">מבצעים שחושבו: ${r.promos.length}</span>`
          : "";
        const delta = w && !win && r.missing.length === w.missing.length && r.total > w.total
          ? `<div class="delta">+${fmtPrice(r.total - w.total)} יותר</div>`
          : (win ? `<div class="delta">הכי זול</div>` : "");
        return `<article class="store-card ${win ? "winner" : ""}">
          <div class="head">
            <div>
              <h3><span class="rank">${idx + 1}</span>${win ? "🏆 " : ""}${esc(r.store.name)}</h3>
              <div class="addr">${esc(r.store.address)}${r.store.nearby ? " · ליד העיר" : ""} · ${fmtDate(r.store.as_of)}</div>
            </div>
            <div>
              <div class="total">${fmtPrice(r.total)}</div>
              ${delta}
            </div>
          </div>
          <div class="stats">
            <span class="pill ${r.missing.length ? "warn" : "good"}">${r.found.length} מתוך ${cmp.items.length} פריטים</span>
            ${common}
            ${promoN}
          </div>
          ${miss}
        </article>`;
      })
      .join("");

    const idxs = enabledStoreIdx();
    const head = ["<th>מוצר</th>"]
      .concat(idxs.map((i) => `<th>${esc(state.meta.stores[i].short)}</th>`))
      .join("");
    const body = cmp.items.map((it) => {
      const vals = idxs.map((i) => ({ i, lc: entryCost(it, i) }));
      const present = vals.filter((v) => v.lc);
      const min = present.length ? Math.min(...present.map((v) => v.lc.cost)) : null;
      const gen = isGen(it);
      const res = gen ? genRes(it) : null;
      const cells = vals.map((v) => {
        if (!v.lc) return `<td class="miss">חסר</td>`;
        const pp = v.lc.p;
        const promo = v.lc.promo ? `<div class="promo-dot">מבצע</div>` : (pp.pr && pp.pr.some((x) => x.s === v.i) ? `<div class="promo-dot">יש מבצע</div>` : "");
        let pickLine = "";
        if (gen) {
          const flags = [];
          const pit = v.lc.pick && v.lc.pick.it;
          if (pit && pit.attrs.organic && !(it.pref && it.pref.organic) && !(res && res.spec.organic)) flags.push("אורגני");
          if (pit && res && res.target && pit.size && pit.size.dim === res.target.dim) {
            const ratio = pit.size.qty / res.target.qty;
            if (ratio < 0.8 || ratio > 1.25) flags.push("גודל שונה");
          }
          const short = pp.n.length > 28 ? pp.n.slice(0, 27) + "…" : pp.n;
          pickLine = `<div class="pick-name" title="${esc(pp.n)}">${esc(short)}${flags.length ? ` <b class="pflag">${flags.join(" · ")}</b>` : ""}</div>`;
        }
        return `<td class="${v.lc.cost === min ? "best" : ""}">${fmtPrice(v.lc.cost)}${promo}${pickLine}</td>`;
      }).join("");
      const tag = gen ? (it.lock ? `<span class="gtag lock mini">נעול</span>` : `<span class="gtag gen mini">כללי</span>`) : `<span class="gtag lock mini">מדויק</span>`;
      return `<tr><td>${tag} ${esc(entryName(it))} × ${it.qty}</td>${cells}</tr>`;
    }).join("");
    const totals = idxs.map((i) => {
      const r = cmp.rows.find((x) => x.i === i);
      const cls = w && r && r.i === w.i ? "best" : "";
      return `<td class="${cls}">${r ? fmtPrice(r.total) : "—"}</td>`;
    }).join("");
    const matrix = `<div class="matrix-block">
      <h3>טבלת מחירים לפי פריט</h3>
      <p class="hint">התא הירוק הוא המחיר הזול בכל שורה. בפריט <b>כללי</b> נבחר בכל סופר המוצר המשתלם ביותר (לפי מחיר לק״ג / לליטר / ליחידה) ושמו מופיע בתא, כך שרואים בדיוק מה הוחלף. <b>מדויק</b> / <b>נעול</b> = אותו מוצר בדיוק בכל הסניפים.</p>
      <div class="matrix-wrap">
        <table class="matrix">
          <thead><tr>${head}</tr></thead>
          <tbody>${body}<tr><td><strong>סה״כ שנמצא</strong></td>${totals}</tr></tbody>
        </table>
      </div>
    </div>`;

    let splitHtml = "";
    const two = cmp.two;
    const twoUsed = two && two.stores && two.stores.length === 2 && two.stores.every((g) => g.items.length);
    const worthTwo = twoUsed && w && (two.missing <= w.missing.length) && two.total + 0.009 < w.total;
    if (worthTwo) {
      const names = two.pair.map((i) => state.meta.stores[i].name).join(" + ");
      splitHtml = `<div class="split">
        <h3>פיצול מעשי בין שתי חנויות</h3>
        <p class="hint">קנייה ב־${esc(names)} יוצאת ${fmtPrice(two.total)} — חוסכים ${fmtPrice(w.total - two.total)} לעומת קנייה רק ב־${esc(w.store.name)}.${two.missing ? ` ${two.missing} פריטים לא נמצאו בשתי החנויות.` : ""}</p>
        ${two.stores.map((g) => {
          const s = state.meta.stores[g.i];
          return `<p><strong>${esc(s.name)}</strong> — ${fmtPrice(g.total)} (${g.items.length} פריטים)</p>
            <ul>${g.items.map((x) => `<li>${esc(entryName(x.it))}${isGen(x.it) ? ` <small>(${esc(x.lc.p.n)})</small>` : ""} × ${x.it.qty} · ${fmtPrice(x.lc.cost)}</li>`).join("")}</ul>`;
        }).join("")}
      </div>`;
    } else if (cmp.splitGroups.size > 1 && w && cmp.splitTotal + 0.009 < w.total) {
      const groups = [...cmp.splitGroups.values()].sort((a, b) => b.total - a.total);
      splitHtml = `<div class="split">
        <h3>פיצול בין כמה חנויות</h3>
        <p class="hint">אם לוקחים כל פריט מהסניף הכי זול שלו, הסל יורד ל־${fmtPrice(cmp.splitTotal)}. בפועל זה אומר לעצור ביותר משתי חנויות, לכן עדיף רק אם החיסכון משמעותי.</p>
        ${groups.map((g) => {
          const s = state.meta.stores[g.i];
          return `<p><strong>${esc(s.name)}</strong> — ${fmtPrice(g.total)} (${g.items.length} פריטים)</p>`;
        }).join("")}
      </div>`;
    }

    root.innerHTML = `${hero}<div class="store-rail">${cards}</div>${matrix}${splitHtml}
      <p class="hint">המחירים הם מחירי מדף כפי שפורסמו בקובץ השקיפות, נכון ל־${esc(asOf)}. מבצעי מועדון, קופון או תנאי מיוחד מסומנים במוצר ואינם מקוזזים אוטומטית, אלא אם הפעלתם «חשב מבצעים פשוטים».</p>`;
  }


  function hideSuggest() {
    const box = $("suggest");
    if (!box) return;
    box.hidden = true;
    state.suggestIdx = -1;
  }

  function scheduleSuggestClose() {
    if (suggestCloseTimer) clearTimeout(suggestCloseTimer);
    suggestCloseTimer = setTimeout(() => {
      if (document.activeElement === $("q")) hideSuggest();
    }, 1400);
  }

  function renderSuggestions() {
    const box = $("suggest");
    const raw = state.q.trim();
    if (!raw || document.activeElement !== $("q")) {
      box.hidden = true;
      box.innerHTML = "";
      state.suggestItems = [];
      state.suggestIdx = -1;
      return;
    }
    const q = norm(raw);
    const tokens = q.split(" ").filter(Boolean);
    const isBarcode = /^\d{8,}$/.test(raw);
    const idxs = enabledStoreIdx();
    const scored = [];
    for (const p of state.products) {
      let any = false;
      for (const i of idxs) if (p.p[i] != null) { any = true; break; }
      if (!any) continue;
      let ok = false;
      if (isBarcode && String(p.c).includes(raw)) ok = true;
      else if (tokens.every((t) => p._n.includes(t) || String(p.c).includes(t))) ok = true;
      if (!ok) continue;
      scored.push({ p, s: relevanceScore(p, tokens, raw, isBarcode) });
      if (scored.length > 80 && scored.length % 200 === 0) {
        // keep scanning; 37k is fine
      }
    }
    scored.sort((a, b) => b.s - a.s);
    const top = scored.slice(0, 8).map((x) => x.p);
    state.suggestItems = top;
    state.suggestIdx = -1;
    if (!top.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    scheduleSuggestClose();
    box.innerHTML = `<div class="sug-label">הצעות</div>` + top.map((p, i) => {
      const pr = priceRange(p, idxs);
      return `<button type="button" role="option" data-sug="${i}" id="sug-${i}">
        <span>${esc(p.n)}</span>
        <span class="sug-meta">${p.m ? esc(p.m) + " · " : ""}${pr.min != null ? fmtPrice(pr.min) : ""}</span>
      </button>`;
    }).join("");
  }

  function highlightSuggest() {
    $("suggest").querySelectorAll("button[data-sug]").forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.sug) === state.suggestIdx);
    });
    const active = $("suggest").querySelector("button.active");
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  function applySuggestion(i) {
    const p = state.suggestItems[i];
    if (!p) return;
    $("q").value = p.n;
    state.q = p.n;
    $("search-wrap").classList.add("has-q");
    $("suggest").hidden = true;
    pushRecent(p._id);
    if (state.panel !== "catalog") showPanel("catalog");
    else {
      state.cat = "all";
      state.sub = "all";
      state.brand = "all";
      renderCatalogPane();
    }
    $("q").blur();
  }

  function parseHash() {
    const h = (location.hash || "").replace(/^#\/?/, "").split("?")[0];
    if (!h) return "list";
    return PANELS.includes(h) ? h : "list";
  }

  function showPanel(name, { hash = true } = {}) {
    if (!PANELS.includes(name)) name = "catalog";
    state.panel = name;
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
    document.querySelectorAll(".bottom-nav button, .desk-nav button").forEach((b) => {
      b.classList.toggle("active", b.dataset.go === name);
    });
    const onCatalog = name === "catalog";
    els.cats.hidden = !onCatalog || isHomeView();
    if (!onCatalog) {
      els.subs.classList.remove("open");
      els.subs.hidden = true;
      $("brands").hidden = true;
      $("recents").hidden = true;
      $("cat-grid").hidden = true;
    }
    $("suggest").hidden = true;
    $("search-wrap").hidden = name === "list";
    if (name !== "list" && $("smart-suggest")) $("smart-suggest").hidden = true;
    const toast = $("toast");
    if (toast) toast.hidden = true;
    if (hash) {
      const target = `#/${name}`;
      if (location.hash !== target) history.replaceState(null, "", target);
    }
    const titles = {
      catalog: "הסל הזול — קריית שמונה",
      list: "רשימת הקניות — הסל הזול",
      baskets: "סלים מוכרים — הסל הזול",
      compare: "השוואת הסל — הסל הזול",
      more: "הגדרות — הסל הזול",
    };
    document.title = titles[name] || titles.catalog;
    if (name === "catalog") renderCatalogPane();
    else if (name === "list") { renderShopList(); renderQuickChips(); }
    else if (name === "baskets") renderBaskets();
    else if (name === "compare") renderCompare();
    renderChrome();
    window.scrollTo(0, 0);
  }

  function renderCatalogPane() {
    renderCats();
    els.cats.hidden = isHomeView();
    renderRecents();
    const sortEl = $("sort-by");
    if (sortEl && sortEl.value !== state.sort) sortEl.value = state.sort;
    renderCatalog(true);
  }

  function renderAll() {
    if (state.panel === "catalog") renderCatalogPane();
    else if (state.panel === "list") renderShopList();
    else if (state.panel === "baskets") renderBaskets();
    else if (state.panel === "compare") renderCompare();
    renderChrome();
  }

  function refreshVisible() {
    if (state.panel === "catalog" && !isHomeView()) {
      // Update cards in place when possible; simplest is re-render current page window
      const keep = state.shown;
      renderCatalog(true);
      while (state.shown < keep && state.shown < state.filtered.length) renderCatalog(false);
    } else if (state.panel === "list") renderShopList();
    else if (state.panel === "baskets") renderBaskets();
    else if (state.panel === "compare") renderCompare();
    else renderRecents();
    renderChrome();
  }

  function bind() {
    els.cats = $("cats");
    els.subs = $("subs");
    els.catalogList = $("catalog-list");

    const onQuery = (immediate) => {
      state.q = $("q").value;
      $("search-wrap").classList.toggle("has-q", !!state.q.trim());
      if (state.panel !== "catalog") showPanel("catalog");
      const run = () => {
        state.brand = "all";
        if (!state.q.trim()) {
          state.cat = state.cat; // keep
        }
        renderCatalogPane();
      };
      if (immediate) {
        if (searchTimer) clearTimeout(searchTimer);
        run();
      } else {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(run, 160);
      }
      clearTimeout(suggestTimer);
      suggestTimer = setTimeout(renderSuggestions, 80);
    };

    $("q").addEventListener("input", () => onQuery(false));
    $("q").addEventListener("focus", () => {
      if (state.q.trim()) renderSuggestions();
    });
    $("q").addEventListener("keydown", (e) => {
      if ($("suggest").hidden) {
        if (e.key === "Enter") onQuery(true);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        state.suggestIdx = Math.min(state.suggestItems.length - 1, state.suggestIdx + 1);
        highlightSuggest();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        state.suggestIdx = Math.max(-1, state.suggestIdx - 1);
        highlightSuggest();
      } else if (e.key === "Enter") {
        if (state.suggestIdx >= 0) {
          e.preventDefault();
          applySuggestion(state.suggestIdx);
        } else {
          $("suggest").hidden = true;
          onQuery(true);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        hideSuggest();
      }
    });
    $("q-clear").addEventListener("click", () => {
      $("q").value = "";
      state.q = "";
      $("search-wrap").classList.remove("has-q");
      $("suggest").hidden = true;
      renderCatalogPane();
      $("q").focus();
    });
    $("suggest").addEventListener("mousedown", (e) => {
      const btn = e.target.closest("[data-sug]");
      if (!btn) return;
      e.preventDefault();
      applySuggestion(Number(btn.dataset.sug));
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#search-wrap")) hideSuggest();
    });
    // close-suggest-on-scroll
    window.addEventListener("scroll", () => hideSuggest(), { passive: true });
    $("suggest").addEventListener("mouseenter", () => {
      if (suggestCloseTimer) clearTimeout(suggestCloseTimer);
    });

    $("sort-by").addEventListener("change", (e) => {
      state.sort = e.target.value;
      saveSettings();
      hideSuggest();
      $("q").blur();
      if (!isHomeView()) renderCatalog(true);
    });

    const pickCat = (id) => {
      state.cat = id;
      state.sub = "all";
      state.brand = "all";
      renderCatalogPane();
      window.scrollTo(0, 0);
    };
    els.cats.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cat]");
      if (btn) pickCat(btn.dataset.cat);
    });
    $("cat-grid").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cat]");
      if (btn) pickCat(btn.dataset.cat);
    });
    els.subs.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-sub]");
      if (!btn) return;
      state.sub = btn.dataset.sub;
      state.brand = "all";
      renderSubs();
      renderCatalog(true);
    });
    $("brands").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-brand]");
      if (!btn) return;
      state.brand = btn.dataset.brand;
      renderCatalog(true);
    });
    $("recents").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-recent]");
      if (!btn) return;
      const p = state.byId.get(btn.dataset.recent);
      if (!p) return;
      $("q").value = p.n;
      state.q = p.n;
      $("search-wrap").classList.add("has-q");
      state.cat = "all";
      state.sub = "all";
      state.brand = "all";
      renderCatalogPane();
    });

    document.body.addEventListener("click", (e) => {
      const goBtn = e.target.closest("[data-go]");
      if (goBtn && !goBtn.closest(".qty")) {
        // nav buttons are bound separately; this catches in-page CTAs
        if (!goBtn.closest(".bottom-nav, .desk-nav")) {
          showPanel(goBtn.dataset.go);
          return;
        }
      }
      const btn = e.target.closest(".qty [data-act]");
      if (!btn) return;
      const wrap = btn.closest("[data-c]");
      const code = wrap && wrap.dataset.c;
      if (!code) return;
      const cur = listQty(code);
      const act = btn.dataset.act;
      const isG = String(code).startsWith("g:");
      const p = isG ? null : state.byId.get(code);
      const gEntry = isG ? state.list.find((x) => x.c === code) : null;
      const gRes = gEntry ? genRes(gEntry) : null;
      const step = (p && p.w) || (gRes && gRes.weighed) ? 0.5 : 1;
      const next = act === "+" ? cur + step : act === "x" ? 0 : cur - step;
      setQty(code, next, { toast: true });
      if (state.panel === "catalog") {
        const card = wrap.closest("article");
        if (card && p) {
          const idxs = enabledStoreIdx();
          card.outerHTML = productCard(p, idxs, { showStores: true });
        }
        renderChrome();
      } else if (state.panel === "list") { renderShopList(); renderQuickChips(); }
      else if (state.panel === "compare") renderCompare();
      renderChrome();
    });
    bindGeneric();

    $("clear-list").addEventListener("click", () => {
      if (!state.list.length) return;
      if (confirm("לפנות את כל רשימת הקניות?")) {
        state.list = [];
        saveList();
        renderShopList();
        renderChrome();
      }
    });
    $("cta-compare").addEventListener("click", () => showPanel("compare"));
    $("empty-to-catalog").addEventListener("click", () => showPanel("catalog"));
    $("fab-cart").addEventListener("click", () => showPanel("list"));

    document.querySelectorAll(".bottom-nav button, .desk-nav button").forEach((b) => {
      b.addEventListener("click", () => showPanel(b.dataset.go));
    });
    document.addEventListener("click", (e) => {
      const loadBtn = e.target.closest("[data-load-basket]");
      if (loadBtn) {
        e.preventDefault();
        loadBasketToList(loadBtn.getAttribute("data-load-basket"));
      }
    });

    window.addEventListener("hashchange", () => {
      const name = parseHash();
      if (name !== state.panel) showPanel(name, { hash: false });
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
    const used = new Map();
    const out = [];
    for (const p of products) {
      const code = String(p.c || "");
      let id = code;
      if (used.has(code)) {
        // Short internal codes collide across chains (avocado vs baguette).
        // Keep them as separate products with a stable unique id.
        id = `${code}::${norm(p.n)}`;
        let n = 2;
        while (used.has(id)) id = `${code}::${norm(p.n)}::${n++}`;
      }
      used.set(id, true);
      p._id = id;
      p._nameOnly = norm(p.n);
      p.m = cleanManu(p.m);
      p._manu = norm(p.m || "");
      p._n = `${p._nameOnly} ${p._manu}`.trim();
      attachUnit(p);
      state.byId.set(id, p);
      // Also index long unique barcodes for migrated lists
      if (id === code) state.byId.set(code, p);
      out.push(p);
    }
    state.products = out;
  }


  function reopenDetails(c) {
    const card = document.querySelector(`[data-c="${CSS.escape(c)}"] details`);
    if (card) card.open = true;
  }
  function bindGeneric() {
    const input = $("smart-input");
    let tmr = 0;
    input.addEventListener("input", () => {
      state.smartIdx = -1;
      clearTimeout(tmr);
      tmr = setTimeout(renderSmartSuggest, 90);
    });
    input.addEventListener("focus", () => { if (input.value.trim()) renderSmartSuggest(); });
    input.addEventListener("keydown", (e) => {
      const n = state.smartItems.length;
      if (e.key === "ArrowDown" && n) { e.preventDefault(); state.smartIdx = (state.smartIdx + 1) % n; renderSmartSuggest(); }
      else if (e.key === "ArrowUp" && n) { e.preventDefault(); state.smartIdx = state.smartIdx <= 0 ? n - 1 : state.smartIdx - 1; renderSmartSuggest(); }
      else if (e.key === "Escape") { e.preventDefault(); $("smart-suggest").hidden = true; }
    });
    $("smart-form").addEventListener("submit", (e) => {
      e.preventDefault();
      clearTimeout(tmr);
      commitSmart(state.smartIdx);
    });
    $("smart-suggest").addEventListener("mousedown", (e) => e.preventDefault());
    $("smart-suggest").addEventListener("click", (e) => {
      const b = e.target.closest("[data-smart]");
      if (b) commitSmart(Number(b.dataset.smart));
    });
    $("quick-chips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-quick]");
      if (!b) return;
      addGeneric(b.dataset.quick);
      renderShopList();
      renderQuickChips();
      renderChrome();
    });
    $("open-import").addEventListener("click", () => openImport(null));
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#smart-add")) { const b = $("smart-suggest"); if (b) b.hidden = true; }
      if (e.target.closest("[data-close-sheet]") || e.target.classList.contains("sheet")) { closeSheets(); return; }
      if (e.target.closest("[data-open-import]")) { openImport(null); return; }
      const addG = e.target.closest("[data-add-generic]");
      if (addG) {
        addGeneric(addG.dataset.addGeneric);
        renderChrome();
        return;
      }
      const sw = e.target.closest("[data-swap]");
      if (sw) { openSwap(sw.dataset.swap, Number(sw.dataset.store)); return; }
      const lk = e.target.closest("[data-lock]");
      if (lk) {
        const it = state.list.find((x) => x.c === lk.dataset.for);
        if (it) { it.lock = lk.dataset.lock; saveList(); closeSheets(); renderShopList(); reopenDetails(it.c); showToast("ננעל: ייבחר רק המוצר הזה בכל הסניפים", false); }
        return;
      }
      const exb = e.target.closest("[data-exclude]");
      if (exb) {
        const it = state.list.find((x) => x.c === exb.dataset.for);
        if (it) {
          it.ex = Array.from(new Set([...(it.ex || []), exb.dataset.exclude]));
          if (it.lock === exb.dataset.exclude) it.lock = null;
          saveList(); closeSheets(); renderShopList(); reopenDetails(it.c); showToast("הוחרג: נבחר את הבא בתור", false);
        }
        return;
      }
      const pb = e.target.closest("button[data-pref]");
      if (pb) {
        const wrap = pb.closest("[data-pref-for]");
        const it = wrap && state.list.find((x) => x.c === wrap.dataset.prefFor);
        if (!it) return;
        const pref = Object.assign({}, it.pref || {});
        const k = pb.dataset.pref;
        if (k === "organic") pref.organic = pref.organic ? undefined : true;
        else if (k === "fresh") pref.form = pref.form === "fresh" ? undefined : "fresh";
        else if (k === "frozen") pref.form = pref.form === "frozen" ? undefined : "frozen";
        else if (k === "anySize") pref.anySize = pref.anySize ? undefined : true;
        else if (k === "mehadrin") pref.mehadrin = pref.mehadrin ? undefined : true;
        else if (k === "reset") { it.lock = null; it.ex = []; }
        else if (k === "edit") {
          const next = window.prompt("ניסוח הפריט (למשל: גבינה צהובה 28%)", it.g);
          if (next && next.trim()) { it.g = G.cleanLabel(next.trim()); it.lock = null; it.ex = []; }
        }
        Object.keys(pref).forEach((x) => pref[x] === undefined && delete pref[x]);
        it.pref = pref;
        saveList();
        renderShopList();
        renderChrome();
        reopenDetails(it.c);
        return;
      }
      const alt = e.target.closest("[data-imp-alt]");
      if (alt) {
        const r = state.importRows[Number(alt.dataset.impAlt)];
        const keepQty = r.qty;
        Object.assign(r, buildImportRow(alt.dataset.text), { raw: r.raw, qty: keepQty });
        renderImportRows();
        return;
      }
      const qb = e.target.closest("[data-imp-q]");
      if (qb) {
        const r = state.importRows[Number(qb.dataset.impQ)];
        r.qty = Math.max(r.res.weighed ? 0.5 : 1, Math.round((r.qty + Number(qb.dataset.d)) * 1000) / 1000);
        renderImportRows();
        return;
      }
      const del = e.target.closest("[data-imp-del]");
      if (del) { state.importRows[Number(del.dataset.impDel)].skip = true; renderImportRows(); }
    });
    document.addEventListener("change", (e) => {
      const sel = e.target.closest("select[data-pref]");
      if (sel) {
        const wrap = sel.closest("[data-pref-for]");
        const it = wrap && state.list.find((x) => x.c === wrap.dataset.prefFor);
        if (!it) return;
        it.pref = Object.assign({}, it.pref || {});
        if (sel.value) it.pref.brand = sel.value; else delete it.pref.brand;
        saveList();
        renderShopList();
        renderChrome();
        reopenDetails(it.c);
        return;
      }
      const ti = e.target.closest("[data-imp-text]");
      if (ti) {
        const r = state.importRows[Number(ti.dataset.impText)];
        const keep = r.qty;
        const nr = buildImportRow(ti.value);
        Object.assign(r, nr, { raw: r.raw, qty: G.parseItem(ti.value).qty ? nr.qty : keep });
        renderImportRows();
      }
    });
    document.addEventListener("keydown", (e) => {
      const ti = e.target.closest && e.target.closest("[data-imp-text]");
      if (ti && e.key === "Enter") { e.preventDefault(); ti.blur(); }
      if (e.key === "Escape" && document.body.classList.contains("sheet-open")) closeSheets();
    });
    $("import-parse").addEventListener("click", () => {
      const text = $("import-text").value;
      if (!text.trim()) { $("import-text").focus(); return; }
      parseImport(text);
    });
    $("import-back").addEventListener("click", () => {
      $("import-step1").hidden = false;
      $("import-step2").hidden = true;
    });
    $("import-add").addEventListener("click", commitImport);
    $("import-file").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { $("import-text").value = String(rd.result || ""); parseImport($("import-text").value); };
      rd.readAsText(f, "utf-8");
      e.target.value = "";
    });
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
    loadRecents();
    loadGfreq();
    bind();
    const sortEl = $("sort-by");
    if (sortEl) sortEl.value = state.sort;
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
      msg.textContent = "מכין התאמה בין מוצרים שקולים…";
      await new Promise((r) => setTimeout(r, 0));
      state.gindex = G.buildIndex(state.products);
      try {
        const pack = await fetchJson("data/baskets.json");
        state.baskets = (pack && pack.baskets) || [];
      } catch (e) {
        console.warn("baskets.json", e);
        state.baskets = [];
      }
      fillAbout();
      state.ready = true;
      $("boot").style.display = "none";
      $("app").classList.add("ready");
      const sp = new URLSearchParams(location.search);
      const shared = [sp.get("title"), sp.get("text"), sp.get("url")].filter(Boolean).join("\n");
      showPanel(shared || sp.has("import") ? "list" : parseHash(), { hash: true });
      if (shared || sp.has("import")) {
        history.replaceState(null, "", location.pathname + "#/list");
        openImport(shared || null);
      }
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
