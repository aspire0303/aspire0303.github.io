import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc,
  query, where, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

/* ------------------------------------------------------------------ *
 *  Card definitions: the one place that says what every card contains
 *  and who may send it. (Rules in firestore.rules enforce the same.)
 * ------------------------------------------------------------------ */
const CARDS = {
  ATTENDANCE: { label: "Attendance", emoji: "🗓️", fields: [
    ["student", "Student"], ["month", "Month (e.g. November 2026)"],
    ["present", "Days present", { num: 1 }], ["absent", "Days absent", { num: 1 }],
    ["leave", "Days on leave", { num: 1 }], ["workingDays", "Total working days", { num: 1 }]] },
  FEE: { label: "Fee Status", emoji: "💰", fields: [
    ["student", "Student"], ["month", "For month / term"], ["amount", "Amount (Rs)", { num: 1 }],
    ["dueDate", "Due date"], ["status", "Status", { def: "Unpaid", hidden: 1 }]] },
  VOUCHER: { label: "Fee Voucher / Receipt", emoji: "🧾", fields: [
    ["student", "Student"], ["kind", "Type (Voucher / Receipt)", { def: "Voucher" }],
    ["number", "Voucher / receipt no."], ["amount", "Amount (Rs)", { num: 1 }], ["date", "Date"],
    ["payAt", "Pay at / bank details", { long: 1 }], ["status", "Status", { def: "Unpaid", hidden: 1 }]] },
  EXAM: { label: "Exam Report", emoji: "📝", fields: [
    ["student", "Student"], ["exam", "Exam (e.g. Mid-term 2026)"],
    ["subjects", "Subject-wise marks", { long: 1 }], ["obtained", "Total obtained", { num: 1 }],
    ["total", "Total marks", { num: 1 }], ["grade", "Grade"], ["remarks", "Teacher remarks", { long: 1 }]] },
  DIARY: { label: "Daily Diary", emoji: "📒", fields: [
    ["classSection", "Class / section"], ["date", "Date"],
    ["classwork", "Classwork done today", { long: 1 }], ["homework", "Homework", { long: 1 }],
    ["reminders", "Reminders (test, items to bring, etc.)", { long: 1 }],
    ["status", "Parent signature", { def: "Not seen", hidden: 1 }]] },
  HOMEWORK: { label: "Homework", emoji: "📚", fields: [
    ["classSection", "Class / section"], ["subject", "Subject"], ["task", "Task", { long: 1 }], ["dueDate", "Due date"]] },
  TIMETABLE: { label: "Timetable", emoji: "⏰", fields: [
    ["classSection", "Class / section"], ["day", "Day / date"], ["periods", "Periods (one per line)", { long: 1 }]] },
  NOTICE: { label: "Notice / Event", emoji: "📢", fields: [
    ["title", "Title"], ["date", "Date / time"], ["details", "Details", { long: 1 }]] },
  COMPLAINT: { label: "Complaint", emoji: "⚠️", fields: [
    ["student", "Student (if related)"], ["subject", "Subject"],
    ["details", "Describe the complaint", { long: 1 }], ["status", "Status", { def: "Open", hidden: 1 }]] },
  LEAVE: { label: "Leave Request", emoji: "🏖️", fields: [
    ["student", "Student"], ["from", "From date"], ["to", "To date"],
    ["reason", "Reason", { long: 1 }], ["status", "Status", { def: "Pending", hidden: 1 }]] }
};

const ALLOWED = {
  PARENT: ["COMPLAINT", "LEAVE"],
  TEACHER: ["ATTENDANCE", "EXAM", "DIARY", "HOMEWORK", "TIMETABLE", "NOTICE", "COMPLAINT"],
  ADMIN: Object.keys(CARDS)
};

function statusActions(type, role) {
  if (role === "PARENT") return type === "DIARY" ? ["Seen by parent"] : [];
  switch (type) {
    case "COMPLAINT": return ["In review", "Resolved"];
    case "LEAVE": return ["Approved", "Rejected"];
    case "FEE": case "VOUCHER": return role === "ADMIN" ? ["Paid", "Partial"] : [];
    default: return [];
  }
}

const STATUS_COLOR = {
  "Paid": "green", "Approved": "green", "Resolved": "green", "Seen by parent": "green",
  "Rejected": "red", "Unpaid": "red", "Open": "red", "Not seen": "red"
};

/* ------------------------------ helpers ------------------------------ */
// Builds DOM with textContent only, so user text can never inject HTML.
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const timeLabel = (ts) =>
  new Date(ts).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const ratio = (a, b) => {
  const x = parseFloat(a), y = parseFloat(b);
  return isFinite(x) && isFinite(y) && y > 0 ? Math.min(Math.max(x / y, 0), 1) : null;
};

/* ------------------------------- state ------------------------------- */
const root = document.getElementById("app");
let db, auth;
let me = null;
let chats = [];
let unsubChats = null, unsubMsgs = null;
let openChat = null;

function show(...nodes) { root.replaceChildren(...nodes); }
function cleanup() {
  if (unsubChats) { unsubChats(); unsubChats = null; }
  if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; }
}

/* ------------------------------ startup ------------------------------ */
function boot() {
  if (firebaseConfig.apiKey.startsWith("PASTE")) {
    show(h("div", { class: "login" },
      h("h1", {}, "Aspire"),
      h("p", {}, "Setup needed"),
      h("p", { class: "err" }, "Open firebase-config.js and paste your Firebase web app config, then reload.")));
    return;
  }
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

  onAuthStateChanged(auth, async (user) => {
    cleanup();
    openChat = null;
    if (!user) { me = null; return renderLogin(); }
    show(h("p", { class: "boot" }, "Loading…"));
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists()) throw new Error("no-profile");
      me = { uid: user.uid, ...snap.data() };
    } catch (e) {
      me = null;
      return renderProblem("No profile found for this account. Please ask the school admin to set it up.");
    }
    if (!ALLOWED[me.role]) {
      const found = me.role === undefined ? "no role field" : `role "${me.role}"`;
      return renderProblem(`This profile has ${found}. In Firestore, the role must be exactly ADMIN, TEACHER or PARENT (capital letters, no spaces, field name "role").`);
    }
    me.name = me.name || "User";
    renderList();
  });

  window.addEventListener("popstate", () => { if (me && openChat) { closeChat(); } });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

function renderProblem(msg) {
  show(h("div", { class: "login" },
    h("h1", {}, "Aspire"),
    h("p", { class: "err" }, msg),
    h("button", { class: "btn", onclick: () => signOut(auth) }, "Back to login")));
}

/* ------------------------------- login ------------------------------- */
function renderLogin() {
  const email = h("input", { class: "field", type: "email", placeholder: "Email", autocomplete: "username" });
  const pass = h("input", { class: "field", type: "password", placeholder: "Password", autocomplete: "current-password" });
  const err = h("div", { class: "err" });
  const btn = h("button", { class: "btn", type: "submit" }, "Sign in");
  const form = h("form", { class: "login", onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = "Signing in…"; err.textContent = "";
    try { await signInWithEmailAndPassword(auth, email.value.trim(), pass.value); }
    catch { err.textContent = "Sign-in failed. Check your email and password."; btn.disabled = false; btn.textContent = "Sign in"; }
  } },
    h("h1", {}, "Aspire"), h("p", {}, "School Messenger"), email, pass, err, btn);
  show(form);
}

/* ----------------------------- chat list ----------------------------- */
function renderList() {
  openChat = null;
  if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; }
  const list = h("div", { class: "list" });
  const roleName = me.role.charAt(0) + me.role.slice(1).toLowerCase();
  const header = h("div", { class: "bar" },
    h("h1", {}, "Aspire Messenger", h("small", {}, `${me.name} · ${roleName}`)),
    h("button", { onclick: () => signOut(auth) }, "Log out"));
  const nodes = [header, list];
  if (me.role === "ADMIN") nodes.push(h("button", { class: "fab", "aria-label": "New chat", onclick: openNewChat }, "+"));
  show(...nodes);

  const draw = () => {
    if (!chats.length) { list.replaceChildren(h("p", { class: "empty" }, "No chats yet")); return; }
    list.replaceChildren(...chats.map((c) =>
      h("button", { class: "row", onclick: () => openChatView(c) },
        h("div", { class: "avatar" }, (c.title || "?").slice(0, 1).toUpperCase()),
        h("div", { class: "mid" }, h("b", {}, c.title), h("span", {}, c.lastMessage || "")),
        c.lastTs ? h("time", {}, timeLabel(c.lastTs)) : null)));
  };
  draw();

  if (unsubChats) unsubChats();
  unsubChats = onSnapshot(
    query(collection(db, "chats"), where("participants", "array-contains", me.uid)),
    (snap) => {
      chats = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
      if (!openChat) draw();
    },
    () => list.replaceChildren(h("p", { class: "empty" }, "Could not load chats. Check your connection."))
  );
}

/* ---------------------------- new chat (admin) ---------------------------- */
async function openNewChat() {
  const title = h("input", { class: "field", placeholder: "Name (e.g. Class 5-A Parents)" });
  const pickList = h("div", { class: "pick-list" }, h("p", { class: "empty" }, "Loading people…"));
  const picked = new Set();
  const create = h("button", { class: "btn", disabled: true, onclick: async () => {
    create.disabled = true;
    await addDoc(collection(db, "chats"), {
      title: title.value.trim(), participants: [...picked, me.uid], lastMessage: "Chat created", lastTs: Date.now()
    });
    closeOverlay();
  } }, "Create");
  const refresh = () => { create.disabled = !(title.value.trim() && picked.size); };
  title.addEventListener("input", refresh);

  const overlay = sheet("New chat / group", title, pickList,
    h("div", { class: "row-btns" }, h("button", { class: "btn ghost", onclick: closeOverlay }, "Cancel"), create));
  document.body.append(overlay);

  try {
    const snap = await getDocs(collection(db, "users"));
    const users = snap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((u) => u.uid !== me.uid);
    pickList.replaceChildren(...users.map((u) => {
      const cb = h("input", { type: "checkbox", onchange: () => { cb.checked ? picked.add(u.uid) : picked.delete(u.uid); refresh(); } });
      return h("label", { class: "pick" }, cb,
        h("div", {}, u.name, h("small", {}, `${(u.role || "").toLowerCase()} ${u.studentName || ""} ${u.classSection || ""}`.trim())));
    }));
    if (!users.length) pickList.replaceChildren(h("p", { class: "empty" }, "No other users yet."));
  } catch {
    pickList.replaceChildren(h("p", { class: "err" }, "Could not load users."));
  }
}

function sheet(titleText, ...kids) {
  const el = h("div", { class: "overlay", onclick: (e) => { if (e.target === el) closeOverlay(); } },
    h("div", { class: "sheet" }, h("h2", {}, titleText), ...kids));
  return el;
}
function closeOverlay() { document.querySelectorAll(".overlay").forEach((o) => o.remove()); }

/* ------------------------------- chat view ------------------------------- */
function openChatView(chat) {
  openChat = chat;
  history.pushState({ chat: chat.id }, "");
  const msgs = h("div", { class: "msgs" });
  const input = h("textarea", { rows: 1, placeholder: "Message" });
  const sendText = async () => {
    const t = input.value.trim();
    if (!t) return;
    input.value = "";
    await sendMessage(chat.id, { text: t });
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(hover: hover)").matches) { e.preventDefault(); sendText(); }
  });

  show(
    h("div", { class: "bar" }, h("button", { class: "back", "aria-label": "Back", onclick: () => history.back() }, "‹"), h("h1", {}, chat.title)),
    msgs,
    h("div", { class: "composer" },
      h("button", { class: "icon-btn", "aria-label": "Send a card", onclick: () => openComposer(chat) }, "+"),
      input,
      h("button", { class: "icon-btn send", "aria-label": "Send", onclick: sendText }, "➤"))
  );

  if (unsubMsgs) unsubMsgs();
  unsubMsgs = onSnapshot(
    query(collection(db, "chats", chat.id, "messages"), orderBy("ts", "asc")),
    (snap) => {
      const nearBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 120;
      msgs.replaceChildren(...snap.docs.map((d) => bubble({ id: d.id, ...d.data() }, chat.id)));
      if (nearBottom || !msgs.dataset.init) { msgs.scrollTop = msgs.scrollHeight; msgs.dataset.init = "1"; }
    }
  );
}

function closeChat() {
  if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; }
  renderList();
}

async function sendMessage(chatId, payload) {
  const now = Date.now();
  const msg = { senderId: me.uid, senderName: me.name, text: "", cardType: "", card: {}, ...payload, ts: now };
  await addDoc(collection(db, "chats", chatId, "messages"), msg);
  const preview = msg.cardType && CARDS[msg.cardType] ? `${CARDS[msg.cardType].emoji} ${CARDS[msg.cardType].label}` : msg.text;
  await updateDoc(doc(db, "chats", chatId), { lastMessage: preview, lastTs: now });
}

/* --------------------------------- bubbles --------------------------------- */
function bubble(m, chatId) {
  const mine = m.senderId === me.uid;
  const body = CARDS[m.cardType] ? cardView(m, chatId) : h("div", { class: "bubble" }, m.text);
  return h("div", { class: "m" + (mine ? " mine" : "") },
    mine ? null : h("div", { class: "who" }, m.senderName),
    body,
    h("div", { class: "ts" }, timeLabel(m.ts)));
}

function meter(label, value) {
  const color = value >= 0.75 ? "var(--green)" : value >= 0.5 ? "var(--amber)" : "var(--red)";
  const pct = Math.round(value * 100);
  return h("div", { class: "meter" },
    h("div", { class: "top" }, h("span", {}, label), h("b", { style: `color:${color}` }, pct + "%")),
    h("div", { class: "bar-track" }, h("div", { class: "bar-fill", style: `width:${pct}%;background:${color}` })));
}

function cardView(m, chatId) {
  const spec = CARDS[m.cardType];
  const data = m.card || {};
  const status = (data.status || "").trim();

  const rows = [];
  if (m.cardType === "ATTENDANCE") { const r = ratio(data.present, data.workingDays); if (r !== null) rows.push(meter("Attendance", r)); }
  if (m.cardType === "EXAM") { const r = ratio(data.obtained, data.total); if (r !== null) rows.push(meter("Score", r)); }

  for (const [key, label, opt = {}] of spec.fields) {
    if (key === "status") continue;
    const v = (data[key] || "").toString();
    if (!v.trim()) continue;
    if (opt.long) rows.push(h("div", { class: "long" }, h("small", {}, label), h("div", {}, v)));
    else rows.push(h("div", { class: "kv" }, h("span", {}, label.split(" (")[0]), h("span", {}, v)));
  }

  const actions = statusActions(m.cardType, me.role).filter((a) => a !== status);
  if (actions.length) {
    rows.push(h("div", { class: "actions" }, actions.map((a) =>
      h("button", { onclick: () => updateDoc(doc(db, "chats", chatId, "messages", m.id), { "card.status": a }) }, a))));
  }

  return h("div", { class: "card" },
    h("div", { class: "card-head" },
      h("span", {}, spec.emoji), h("span", { class: "title" }, spec.label),
      status ? h("span", { class: "chip " + (STATUS_COLOR[status] || "amber") }, status) : null),
    h("div", { class: "card-body" }, rows));
}

/* ------------------------------ card composer ------------------------------ */
function openComposer(chat) {
  const types = ALLOWED[me.role] || ALLOWED.PARENT;
  let type = types[0];
  let values = {};
  const form = h("div", {});
  const chips = h("div", { class: "chips" });

  const defaults = (t) => {
    const v = {};
    for (const [key, , opt = {}] of CARDS[t].fields) {
      v[key] = key === "student" ? (me.studentName || "") : key === "classSection" ? (me.classSection || "") : (opt.def || "");
    }
    return v;
  };

  const draw = () => {
    chips.replaceChildren(...types.map((t) =>
      h("button", { class: t === type ? "on" : "", onclick: () => { type = t; values = defaults(t); draw(); } },
        `${CARDS[t].emoji} ${CARDS[t].label}`)));
    form.replaceChildren(...CARDS[type].fields.filter(([, , o = {}]) => !o.hidden).map(([key, label, opt = {}]) => {
      const el = opt.long
        ? h("textarea", { class: "field", rows: 3 })
        : h("input", { class: "field", type: "text", inputmode: opt.num ? "numeric" : "text" });
      el.value = values[key] || "";
      el.addEventListener("input", () => { values[key] = el.value; });
      return h("div", {}, h("label", { class: "lbl" }, label), el);
    }));
  };
  values = defaults(type);
  draw();

  const send = h("button", { class: "btn", onclick: async () => {
    send.disabled = true;
    try {
      await sendMessage(chat.id, { cardType: type, card: { ...values } });
      closeOverlay();
    } catch {
      send.disabled = false;
      send.textContent = "Could not send. Try again.";
    }
  } }, "Send card");

  document.body.append(sheet("Send a card", chips, form, h("div", { class: "row-btns" }, send)));
}

boot();
