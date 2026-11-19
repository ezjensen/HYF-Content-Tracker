import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { esc, toChicago, chicagoToDate, fmtWhen, fmtStamp, rel, buildIndex, searchItems, parseQuery, norm } from "./lib.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (s, r = document) => r.querySelector(s);
const root = $("#root");
const modalHost = $("#modal");

const S = {
  me: null, profiles: [], items: [], notes: [], tags: [], itemTags: [], itemPeople: [], profileTags: [], invites: [],
  tab: "todo", q: "", fAssignee: "", fTag: "", open: new Set(), modal: null, menu: false, loaded: false,
  bootedFor: null, alerted: new Set(), channel: null, pollTimer: null,
};
const EMOJIS = ["🏈","🔥","💪","🛡️","🏆","⭐","📣","📅","📧","🎯","🦅","🐺","🦁","🐯","🐻","🦊","😀","😎","🤩","🥳","👍","🙌","❤️","🖤","🔴","⚫","🎉","📸","✍️","🧢","🏟️","📋","⚡","🚀","🌟","🍕","☕","🎽","🥇","👑"];

// ---------- small helpers ----------
const safeUrl = (u) => (/^https:\/\//.test(u || "") ? u : "");
let toastT;
function toast(t) { const el = $("#toast"); el.textContent = t; el.style.display = "block"; clearTimeout(toastT); toastT = setTimeout(() => (el.style.display = "none"), 2200); }
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const redirectUrl = () => location.origin + location.pathname;
const profById = (id) => S.profiles.find((p) => p.id === id);
const members = () => S.profiles.filter((p) => p.role === "member" || p.role === "admin");
const isAdmin = () => S.me && S.me.role === "admin";
const pName = (p) => (p ? p.display_name || p.email.split("@")[0] : "");

function avatar(p, size = 28) {
  const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.55)}px`;
  if (!p) return `<span class="av" style="${st}">?</span>`;
  if (safeUrl(p.avatar_url)) return `<span class="av" style="${st}"><img src="${esc(p.avatar_url)}" alt=""></span>`;
  if (p.avatar_emoji) return `<span class="av" style="${st};background:#2a1215">${esc(p.avatar_emoji)}</span>`;
  return `<span class="av" style="${st}">${esc((pName(p) || "?").trim().charAt(0).toUpperCase())}</span>`;
}

// ---------- auth screens ----------
function showLogin(msg, kind) {
  S.me = null; S.loaded = false; S.bootedFor = null;
  clearInterval(S.pollTimer);
  if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
  const hashErr = new URLSearchParams(location.hash.replace(/^#/, "")).get("error_description");
  if (!msg && hashErr) { msg = hashErr.replace(/\+/g, " "); kind = "err"; }
  root.innerHTML = `
  <div class="login"><div class="box">
    <img class="big" src="icons/icon-192.png" alt="HYF">
    <h1>HYF <span>Content Tracker</span></h1>
    <p class="sub">Huntley Youth Football · posts, emails &amp; reminders</p>
    <div class="stack">
      <button class="btn wide" data-a="oauth" data-p="google">Continue with Google</button>
      <button class="btn wide" data-a="oauth" data-p="apple">Continue with Apple</button>
    </div>
    <div class="or">or use your email</div>
    <input id="em" type="email" placeholder="you@example.com" autocomplete="email" style="margin-bottom:10px">
    <button class="btn pri wide" data-a="magic">Email me a sign-in link</button>
    <div class="msg ${kind || ""}" id="loginMsg">${esc(msg || "")}</div>
  </div></div>`;
}
function setLoginMsg(t, kind) { const el = $("#loginMsg"); if (el) { el.textContent = t; el.className = "msg " + (kind || ""); } }

function showPending(me) {
  root.innerHTML = `<div class="center"><div class="box">
    <img src="icons/icon-192.png" width="72" height="72" style="border-radius:16px" alt="">
    <h2 style="margin:14px 0 6px">Almost there, ${esc(pName(me))}!</h2>
    <p class="sub" style="color:var(--mut)">Your account (${esc(me.email)}) is waiting for approval from an HYF admin. You'll get in as soon as you're approved.</p>
    <div class="row2" style="justify-content:center;margin-top:16px">
      <button class="btn pri" data-a="recheck">Check again</button>
      <button class="btn" data-a="signout">Sign out</button>
    </div></div></div>`;
  clearInterval(S.pollTimer);
  S.pollTimer = setInterval(recheck, 20000);
}
function showBlocked() {
  root.innerHTML = `<div class="center"><div class="box"><h2>No access</h2><p style="color:var(--mut)">This account doesn't have access to the HYF tracker.</p><button class="btn" data-a="signout">Sign out</button></div></div>`;
}
function showError(t) {
  root.innerHTML = `<div class="center"><div class="box"><h2>Something went wrong</h2><p style="color:var(--mut)">${esc(t)}</p><div class="row2" style="justify-content:center"><button class="btn pri" data-a="reload">Try again</button><button class="btn" data-a="signout">Sign out</button></div></div></div>`;
}

async function boot(session) {
  if (S.bootedFor === session.user.id && S.loaded) return;
  S.bootedFor = session.user.id;
  if (location.hash.includes("access_token") || location.hash.includes("error")) history.replaceState(null, "", location.pathname + location.search);
  root.innerHTML = `<div class="center"><div class="spin">Loading…</div></div>`;
  const { data, error } = await sb.rpc("hyf_register");
  if (error || !data) { showError(error ? error.message : "Could not load your profile."); return; }
  S.me = data;
  if (data.role === "pending") return showPending(data);
  if (data.role === "blocked") return showBlocked();
  await startApp();
}
async function recheck() {
  const { data } = await sb.rpc("hyf_register");
  if (data && (data.role === "member" || data.role === "admin")) { clearInterval(S.pollTimer); S.me = data; await startApp(); }
  else if (data && data.role === "blocked") showBlocked();
  else toast("Still waiting for approval");
}

// ---------- data ----------
async function reload() {
  const q = (t, o) => { let r = sb.from(t).select("*"); if (o) r = r.order(o); return r; };
  const [p, i, n, t, it, ip, pt] = await Promise.all([
    q("hyf_profiles", "display_name"), q("hyf_items", "scheduled_at"), q("hyf_notes", "created_at"), q("hyf_tags", "name"),
    q("hyf_item_tags"), q("hyf_item_people"), q("hyf_profile_tags"),
  ]);
  const err = [p, i, n, t, it, ip, pt].find((r) => r.error);
  if (err) { toast("Couldn't load: " + err.error.message); return; }
  S.profiles = p.data; S.items = i.data; S.notes = n.data; S.tags = t.data; S.itemTags = it.data; S.itemPeople = ip.data; S.profileTags = pt.data;
  const mine = S.profiles.find((x) => x.id === S.me.id);
  if (mine) S.me = mine;
  if (isAdmin()) { const inv = await sb.from("hyf_invites").select("*").order("email"); S.invites = inv.data || []; }
  S.loaded = true;
  decorate();
  renderMe(); renderBanner(); renderBar(); renderList();
  if (S.modal && S.modal.type === "team") renderModal();
  if (S.modal && S.modal.type === "item" && S.modal.id) renderNotesBox();
}
const reloadSoon = debounce(reload, 350);
async function autoDone() {
  const r = await sb.from("hyf_items").update({ status: "done" }).eq("status", "scheduled").lte("scheduled_at", new Date().toISOString()).select("id");
  if (!r.error && r.data && r.data.length) reload();
}

function decorate() {
  const tagById = new Map(S.tags.map((t) => [t.id, t]));
  S.profileTagNames = new Map();
  for (const r of S.profileTags) {
    const t = tagById.get(r.tag_id); if (!t) continue;
    if (!S.profileTagNames.has(r.profile_id)) S.profileTagNames.set(r.profile_id, []);
    S.profileTagNames.get(r.profile_id).push(t.name);
  }
  for (const it of S.items) {
    it.tagNames = S.itemTags.filter((x) => x.item_id === it.id).map((x) => tagById.get(x.tag_id)?.name).filter(Boolean);
    it.peopleIds = S.itemPeople.filter((x) => x.item_id === it.id).map((x) => x.profile_id);
    const a = profById(it.assignee_id);
    it.assigneeName = pName(a);
    it.peopleNames = it.peopleIds.map((id) => pName(profById(id))).filter(Boolean);
    // people tags also make an item findable (e.g. "coach")
    const ptags = [a?.id, ...it.peopleIds].filter(Boolean).flatMap((id) => S.profileTagNames.get(id) || []);
    it.peopleNames = [...it.peopleNames, ...ptags];
    it.notesList = S.notes.filter((x) => x.item_id === it.id).map((x) => ({ ...x, authorName: pName(profById(x.author_id)) }));
    it.notes = it.notesList;
  }
  S.index = buildIndex(S.items);
}

async function ensureTag(name) {
  const clean = name.trim().replace(/^#/, "");
  const hit = S.tags.find((t) => t.name.toLowerCase() === clean.toLowerCase());
  if (hit) return hit;
  const { data, error } = await sb.from("hyf_tags").insert({ name: clean }).select().single();
  if (error) {
    const { data: ex } = await sb.from("hyf_tags").select("*").ilike("name", clean).limit(1);
    if (ex && ex[0]) { S.tags.push(ex[0]); return ex[0]; }
    throw error;
  }
  S.tags.push(data); return data;
}
async function syncJoin(table, keyCol, keyVal, otherCol, wanted, current) {
  const toDel = current.filter((x) => !wanted.includes(x));
  const toAdd = wanted.filter((x) => !current.includes(x));
  if (toDel.length) { const r = await sb.from(table).delete().eq(keyCol, keyVal).in(otherCol, toDel); if (r.error) throw r.error; }
  if (toAdd.length) { const r = await sb.from(table).insert(toAdd.map((x) => ({ [keyCol]: keyVal, [otherCol]: x }))); if (r.error) throw r.error; }
}
async function syncItemTags(itemId, names) {
  const seen = new Set(), ids = [];
  for (const n of names) { const k = n.toLowerCase(); if (!n.trim() || seen.has(k)) continue; seen.add(k); ids.push((await ensureTag(n)).id); }
  await syncJoin("hyf_item_tags", "item_id", itemId, "tag_id", ids, S.itemTags.filter((x) => x.item_id === itemId).map((x) => x.tag_id));
}
async function syncProfileTags(profileId, names) {
  const seen = new Set(), ids = [];
  for (const n of names) { const k = n.toLowerCase(); if (!n.trim() || seen.has(k)) continue; seen.add(k); ids.push((await ensureTag(n)).id); }
  await syncJoin("hyf_profile_tags", "profile_id", profileId, "tag_id", ids, S.profileTags.filter((x) => x.profile_id === profileId).map((x) => x.tag_id));
}

// ---------- app shell ----------
async function startApp() {
  clearInterval(S.pollTimer);
  root.innerHTML = `
  <div class="top"><div class="topin">
    <div class="brand"><img src="icons/logo-128.png" alt="HYF"><b>HYF <span>Tracker</span></b></div>
    <div class="search"><input id="q" type="search" placeholder="Search posts, notes, tags, people…" autocomplete="off"></div>
    <button class="me" id="meBtn" data-a="menu" aria-label="Account"></button>
  </div></div>
  <div id="menuHost"></div>
  <div class="wrap">
    <div id="banner"></div>
    <div id="bar"></div>
    <div id="list"><div class="empty spin">Loading…</div></div>
    <div class="note">Mark items Scheduled once they are queued up in your posting or email tool. They flip to Done by themselves when their time passes. Mark Done when posted by hand, Archive to tuck them away, or Remove to drop them (Removed items can be restored). Alerts appear here and as notifications while this page is open.</div>
  </div>`;
  $("#q").addEventListener("input", debounce((e) => { S.q = e.target.value; renderList(); }, 120));
  renderMe();
  await reload();
  subscribe();
  if (!startApp.timer) startApp.timer = setInterval(() => { if (S.loaded && S.me) { renderBanner(); renderList(); checkAlerts(); autoDone(); } }, 30000);
  checkAlerts();
  autoDone();
}
function subscribe() {
  if (S.channel) return;
  let ch = sb.channel("hyf-live");
  for (const t of ["hyf_items", "hyf_notes", "hyf_tags", "hyf_item_tags", "hyf_item_people", "hyf_profiles", "hyf_profile_tags", "hyf_invites"]) {
    ch = ch.on("postgres_changes", { event: "*", schema: "public", table: t }, reloadSoon);
  }
  ch.subscribe(); S.channel = ch;
}

function renderMe() {
  const b = $("#meBtn"); if (b) b.innerHTML = avatar(S.me, 38);
  renderMenu();
}
function renderMenu() {
  const host = $("#menuHost"); if (!host) return;
  if (!S.menu) { host.innerHTML = ""; return; }
  const pending = S.profiles.filter((p) => p.role === "pending").length;
  const canNotify = "Notification" in window && Notification.permission === "default";
  host.innerHTML = `<div class="menu" id="menuBox">
    <div class="who"><b style="color:var(--txt)">${esc(pName(S.me))}</b><br>${esc(S.me.email)} · ${esc(S.me.role)}</div>
    <button data-a="profile">✏️ Edit my profile</button>
    ${isAdmin() ? `<button data-a="team">👥 Team &amp; access${pending ? ` <span class="pill pending">${pending} waiting</span>` : ""}</button>` : ""}
    ${canNotify ? `<button data-a="notify">🔔 Turn on notifications</button>` : ""}
    <button data-a="signout">Sign out</button></div>`;
}

// ---------- banner / bar ----------
function cls(it) {
  if (it.status !== "todo") return it.status;
  const ms = new Date(it.scheduled_at) - Date.now();
  return ms <= 0 ? "due" : ms <= 3 * 3600e3 ? "soon" : "";
}
function renderBanner() {
  const el = $("#banner"); if (!el) return;
  const sched = S.items.filter((i) => i.status === "todo").sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const due = sched.filter((i) => new Date(i.scheduled_at) <= Date.now());
  document.title = (due.length ? `(${due.length}) ` : "") + "HYF Content Tracker";
  if (due.length) {
    el.innerHTML = `<div class="banner due"><div class="row"><b>⏰ ${due.length} item${due.length > 1 ? "s" : ""} due now</b></div>` +
      due.slice(0, 6).map((i) => `<div class="row"><span>${esc(i.title)} <span style="color:var(--mut)">(${esc(fmtWhen(i.scheduled_at))})${i.assigneeName ? " · " + esc(i.assigneeName) : ""}</span></span><button class="btn sm" data-a="jump" data-id="${i.id}">Open</button></div>`).join("") + `</div>`;
  } else if (sched.length) {
    const n = sched[0];
    el.innerHTML = `<div class="banner"><div class="row"><span>Next up: <b>${esc(n.title)}</b> · ${esc(fmtWhen(n.scheduled_at))} <span style="color:var(--mut)">(${rel(n.scheduled_at)})</span>${n.assigneeName ? " · " + esc(n.assigneeName) : ""}</span><button class="btn sm" data-a="jump" data-id="${n.id}">Open</button></div></div>`;
  } else el.innerHTML = "";
}

function passFilters(it) {
  if (S.fTag && !(it.tagNames || []).some((t) => t.toLowerCase() === S.fTag.toLowerCase())) return false;
  const a = S.fAssignee;
  if (a === "me") return it.assignee_id === S.me.id || it.peopleIds.includes(S.me.id);
  if (a === "none") return !it.assignee_id;
  if (a) return it.assignee_id === a || it.peopleIds.includes(a);
  return true;
}
function renderBar() {
  const el = $("#bar"); if (!el) return;
  const base = S.items.filter(passFilters);
  const count = (s) => base.filter((i) => i.status === s).length;
  const tabs = [["todo", "To do", count("todo")], ["scheduled", "Scheduled", count("scheduled")], ["done", "Done", count("done")], ["archived", "Archived", count("archived")], ["removed", "Removed", count("removed")], ["all", "All", base.length]];
  const people = members();
  el.innerHTML = `
  <div class="bar">
    <div class="tabs">${tabs.map(([k, n, c]) => `<button class="tab ${S.tab === k ? "on" : ""}" data-a="tab" data-k="${k}">${n} (${c})</button>`).join("")}</div>
    <button class="btn pri" data-a="new">+ New post / email</button>
  </div>
  <div class="filters">
    <select data-a="fassignee" aria-label="Filter by person">
      <option value="">Everyone</option><option value="me" ${S.fAssignee === "me" ? "selected" : ""}>Mine</option>
      <option value="none" ${S.fAssignee === "none" ? "selected" : ""}>Unassigned</option>
      ${people.map((p) => `<option value="${p.id}" ${S.fAssignee === p.id ? "selected" : ""}>${esc(pName(p))}</option>`).join("")}
    </select>
    <select data-a="ftag" aria-label="Filter by tag">
      <option value="">All tags</option>
      ${[...S.tags].sort((a, b) => a.name.localeCompare(b.name)).map((t) => `<option ${S.fTag.toLowerCase() === t.name.toLowerCase() ? "selected" : ""}>${esc(t.name)}</option>`).join("")}
    </select>
  </div>`;
}

// ---------- list / cards ----------
function peopleHtml(it) {
  const a = profById(it.assignee_id);
  const first = a ? `<span class="person" data-a="person" data-id="${a.id}" title="Assigned to">${avatar(a, 22)} ${esc(pName(a))}</span>` : `<span class="person unassigned" data-a="edit" data-id="${it.id}">+ Assign</span>`;
  const others = it.peopleIds.filter((id) => id !== it.assignee_id).map((id) => profById(id)).filter(Boolean)
    .map((p) => `<span class="person" data-a="person" data-id="${p.id}" title="Tagged">${avatar(p, 22)} ${esc(pName(p))}</span>`).join("");
  return `<div class="people">${first}${others}</div>`;
}
function cardHtml(it, why) {
  const c = cls(it), open = S.open.has(it.id);
  const relTag = it.status === "todo" ? `<span class="rel ${c}">${rel(it.scheduled_at)}</span>` : it.status === "scheduled" ? `<span class="rel sched">📅 scheduled · goes out ${rel(it.scheduled_at)}</span>` : `<span class="rel">${it.status}</span>`;
  const acts = it.status === "todo"
    ? `<button class="btn sched sm" data-a="status" data-s="scheduled" data-id="${it.id}">📅 Mark scheduled</button><button class="btn ok sm" data-a="status" data-s="done" data-id="${it.id}">✓ Mark done</button><button class="btn sm" data-a="status" data-s="archived" data-id="${it.id}">Archive</button><button class="btn sm" data-a="status" data-s="removed" data-id="${it.id}">Remove</button>`
    : it.status === "removed"
      ? `<button class="btn sm" data-a="status" data-s="todo" data-id="${it.id}">Restore</button>${isAdmin() ? `<button class="btn sm danger" data-a="purge" data-id="${it.id}">Delete forever</button>` : ""}`
      : `<button class="btn sm" data-a="status" data-s="todo" data-id="${it.id}">Move back to To do</button><button class="btn sm" data-a="status" data-s="removed" data-id="${it.id}">Remove</button>`;
  const vars = open ? (it.variants || []).map((v, vi) => `<div class="var"><h4><span>${esc(v.label)}</span><button class="btn sm" data-a="copy" data-id="${it.id}" data-vi="${vi}">Copy</button></h4><pre>${esc(v.text)}</pre></div>`).join("") : "";
  const nn = it.notesList.length;
  return `<div class="card ${c}" id="c-${it.id}">
    <div><span class="when">${esc(fmtWhen(it.scheduled_at))}</span>${relTag}</div>
    <div class="ctitle" data-a="edit" data-id="${it.id}">${esc(it.title)}</div>
    <div class="chips">${(it.channels || []).map((ch) => `<span class="chip ${it.kind === "email" ? "email" : ""}">${esc(ch)}</span>`).join("")}
      ${(it.tagNames || []).map((t) => `<button class="chip tag" data-a="tag" data-t="${esc(t)}">#${esc(t)}</button>`).join("")}</div>
    ${peopleHtml(it)}
    ${why && why.length ? `<div class="chips" style="margin-top:8px">${why.map((w) => `<span class="chip why">${esc(w)}</span>`).join("")}</div>` : ""}
    <div class="acts"><button class="btn sm" data-a="toggle" data-id="${it.id}">${open ? "Hide copy" : "Show copy"}</button>
      <button class="btn sm" data-a="edit" data-id="${it.id}">Edit${nn ? ` · 💬 ${nn}` : " · notes"}</button>${acts}</div>
    ${vars}</div>`;
}
const WHY = { title: "title", tags: "tag", people: "person", notes: "notes", copy: "copy text", meta: "type/channel" };

function renderList() {
  const el = $("#list"); if (!el) return;
  if (!S.loaded) return;
  if (!S.items.length) {
    el.innerHTML = `<div class="empty">No posts yet.<br><br>${isAdmin() ? `<button class="btn pri" data-a="seed">Import the Tackle Equipment Return schedule (13 items)</button><br><br>` : ""}<button class="btn" data-a="new">+ New post / email</button></div>`;
    return;
  }
  const q = S.q.trim();
  if (q) return renderSearch(el, q);
  let list = S.items.filter(passFilters);
  if (S.tab !== "all") list = list.filter((i) => i.status === S.tab);
  list.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  el.innerHTML = list.length ? list.map((i) => cardHtml(i)).join("") : `<div class="empty">Nothing here.</div>`;
}
function renderSearch(el, q) {
  const r = searchItems(q, S.items.filter(passFilters), S.index);
  const terms = parseQuery(q);
  const peopleHits = S.profiles.filter((p) => p.role !== "pending" && terms.some((t) => norm(pName(p) + " " + p.email + " " + (S.profileTagNames.get(p.id) || []).join(" ")).includes(t)));
  const tagHits = S.tags.filter((t) => terms.some((x) => norm(t.name).includes(x)));
  const why = (s) => s.why.map((w) => WHY[w] || w);
  const total = r.all.length + r.some.length;
  let html = `<div class="sechead">${total} result${total === 1 ? "" : "s"} for “${esc(q)}”</div>`;
  if (peopleHits.length || tagHits.length) {
    html += `<div class="found">${peopleHits.map((p) => `<span class="person" data-a="person" data-id="${p.id}">${avatar(p, 22)} ${esc(pName(p))}</span>`).join("")}${tagHits.map((t) => `<button class="chip tag" data-a="tag" data-t="${esc(t.name)}">#${esc(t.name)}</button>`).join("")}</div>`;
  }
  if (r.all.length) html += r.all.map((s) => cardHtml(s.item, why(s))).join("");
  if (r.some.length) html += `<div class="sechead">Partial matches</div>` + r.some.map((s) => cardHtml(s.item, why(s))).join("");
  if (r.related.length) html += `<div class="sechead">Related (shared tags)</div>` + r.related.map((s) => cardHtml(s.item, s.why)).join("");
  if (!total && !r.related.length && !peopleHits.length && !tagHits.length) html += `<div class="empty">No matches. Try fewer or different words.</div>`;
  el.innerHTML = html;
}

// ---------- modals ----------
function closeModal() { S.modal = null; modalHost.innerHTML = ""; }
function renderModal() {
  const m = S.modal; if (!m) { modalHost.innerHTML = ""; return; }
  modalHost.innerHTML = `<div class="ov" data-a="ovclick"><div class="sheet" id="sheet">${m.type === "item" ? itemSheet() : m.type === "profile" ? profileSheet() : teamSheet()}</div></div>`;
  if (m.type === "item" && m.id) renderNotesBox();
}
function openItem(id) {
  const it = id ? S.items.find((x) => x.id === id) : null;
  let d;
  if (it) {
    const c = toChicago(it.scheduled_at);
    d = { title: it.title, kind: it.kind, date: c.date, time: c.time, channels: (it.channels || []).join(", "), assignee_id: it.assignee_id || "", people: new Set(it.peopleIds), tags: [...(it.tagNames || [])], variants: (it.variants || []).map((v) => ({ ...v })) };
  } else {
    const c = toChicago(new Date(Date.now() + 86400000).toISOString());
    d = { title: "", kind: "social", date: c.date, time: "18:00", channels: "FB, IG", assignee_id: S.me.id, people: new Set(), tags: [], variants: [{ label: "Facebook / Instagram", text: "" }] };
  }
  S.modal = { type: "item", id: id || null, draft: d };
  renderModal();
}
function syncDraft() {
  const m = S.modal; if (!m || m.type !== "item") return;
  const g = (id) => $("#" + id)?.value ?? "";
  const d = m.draft;
  d.title = g("f_title"); d.kind = g("f_kind"); d.channels = g("f_channels"); d.date = g("f_date"); d.time = g("f_time"); d.assignee_id = g("f_assignee");
  d.people = new Set([...document.querySelectorAll('input[name="ppl"]:checked')].map((x) => x.value));
  const pend = g("f_tagin").trim().replace(/^#/, "").replace(/,$/, "");
  if (pend && !d.tags.some((t) => t.toLowerCase() === pend.toLowerCase())) d.tags.push(pend);
  if ($("#f_tagin")) $("#f_tagin").value = "";
  d.variants = [...document.querySelectorAll(".varedit")].map((el) => ({ label: el.querySelector(".vl").value, text: el.querySelector(".vt").value }));
}
function itemSheet() {
  const m = S.modal, d = m.draft, it = m.id ? S.items.find((x) => x.id === m.id) : null;
  const people = members();
  const statusBtns = it ? `<div class="row2" style="margin-top:14px">${it.status !== "done" ? `<button class="btn ok sm" data-a="mstatus" data-s="done">✓ Mark done</button>` : ""}${it.status !== "scheduled" ? `<button class="btn sched sm" data-a="mstatus" data-s="scheduled">📅 Mark scheduled</button>` : ""}${it.status !== "todo" ? `<button class="btn sm" data-a="mstatus" data-s="todo">Move to To do</button>` : ""}${it.status !== "archived" ? `<button class="btn sm" data-a="mstatus" data-s="archived">Archive</button>` : ""}${it.status !== "removed" ? `<button class="btn sm" data-a="mstatus" data-s="removed">Remove</button>` : ""}${isAdmin() ? `<button class="btn sm danger" data-a="mpurge">Delete forever</button>` : ""}</div>` : "";
  return `
  <div class="hd"><h2>${it ? "Edit post / email" : "New post / email"}</h2><button class="btn sm" data-a="close">✕</button></div>
  <label>Title</label><input id="f_title" value="${esc(d.title)}" placeholder="e.g. Picture Day reminder">
  <div class="grid2">
    <div><label>Type</label><select id="f_kind"><option value="social" ${d.kind === "social" ? "selected" : ""}>Social post</option><option value="email" ${d.kind === "email" ? "selected" : ""}>Email</option></select></div>
    <div><label>Channels (comma separated)</label><input id="f_channels" value="${esc(d.channels)}"></div>
    <div><label>Date (Central)</label><input id="f_date" type="date" value="${esc(d.date)}"></div>
    <div><label>Time (Central)</label><input id="f_time" type="time" value="${esc(d.time)}"></div>
  </div>
  <label>Assigned to</label>
  <select id="f_assignee"><option value="">Unassigned</option>${people.map((p) => `<option value="${p.id}" ${d.assignee_id === p.id ? "selected" : ""}>${esc(pName(p))}</option>`).join("")}</select>
  <label>Also tag people</label>
  <div class="pick">${people.map((p) => `<label><input type="checkbox" name="ppl" value="${p.id}" ${d.people.has(p.id) ? "checked" : ""}>${avatar(p, 20)} ${esc(pName(p))}</label>`).join("") || `<span style="color:var(--mut)">No team members yet.</span>`}</div>
  <label>Tags</label>
  <div class="tagbox">${d.tags.map((t, i) => `<span class="tagchip">#${esc(t)}<button data-a="deltag" data-i="${i}" aria-label="Remove tag">×</button></span>`).join("")}
    <input id="f_tagin" list="taglist" placeholder="Add a tag, press Enter"></div>
  <datalist id="taglist">${S.tags.map((t) => `<option value="${esc(t.name)}">`).join("")}</datalist>
  <label>Copy (one version per platform)</label>
  <div id="vars">${d.variants.map((v, i) => `<div class="varedit"><div class="vh"><input class="vl" value="${esc(v.label)}" placeholder="Label, e.g. Facebook / Instagram"><button class="btn sm" data-a="delvar" data-i="${i}">Remove</button></div><textarea class="vt" placeholder="Paste the post or email text">${esc(v.text)}</textarea></div>`).join("")}</div>
  <div style="margin-top:8px"><button class="btn sm" data-a="addvar">+ Add a version</button></div>
  <div class="row2" style="margin-top:16px"><button class="btn pri" data-a="saveitem">Save</button><button class="btn" data-a="close">Cancel</button></div>
  ${statusBtns}
  ${it ? `<div class="notes"><h3 style="font-size:15px">Notes</h3><div id="notesBox"></div></div>` : `<p class="msg">Save first, then you can add notes.</p>`}`;
}
function renderNotesBox() {
  const box = $("#notesBox"); if (!box || !S.modal || !S.modal.id) return;
  const it = S.items.find((x) => x.id === S.modal.id); if (!it) return;
  const draftVal = $("#noteIn")?.value || "";
  box.innerHTML = (it.notesList.length ? it.notesList.map((n) => {
    const a = profById(n.author_id);
    const canDel = n.author_id === S.me.id || isAdmin();
    return `<div class="nt">${avatar(a, 28)}<div class="b"><div class="m"><span>${esc(pName(a) || "Former member")} · ${esc(fmtStamp(n.created_at))}</span>${canDel ? `<button class="btn sm" data-a="delnote" data-id="${n.id}">Delete</button>` : ""}</div>${esc(n.body)}</div></div>`;
  }).join("") : `<p class="msg">No notes yet.</p>`) +
    `<textarea id="noteIn" placeholder="Add a note…" style="min-height:70px;margin-top:8px">${esc(draftVal)}</textarea><div style="margin-top:6px"><button class="btn pri sm" data-a="addnote">Add note</button></div>`;
}

async function saveItem() {
  syncDraft();
  const m = S.modal, d = m.draft;
  if (!d.title.trim()) return toast("Add a title");
  if (!d.date || !d.time) return toast("Pick a date and time");
  const row = {
    title: d.title.trim(), kind: d.kind, scheduled_at: chicagoToDate(d.date, d.time).toISOString(),
    channels: d.channels.split(",").map((s) => s.trim()).filter(Boolean),
    variants: d.variants.filter((v) => v.text.trim() || v.label.trim()).map((v) => ({ label: v.label.trim() || "Text", text: v.text })),
    assignee_id: d.assignee_id || null,
  };
  try {
    let id = m.id;
    if (id) { const r = await sb.from("hyf_items").update(row).eq("id", id); if (r.error) throw r.error; }
    else { row.created_by = S.me.id; const r = await sb.from("hyf_items").insert(row).select("id").single(); if (r.error) throw r.error; id = r.data.id; }
    await syncItemTags(id, d.tags);
    await syncJoin("hyf_item_people", "item_id", id, "profile_id", [...d.people], S.itemPeople.filter((x) => x.item_id === id).map((x) => x.profile_id));
    closeModal(); await reload(); toast("Saved");
  } catch (e) { toast("Couldn't save: " + (e.message || e)); }
}
async function setStatus(id, status) {
  const r = await sb.from("hyf_items").update({ status }).eq("id", id);
  if (r.error) return toast("Couldn't update: " + r.error.message);
  await reload();
}

// ----- profile modal
function openProfile() {
  S.menu = false; renderMenu();
  S.modal = { type: "profile", draft: { name: S.me.display_name || "", emoji: S.me.avatar_emoji || "", url: S.me.avatar_url || "", tags: [...(S.profileTagNames.get(S.me.id) || [])] } };
  renderModal();
}
function profileSheet() {
  const d = S.modal.draft;
  const prev = { ...S.me, display_name: d.name || S.me.display_name, avatar_emoji: d.emoji, avatar_url: d.url };
  return `
  <div class="hd"><h2>My profile</h2><button class="btn sm" data-a="close">✕</button></div>
  <div class="prof"><div id="avprev">${avatar(prev, 72)}</div><div style="color:var(--mut);font-size:13px">${esc(S.me.email)}</div></div>
  <label>Display name</label><input id="p_name" value="${esc(d.name)}">
  <label>Picture</label>
  <div class="row2"><input id="p_file" type="file" accept="image/*" style="max-width:260px"><button class="btn sm" data-a="clearphoto">Remove photo</button></div>
  <label>…or pick an emoji (used when there's no photo)</label>
  <div class="emo">${EMOJIS.map((e) => `<button data-a="emoji" data-e="${e}" class="${d.emoji === e ? "on" : ""}">${e}</button>`).join("")}</div>
  <div class="row2" style="margin-top:8px"><input id="p_emoji" value="${esc(d.emoji)}" maxlength="8" placeholder="Or type any emoji" style="max-width:200px"><button class="btn sm" data-a="clearemoji">Clear</button></div>
  <label>My tags (e.g. Coach, Photographer, Parent rep)</label>
  <div class="tagbox">${d.tags.map((t, i) => `<span class="tagchip">#${esc(t)}<button data-a="delptag" data-i="${i}">×</button></span>`).join("")}<input id="p_tagin" list="taglist" placeholder="Add a tag, press Enter"></div>
  <datalist id="taglist">${S.tags.map((t) => `<option value="${esc(t.name)}">`).join("")}</datalist>
  <div class="row2" style="margin-top:16px"><button class="btn pri" data-a="saveprofile">Save</button><button class="btn" data-a="close">Cancel</button></div>`;
}
function syncProfileDraft() {
  const d = S.modal?.draft; if (!d || S.modal.type !== "profile") return;
  d.name = $("#p_name")?.value ?? d.name;
  const em = $("#p_emoji"); if (em) d.emoji = em.value.trim();
  const pend = ($("#p_tagin")?.value || "").trim().replace(/^#/, "").replace(/,$/, "");
  if (pend && !d.tags.some((t) => t.toLowerCase() === pend.toLowerCase())) d.tags.push(pend);
  if ($("#p_tagin")) $("#p_tagin").value = "";
}
async function resizeToBlob(file, size = 256) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const c = document.createElement("canvas"); c.width = c.height = size;
  c.getContext("2d").drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return await new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
}
async function uploadAvatar(file) {
  try {
    toast("Uploading…");
    const blob = await resizeToBlob(file);
    const path = `${S.me.id}/avatar-${Date.now()}.jpg`;
    const up = await sb.storage.from("hyf-avatars").upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (up.error) throw up.error;
    const { data } = sb.storage.from("hyf-avatars").getPublicUrl(path);
    syncProfileDraft(); S.modal.draft.url = data.publicUrl; renderModal(); toast("Photo ready — press Save");
  } catch (e) { toast("Upload failed: " + (e.message || e)); }
}
async function saveProfile() {
  syncProfileDraft();
  const d = S.modal.draft;
  try {
    const r = await sb.from("hyf_profiles").update({ display_name: d.name.trim() || S.me.display_name, avatar_emoji: d.emoji || null, avatar_url: d.url || null }).eq("id", S.me.id);
    if (r.error) throw r.error;
    await syncProfileTags(S.me.id, d.tags);
    closeModal(); await reload(); toast("Profile saved");
  } catch (e) { toast("Couldn't save: " + (e.message || e)); }
}

// ----- team modal (admin)
function openTeam() { S.menu = false; renderMenu(); S.modal = { type: "team" }; renderModal(); }
function teamSheet() {
  const sorted = [...S.profiles].sort((a, b) => (a.role === "pending" ? -1 : 0) - (b.role === "pending" ? -1 : 0) || pName(a).localeCompare(pName(b)));
  return `
  <div class="hd"><h2>Team &amp; access</h2><button class="btn sm" data-a="close">✕</button></div>
  <p class="msg" style="margin-top:0">People who sign in land on “pending” until an admin approves them. Only members and admins can see the tracker.</p>
  ${sorted.map((p) => `<div class="trow">${avatar(p, 34)}<div class="grow"><div class="nm">${esc(pName(p))} ${p.id === S.me.id ? '<span class="pill">you</span>' : ""}</div><div class="em">${esc(p.email)}${(S.profileTagNames.get(p.id) || []).length ? " · " + esc((S.profileTagNames.get(p.id) || []).map((t) => "#" + t).join(" ")) : ""}</div></div>
    ${p.role === "pending" ? `<button class="btn ok sm" data-a="setrole" data-id="${p.id}" data-r="member">Approve</button>` : ""}
    <select data-a="rolesel" data-id="${p.id}" aria-label="Role">${["pending", "member", "admin", "blocked"].map((r) => `<option ${p.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>`).join("")}
  <label style="margin-top:18px">Pre-approve by email</label>
  <div class="row2"><input id="inv_email" type="email" placeholder="coach@example.com" style="flex:1;min-width:180px"><select id="inv_role" style="width:auto"><option>member</option><option>admin</option></select><button class="btn pri sm" data-a="addinvite">Add</button></div>
  ${S.invites.length ? S.invites.map((i) => `<div class="trow"><div class="grow"><div class="nm">${esc(i.email)}</div></div><span class="pill ${i.role === "admin" ? "admin" : ""}">${esc(i.role)}</span><button class="btn sm" data-a="delinvite" data-e="${esc(i.email)}">Remove</button></div>`).join("") : ""}
  <label style="margin-top:18px">Starter content</label>
  <button class="btn sm" data-a="seed">Import the Tackle Equipment Return schedule</button>`;
}
async function importSeed() {
  try {
    const seed = await (await fetch("data/seed.json", { cache: "no-store" })).json();
    const have = new Set(S.items.map((i) => i.seed_key).filter(Boolean));
    const fresh = seed.filter((s) => !have.has(s.seed_key));
    if (!fresh.length) return toast("Already imported");
    const rows = fresh.map(({ tags, ...r }) => ({ ...r, created_by: S.me.id }));
    const r = await sb.from("hyf_items").insert(rows).select("id,seed_key");
    if (r.error) throw r.error;
    for (const row of r.data) {
      const src = fresh.find((s) => s.seed_key === row.seed_key);
      await syncItemTags(row.id, src.tags || []);
      S.itemTags = S.itemTags.concat((await sb.from("hyf_item_tags").select("*").eq("item_id", row.id)).data || []);
    }
    await reload(); toast(`Imported ${r.data.length} items`);
  } catch (e) { toast("Import failed: " + (e.message || e)); }
}

// ---------- alerts ----------
function checkAlerts() {
  if (!S.me || !S.loaded) return;
  const due = S.items.filter((i) => i.status === "todo" && new Date(i.scheduled_at) <= Date.now() && !S.alerted.has(i.id) && (!i.assignee_id || i.assignee_id === S.me.id));
  for (const i of due) {
    S.alerted.add(i.id);
    toast("Due now: " + i.title);
    try { if ("Notification" in window && Notification.permission === "granted") new Notification("HYF: time to " + (i.kind === "email" ? "send" : "post"), { body: `${i.title} · ${fmtWhen(i.scheduled_at)}`, icon: "icons/icon-192.png" }); } catch (_) { /* ignore */ }
  }
}

// ---------- events ----------
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast("Copied"); }
  catch (_) { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); toast("Copied"); } catch (e) { toast("Select and copy manually"); } ta.remove(); }
}
const actions = {
  oauth: async (el) => {
    const { error } = await sb.auth.signInWithOAuth({ provider: el.dataset.p, options: { redirectTo: redirectUrl() } });
    if (error) setLoginMsg(el.dataset.p === "apple" ? "Apple sign-in isn't set up yet. Use Google or email for now." : error.message, "err");
  },
  magic: async (el) => {
    const email = ($("#em")?.value || "").trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setLoginMsg("Enter a valid email address.", "err");
    el.disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectUrl(), shouldCreateUser: true } });
    el.disabled = false;
    if (error) setLoginMsg(error.message, "err"); else setLoginMsg("Check your email for a sign-in link (look in spam too).", "good");
  },
  signout: async () => { S.menu = false; closeModal(); await sb.auth.signOut(); showLogin(); },
  recheck: () => recheck(), reload: () => location.reload(),
  menu: () => { S.menu = !S.menu; renderMenu(); },
  notify: async () => { try { const p = await Notification.requestPermission(); toast(p === "granted" ? "Notifications on" : "Notifications blocked"); } catch (_) { toast("Not available here"); } S.menu = false; renderMenu(); },
  profile: () => openProfile(), team: () => openTeam(),
  tab: (el) => { S.tab = el.dataset.k; renderBar(); renderList(); },
  new: () => openItem(null),
  edit: (el) => openItem(el.dataset.id),
  toggle: (el) => { const id = el.dataset.id; S.open.has(id) ? S.open.delete(id) : S.open.add(id); renderList(); },
  jump: (el) => { S.tab = "todo"; S.q = ""; const q = $("#q"); if (q) q.value = ""; S.open.add(el.dataset.id); renderBar(); renderList(); $("#c-" + el.dataset.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); },
  status: (el) => setStatus(el.dataset.id, el.dataset.s),
  purge: async (el) => { if (!confirm("Delete this item forever?")) return; const r = await sb.from("hyf_items").delete().eq("id", el.dataset.id); if (r.error) toast(r.error.message); else reload(); },
  copy: (el) => { const it = S.items.find((x) => x.id === el.dataset.id); if (it) copyText(it.variants[+el.dataset.vi].text); },
  tag: (el) => { S.fTag = el.dataset.t; S.q = ""; const q = $("#q"); if (q) q.value = ""; renderBar(); renderList(); window.scrollTo({ top: 0, behavior: "smooth" }); },
  person: (el) => { S.fAssignee = el.dataset.id; S.q = ""; const q = $("#q"); if (q) q.value = ""; renderBar(); renderList(); window.scrollTo({ top: 0, behavior: "smooth" }); },
  close: () => closeModal(),
  ovclick: (el, e) => { if (e.target === el) closeModal(); },
  addvar: () => { syncDraft(); S.modal.draft.variants.push({ label: "", text: "" }); renderModal(); },
  delvar: (el) => { syncDraft(); S.modal.draft.variants.splice(+el.dataset.i, 1); renderModal(); },
  deltag: (el) => { syncDraft(); S.modal.draft.tags.splice(+el.dataset.i, 1); renderModal(); },
  saveitem: () => saveItem(),
  mstatus: async (el) => { syncDraft(); await setStatus(S.modal.id, el.dataset.s); closeModal(); },
  mpurge: async () => { if (!confirm("Delete this item forever?")) return; const r = await sb.from("hyf_items").delete().eq("id", S.modal.id); if (r.error) return toast(r.error.message); closeModal(); reload(); },
  addnote: async () => {
    const body = ($("#noteIn")?.value || "").trim(); if (!body) return;
    const r = await sb.from("hyf_notes").insert({ item_id: S.modal.id, author_id: S.me.id, body });
    if (r.error) return toast("Couldn't add note: " + r.error.message);
    $("#noteIn").value = ""; await reload();
  },
  delnote: async (el) => { const r = await sb.from("hyf_notes").delete().eq("id", el.dataset.id); if (r.error) toast(r.error.message); else reload(); },
  emoji: (el) => { syncProfileDraft(); S.modal.draft.emoji = el.dataset.e; renderModal(); },
  clearemoji: () => { syncProfileDraft(); S.modal.draft.emoji = ""; renderModal(); },
  clearphoto: () => { syncProfileDraft(); S.modal.draft.url = ""; renderModal(); },
  delptag: (el) => { syncProfileDraft(); S.modal.draft.tags.splice(+el.dataset.i, 1); renderModal(); },
  saveprofile: () => saveProfile(),
  setrole: async (el) => { const r = await sb.from("hyf_profiles").update({ role: el.dataset.r }).eq("id", el.dataset.id); if (r.error) toast(r.error.message); else { await reload(); toast("Approved"); } },
  addinvite: async () => {
    const email = ($("#inv_email")?.value || "").trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(email)) return toast("Enter a valid email");
    const r = await sb.from("hyf_invites").upsert({ email, role: $("#inv_role").value }); if (r.error) toast(r.error.message); else { await reload(); toast("Invite saved"); }
  },
  delinvite: async (el) => { const r = await sb.from("hyf_invites").delete().eq("email", el.dataset.e); if (r.error) toast(r.error.message); else reload(); },
  seed: () => importSeed(),
};
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-a]");
  if (S.menu && !e.target.closest("#menuBox") && !(el && el.dataset.a === "menu")) { S.menu = false; renderMenu(); }
  if (!el) return;
  const fn = actions[el.dataset.a];
  if (fn && el.tagName !== "SELECT") fn(el, e);
});
document.addEventListener("change", async (e) => {
  const el = e.target;
  if (el.dataset?.a === "fassignee") { S.fAssignee = el.value; renderBar(); renderList(); }
  else if (el.dataset?.a === "ftag") { S.fTag = el.value; renderBar(); renderList(); }
  else if (el.dataset?.a === "rolesel") {
    const r = await sb.from("hyf_profiles").update({ role: el.value }).eq("id", el.dataset.id);
    if (r.error) toast(r.error.message); else { await reload(); toast("Role updated"); }
  } else if (el.id === "p_file" && el.files[0]) uploadAvatar(el.files[0]);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") {
    if (e.target.id === "f_tagin") { e.preventDefault(); syncDraft(); renderModal(); $("#f_tagin")?.focus(); }
    else if (e.target.id === "p_tagin") { e.preventDefault(); syncProfileDraft(); renderModal(); $("#p_tagin")?.focus(); }
  } else if (e.key === "Escape" && S.modal) closeModal();
});
document.addEventListener("input", (e) => {
  if (e.target.id === "p_name" || e.target.id === "p_emoji") { // live avatar preview without re-rendering the form
    const d = S.modal?.draft; if (!d) return;
    const prev = { ...S.me, display_name: $("#p_name").value || S.me.display_name, avatar_emoji: $("#p_emoji").value.trim(), avatar_url: d.url };
    $("#avprev").innerHTML = avatar(prev, 72);
  }
});

// ---------- start ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
sb.auth.onAuthStateChange((ev, session) => {
  if (ev === "SIGNED_OUT") { showLogin(); return; }
  if (session && (ev === "INITIAL_SESSION" || ev === "SIGNED_IN")) setTimeout(() => boot(session), 0);
  else if (ev === "INITIAL_SESSION" && !session) showLogin();
});
