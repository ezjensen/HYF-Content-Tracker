// Pure helpers (no DOM, no network) so they can be tested on their own.
export const TZ = "America/Chicago";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const dtf = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
function chicagoParts(date) {
  const o = {};
  for (const p of dtf.formatToParts(date)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute };
}
const pad = (n) => String(n).padStart(2, "0");

/** ISO string -> { date: "YYYY-MM-DD", time: "HH:MM" } in Central time */
export function toChicago(iso) {
  const p = chicagoParts(new Date(iso));
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}
/** "YYYY-MM-DD" + "HH:MM" in Central time -> Date */
export function chicagoToDate(date, time) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const target = Date.UTC(y, m - 1, d, hh, mm);
  let utc = target;
  for (let i = 0; i < 3; i++) {
    const p = chicagoParts(new Date(utc));
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    utc -= shown - target;
  }
  return new Date(utc);
}
export function fmtWhen(iso) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }).format(d);
  const tm = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(d);
  return `${day} · ${tm}`;
}
export function fmtStamp(iso) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
export function rel(iso, now = Date.now()) {
  const ms = new Date(iso) - now, a = Math.abs(ms);
  const m = Math.round(a / 60000), h = Math.round(a / 3600000), d = Math.round(a / 86400000);
  const s = m < 60 ? m + "m" : h < 48 ? h + "h" : d + "d";
  return ms < 0 ? "overdue " + s : "in " + s;
}

// ---------- search ----------
export function norm(s) {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
export function stem(w) {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s")) return w.slice(0, -1);
  return w;
}
const stemText = (s) => norm(s).split(" ").filter(Boolean).map(stem).join(" ");

/** item needs: title, kind, status, channels[], variants[], tagNames[], assigneeName, peopleNames[], notes[{body,authorName}] */
export function buildIndex(items) {
  const idx = new Map();
  for (const it of items) {
    idx.set(it.id, {
      title: stemText(it.title),
      tags: (it.tagNames || []).map(stemText),
      people: stemText([it.assigneeName, ...(it.peopleNames || [])].filter(Boolean).join(" ")),
      notes: stemText((it.notes || []).map((n) => `${n.body} ${n.authorName || ""}`).join(" ")),
      copy: stemText((it.variants || []).map((v) => `${v.label} ${v.text}`).join(" ")),
      meta: stemText(`${it.kind} ${it.status} ${(it.channels || []).join(" ")}`),
    });
  }
  return idx;
}
const WEIGHT = { title: 5, tags: 4, people: 3, notes: 2, copy: 1, meta: 1 };

export function parseQuery(q) {
  return norm(q).split(" ").filter((t) => t.length >= 2).map(stem);
}
/** returns { all: [...], some: [...], related: [...] } of {item, score, why:[...]} */
export function searchItems(q, items, index) {
  const terms = parseQuery(q);
  if (!terms.length) return { terms, all: [], some: [], related: [] };
  const scored = [];
  for (const it of items) {
    const f = index.get(it.id);
    if (!f) continue;
    let score = 0, hit = 0;
    const why = new Set();
    for (const t of terms) {
      let termHit = false;
      for (const k of ["title", "tags", "people", "notes", "copy", "meta"]) {
        const field = k === "tags" ? f.tags.join(" | ") : f[k];
        if (field.includes(t)) { score += WEIGHT[k]; termHit = true; why.add(k); }
      }
      if (termHit) hit++;
    }
    if (hit) scored.push({ item: it, score, hit, why: [...why] });
  }
  const sorter = (a, b) => b.score - a.score || new Date(a.item.scheduled_at) - new Date(b.item.scheduled_at);
  const all = scored.filter((s) => s.hit === terms.length).sort(sorter);
  const some = scored.filter((s) => s.hit < terms.length).sort((a, b) => b.hit - a.hit || sorter(a, b));
  // related: share a tag or a tagged person with the best matches
  const seen = new Set([...all, ...some].map((s) => s.item.id));
  const seedItems = all.slice(0, 5).map((s) => s.item);
  const tagSet = new Set(seedItems.flatMap((i) => i.tagNames || []).map((t) => t.toLowerCase()));
  const related = [];
  if (tagSet.size) {
    for (const it of items) {
      if (seen.has(it.id)) continue;
      const shared = (it.tagNames || []).filter((t) => tagSet.has(t.toLowerCase()));
      if (shared.length) related.push({ item: it, score: shared.length, why: ["related tag: " + shared[0]] });
    }
    related.sort((a, b) => b.score - a.score || new Date(a.item.scheduled_at) - new Date(b.item.scheduled_at));
  }
  return { terms, all, some, related: related.slice(0, 8) };
}
