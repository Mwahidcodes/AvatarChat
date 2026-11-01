const $ = (id) => document.getElementById(id);

// Language the microphone listens for. Other options: "en-GB", "en-IN", ...
const SPEECH_LANG = "en-US";
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const PAGES = ["home", "create", "chat", "progress", "memory"];
const PARTNER_PAGES = ["chat", "progress", "memory"];   // pages that belong to one partner

let personas = [];           // all partners, loaded from the backend
let currentPersona = null;   // the partner of the current page
let chatLoadedFor = null;    // id of the partner whose chat is on screen
let routeToken = 0;          // protects against quick page changes
let modes = [];              // [{id, label}]
let photoData = "";          // the photo chosen on the Create page

let busy = false;            // true while waiting for / receiving a reply
let sessionOpen = true;      // false after "End session" until a new one starts
let speaking = false;        // true while the voice is talking
let listening = false;       // true while the microphone is on
let speakToken = 0;          // changes whenever speech is interrupted
let voices = [];             // English voices available in this browser

// ---------- Small helpers ----------
function setStatus(text) {
  $("status").textContent = text;
}

// Remember small choices in the browser (voice, voice on/off)
function saveSetting(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked: ignore */ }
}
function loadSetting(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

// Fixed icon names only (never user text), so this is safe to use with innerHTML
function iconMarkup(name) {
  return `<svg class="icon" aria-hidden="true"><use href="#i-${name}" /></svg>`;
}

// ---------- Modes ----------
async function loadModes() {
  const res = await fetch("/modes");
  modes = await res.json();
  // Fill both dropdowns (the Create page and the chat tools)
  [$("mode"), $("modeSelect")].forEach((select) => {
    select.innerHTML = "";
    modes.forEach((m) => {
      const option = document.createElement("option");
      option.value = m.id;
      option.textContent = m.label;
      select.appendChild(option);
    });
  });
}

function modeLabel(id) {
  const found = modes.find((m) => m.id === id);
  return found ? found.label : id;
}

// ============================================================
// Navigation: the address after "#" decides which page is shown
//   #/home   #/create   #/chat/3   #/progress/3   #/memory/3
// ============================================================
function go(path) {
  location.hash = `#/${path}`;
}

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  return { page: parts[0] || "home", id: parts[1] ? Number(parts[1]) : null };
}

async function findPersona(id) {
  if (!id) return null;
  let found = personas.find((p) => p.id === id);
  if (!found) {
    await loadPersonas();
    found = personas.find((p) => p.id === id);
  }
  return found || null;
}

// Show one page and update the top bar to match it
function showPage(page) {
  PAGES.forEach((name) => $(`page-${name}`).classList.toggle("hidden", name !== page));

  const titles = {
    home:     ["English Coach", ""],
    create:   ["New partner", ""],
    chat:     [currentPersona ? currentPersona.name : "", "AI-generated persona"],
    progress: ["Progress", currentPersona ? currentPersona.name : ""],
    memory:   ["Memory", currentPersona ? currentPersona.name : ""],
  };
  const [title, sub] = titles[page];
  $("topTitle").textContent = title;
  $("topSub").textContent = sub;
  $("topSub").classList.toggle("hidden", !sub);

  $("backBtn").classList.toggle("hidden", page === "home");
  $("chatActions").classList.toggle("hidden", page !== "chat");
}

async function route() {
  const token = ++routeToken;
  let { page, id } = parseRoute();
  if (!PAGES.includes(page)) page = "home";

  stopEverything();     // stop voice and microphone whenever the page changes
  closeDrawer();

  if (PARTNER_PAGES.includes(page)) {
    const persona = await findPersona(id);
    if (token !== routeToken) return;          // another page change happened meanwhile
    if (!persona) {
      go("home");
      return;
    }
    currentPersona = persona;
  }

  showPage(page);
  markActivePersona(page);

  if (page === "chat") await enterChat();
  if (page === "progress") await renderProgress();
  if (page === "memory") await renderMemory();
}

window.addEventListener("hashchange", route);

// Back arrow: go up one level (Progress and Memory return to the chat)
$("backBtn").addEventListener("click", () => {
  const { page, id } = parseRoute();
  if (page === "progress" || page === "memory") go(`chat/${id}`);
  else go("home");
});

$("goCreate").addEventListener("click", () => go("create"));

// ============================================================
// Slide-in menu (drawer) with the saved partners
// ============================================================
function openDrawer() {
  $("drawer").classList.add("open");
  $("drawer").setAttribute("aria-hidden", "false");
  $("scrim").classList.add("show");
  $("menuBtn").setAttribute("aria-expanded", "true");
  $("drawerClose").focus();
}

function closeDrawer() {
  $("drawer").classList.remove("open");
  $("drawer").setAttribute("aria-hidden", "true");
  $("scrim").classList.remove("show");
  $("menuBtn").setAttribute("aria-expanded", "false");
}

$("menuBtn").addEventListener("click", () => {
  if ($("drawer").classList.contains("open")) closeDrawer();
  else openDrawer();
});
$("drawerClose").addEventListener("click", closeDrawer);
$("scrim").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
});

// ---------- Saved partners ----------
async function loadPersonas() {
  const res = await fetch("/personas");
  personas = await res.json();
  renderPersonas();
}

function buildPersonaRow(p) {
  const row = document.createElement("div");
  row.className = "saved-item";
  row.dataset.id = p.id;

  // A normal link, so the keyboard, Back and Forward all work
  const link = document.createElement("a");
  link.className = "persona-link";
  link.href = `#/chat/${p.id}`;

  const img = document.createElement("img");
  img.src = p.photo;
  img.alt = "";

  const info = document.createElement("div");
  info.className = "info";
  const nameEl = document.createElement("strong");
  nameEl.textContent = p.name;
  const styleEl = document.createElement("small");
  styleEl.textContent = `${p.style} · ${modeLabel(p.mode)}`;
  info.append(nameEl, styleEl);
  link.append(img, info);

  const del = document.createElement("button");
  del.className = "icon-btn del";
  del.title = `Delete ${p.name}`;
  del.setAttribute("aria-label", `Delete ${p.name}`);
  del.innerHTML = iconMarkup("trash");
  del.onclick = async () => {
    if (!confirm(`Delete ${p.name} and the whole conversation?`)) return;
    await fetch(`/personas/${p.id}`, { method: "DELETE" });
    if (chatLoadedFor === p.id) chatLoadedFor = null;

    const { page } = parseRoute();
    const wasOpen =
      currentPersona && currentPersona.id === p.id && PARTNER_PAGES.includes(page);
    await loadPersonas();
    if (wasOpen) go("home");
  };

  row.append(link, del);
  return row;
}

function renderPersonas() {
  const box = $("saved");
  box.innerHTML = "";

  if (personas.length === 0) {
    box.textContent = "No partners yet. Press New partner to create one.";
  } else {
    personas.forEach((p) => box.appendChild(buildPersonaRow(p)));
  }

  // Home page: a shortcut to the newest partner
  const latest = personas[0];
  const pill = $("continueBtn");
  pill.classList.toggle("hidden", !latest);
  pill.innerHTML = "";
  if (latest) {
    const img = document.createElement("img");
    img.src = latest.photo;
    img.alt = "";
    const text = document.createElement("span");
    text.textContent = `Continue with ${latest.name}`;
    pill.append(img, text);
    pill.onclick = () => go(`chat/${latest.id}`);
  }

  markActivePersona(parseRoute().page);
}

// Highlight the partner whose pages are open
function markActivePersona(page) {
  document.querySelectorAll(".saved-item").forEach((row) => {
    const active =
      currentPersona &&
      PARTNER_PAGES.includes(page) &&
      Number(row.dataset.id) === currentPersona.id;
    row.classList.toggle("active", Boolean(active));
  });
}

// ============================================================
// Create page
// ============================================================

// Shrinks the photo so the database stays small
function resizeImage(file, maxSize = 300) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

$("photo").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  photoData = await resizeImage(file);
  $("preview").src = photoData;
  $("preview").classList.remove("hidden");
});

$("start").addEventListener("click", async () => {
  if (!photoData) return alert("Please upload a photo first.");

  const body = {
    name: $("name").value.trim() || "Coach",
    style: $("style").value.trim() || "friendly",
    photo: photoData,
    mode: $("mode").value,
  };

  const res = await fetch("/personas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return alert("Could not create the partner. Please try again.");
  const data = await res.json();

  // Clear the form for next time
  photoData = "";
  $("photo").value = "";
  $("preview").classList.add("hidden");
  $("name").value = "";

  await loadPersonas();
  go(`chat/${data.id}`);
});

// ============================================================
// Chat page
// ============================================================
async function enterChat() {
  $("avatar").src = currentPersona.photo;
  $("modeSelect").value = currentPersona.mode;

  // Coming back from Progress or Memory: keep the chat exactly as it was
  if (chatLoadedFor === currentPersona.id) return;
  chatLoadedFor = currentPersona.id;
  try {
    await loadSession();
  } catch (err) {
    chatLoadedFor = null;
    addNote("Could not load the chat. Is the server running?");
  }
}

// Load the current session from the backend and show its messages
async function loadSession() {
  $("messages").innerHTML = "";
  setStatus("");
  setSessionOpen(true);

  const res = await fetch(`/personas/${currentPersona.id}/session`);
  const data = await res.json();
  data.messages.forEach((m) => addBubble(m.role, m.content));

  // Brand-new session: the AI speaks first
  if (data.messages.length === 0) await getReply(null);
}

// Turn the typing area and session buttons on or off
function setSessionOpen(open) {
  sessionOpen = open;
  $("inputBar").classList.toggle("disabled-bar", !open);
  $("endSession").disabled = !open;
  $("clear").disabled = !open;
}

async function startNewSession() {
  await loadSession();
}

// Chat tools in the top bar
$("progressBtn").addEventListener("click", () => go(`progress/${currentPersona.id}`));
$("memoryBtn").addEventListener("click", () => go(`memory/${currentPersona.id}`));

// Switch the conversation mode while chatting
$("modeSelect").addEventListener("change", async () => {
  const newMode = $("modeSelect").value;
  const res = await fetch(`/personas/${currentPersona.id}/mode`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: newMode }),
  });
  if (!res.ok) {
    $("modeSelect").value = currentPersona.mode;   // undo on failure
    return alert("Could not change the mode.");
  }
  currentPersona.mode = newMode;
  renderPersonas();                                // the menu shows the mode too
  addNote(`Mode changed to: ${modeLabel(newMode)}`);
});

// Clear the current conversation (no feedback is created)
$("clear").addEventListener("click", async () => {
  if (busy || !sessionOpen) return;
  if (!confirm("Clear this conversation and start again?")) return;
  stopEverything();
  await fetch(`/personas/${currentPersona.id}/messages`, { method: "DELETE" });
  $("messages").innerHTML = "";
  await getReply(null);   // the AI greets again
});

// End the session and ask the coach for feedback
$("endSession").addEventListener("click", async () => {
  if (busy || !sessionOpen) return;
  if (!confirm("End this session and get your feedback?")) return;

  stopEverything();
  busy = true;
  $("endSession").disabled = true;
  setStatus("Preparing your feedback... this can take up to a minute.");

  try {
    const res = await fetch(`/personas/${currentPersona.id}/session/end`, {
      method: "POST",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Could not create the feedback.");
    showFeedback(data.feedback);
    setSessionOpen(false);
  } catch (err) {
    addNote(err.message);          // the session stays open, so you can try again
    $("endSession").disabled = false;
  }

  busy = false;
  setStatus("");
});

function addNote(text) {
  const note = document.createElement("div");
  note.className = "note";
  note.textContent = text;
  $("messages").appendChild(note);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function addBubble(role, text) {
  const row = document.createElement("div");
  row.className = "row " + (role === "user" ? "user" : "bot");
  if (role !== "user") {
    const img = document.createElement("img");
    img.src = currentPersona.photo;
    img.alt = "";
    row.appendChild(img);
  }
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.appendChild(bubble);
  $("messages").appendChild(row);
  $("messages").scrollTop = $("messages").scrollHeight;
  return bubble;
}

// Shows which question-bank items were retrieved for a reply
function showSources(bubble, sources) {
  if (!sources || sources.length === 0) return;

  const details = document.createElement("details");
  details.className = "sources";

  const summary = document.createElement("summary");
  summary.textContent = `Retrieved from the question bank (${sources.length})`;

  const list = document.createElement("ul");
  sources.forEach((s) => {
    const li = document.createElement("li");
    li.textContent = `[${s.topic}] ${s.text}`;
    list.appendChild(li);
  });

  details.append(summary, list);
  bubble.appendChild(details);
}

// ---------- Feedback card (shown in the chat after "End session") ----------
function addList(card, heading, items) {
  if (!items || items.length === 0) return;
  const title = document.createElement("h4");
  title.textContent = heading;
  const list = document.createElement("ul");
  items.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  });
  card.append(title, list);
}

function showFeedback(fb) {
  const card = document.createElement("div");
  card.className = "feedback";

  const title = document.createElement("h3");
  title.textContent = `Session feedback: ${fb.overall} / 10`;
  card.appendChild(title);

  const labels = {
    grammar: "Grammar",
    vocabulary: "Vocabulary",
    clarity: "Clarity",
    confidence: "Confidence",
  };
  Object.entries(labels).forEach(([key, label]) => {
    const row = document.createElement("div");
    row.className = "score-row";

    const name = document.createElement("span");
    name.textContent = label;

    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("div");
    fill.className = "fill";
    fill.style.width = `${fb[key] * 10}%`;
    bar.appendChild(fill);

    const value = document.createElement("span");
    value.textContent = fb[key];

    row.append(name, bar, value);
    card.appendChild(row);
  });

  addList(card, "What went well", fb.strengths);
  addList(card, "Work on", fb.improvements);

  if (fb.tip) {
    const tip = document.createElement("p");
    tip.className = "tip";
    tip.textContent = "Tip: " + fb.tip;
    card.appendChild(tip);
  }

  // What the coach will remember for next time
  addList(card, "Practise next time", fb.focus_next);
  if (fb.summary) {
    const remembered = document.createElement("p");
    remembered.className = "small";
    remembered.textContent = "Saved to memory: " + fb.summary;
    card.appendChild(remembered);
  }

  const button = document.createElement("button");
  button.textContent = "Start new session";
  button.onclick = startNewSession;
  card.appendChild(button);

  $("messages").appendChild(card);
  $("messages").scrollTop = $("messages").scrollHeight;
}

// ============================================================
// Memory page
// ============================================================
async function renderMemory() {
  const body = $("memoryBody");
  body.innerHTML = "";

  const res = await fetch(`/personas/${currentPersona.id}/memory`);
  if (!res.ok) {
    body.textContent = "Could not load the memory.";
    return;
  }
  const data = await res.json();

  const card = document.createElement("div");
  card.className = "feedback memory";

  if (data.items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "small";
    empty.textContent =
      "Nothing yet. Finish a session with 'End session' and your coach will remember it.";
    card.appendChild(empty);
  } else {
    data.items.forEach((item) => {
      const box = document.createElement("div");
      box.className = "memory-item";

      const date = document.createElement("small");
      date.textContent = item.date || "Earlier session";

      const summary = document.createElement("div");
      summary.textContent = item.summary;

      box.append(date, summary);
      if (item.focus_next.length > 0) {
        const focus = document.createElement("small");
        focus.textContent = "Practise: " + item.focus_next.join("; ");
        box.appendChild(focus);
      }
      card.appendChild(box);
    });

    const actions = document.createElement("div");
    actions.className = "actions";
    const forget = document.createElement("button");
    forget.textContent = "Forget everything";
    forget.className = "danger";
    forget.onclick = async () => {
      if (!confirm("Delete everything the coach remembers? Your scores are kept.")) return;
      await fetch(`/personas/${currentPersona.id}/memory`, { method: "DELETE" });
      await renderMemory();
    };
    actions.appendChild(forget);
    card.appendChild(actions);
  }

  body.appendChild(card);
}

// ============================================================
// Progress page
// ============================================================
const CHART_CHOICES = {
  overall: "Overall",
  grammar: "Grammar",
  vocabulary: "Vocabulary",
  clarity: "Clarity",
  confidence: "Confidence",
};

const SVG_NS = "http://www.w3.org/2000/svg";

// Creates an SVG element (SVG needs its own namespace)
function svgEl(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
  return element;
}

function addTile(container, label, value) {
  const tile = document.createElement("div");
  tile.className = "tile";
  const number = document.createElement("strong");
  number.textContent = value;
  const caption = document.createElement("span");
  caption.textContent = label;
  tile.append(number, caption);
  container.appendChild(tile);
}

// Draws a line chart of one score (key) over time, using plain SVG
function drawChart(container, sessions, key) {
  container.innerHTML = "";
  const shown = sessions.slice(-20);        // the 20 most recent sessions

  // Chart size and margins, in SVG units (the viewBox scales it to fit)
  const W = 520, H = 210, left = 30, right = 14, top = 14, bottom = 28;
  const plotW = W - left - right;
  const plotH = H - top - bottom;

  // Scaling: turn a position or a score into pixel coordinates
  const x = (i) =>
    shown.length === 1 ? left + plotW / 2 : left + (i * plotW) / (shown.length - 1);
  const y = (score) => top + plotH * (1 - score / 10);

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img" });
  svg.setAttribute("aria-label", `${CHART_CHOICES[key]} score over time`);

  // Horizontal grid lines with their numbers
  [0, 2, 4, 6, 8, 10].forEach((score) => {
    svg.appendChild(
      svgEl("line", { x1: left, x2: W - right, y1: y(score), y2: y(score), class: "grid" })
    );
    const label = svgEl("text", { x: left - 6, y: y(score) + 3, "text-anchor": "end" });
    label.textContent = score;
    svg.appendChild(label);
  });

  // The line connecting the points
  if (shown.length > 1) {
    const points = shown.map((s, i) => `${x(i)},${y(s[key])}`).join(" ");
    svg.appendChild(svgEl("polyline", { points, class: "line" }));
  }

  // One dot per session, with a tooltip shown on hover
  shown.forEach((s, i) => {
    const dot = svgEl("circle", { cx: x(i), cy: y(s[key]), r: 4.5, class: "dot" });
    const tooltip = svgEl("title");
    tooltip.textContent = `${s.date}: ${s[key]} / 10`;
    dot.appendChild(tooltip);
    svg.appendChild(dot);
  });

  // Date labels under the first and last dots
  const ends = shown.length === 1 ? [0] : [0, shown.length - 1];
  ends.forEach((i) => {
    const anchor = shown.length === 1 ? "middle" : i === 0 ? "start" : "end";
    const label = svgEl("text", { x: x(i), y: H - 8, "text-anchor": anchor });
    label.textContent = shown[i].date.slice(5);   // "2026-10-27" -> "10-27"
    svg.appendChild(label);
  });

  container.appendChild(svg);
}

async function renderProgress() {
  const body = $("progressBody");
  body.innerHTML = "";

  const res = await fetch(`/personas/${currentPersona.id}/progress`);
  if (!res.ok) {
    body.textContent = "Could not load the progress.";
    return;
  }
  const { sessions, stats } = await res.json();

  const card = document.createElement("div");
  card.className = "feedback progress";

  if (stats.count === 0) {
    const empty = document.createElement("p");
    empty.className = "small";
    empty.textContent =
      "No finished sessions yet. Chat a little, then press 'End session' to get your first scores.";
    card.appendChild(empty);
    body.appendChild(card);
    return;
  }

  // Summary tiles
  const tiles = document.createElement("div");
  tiles.className = "tiles";
  addTile(tiles, "Sessions", stats.count);
  addTile(tiles, "Average", stats.average);
  addTile(tiles, "Best", stats.best.overall);
  addTile(
    tiles,
    "Since first",
    stats.change === null ? "-" : (stats.change > 0 ? "+" : "") + stats.change
  );
  card.appendChild(tiles);

  // Chart with a dropdown to choose which score to show
  const controls = document.createElement("div");
  controls.className = "chart-controls";
  const label = document.createElement("span");
  label.textContent = "Show:";
  const select = document.createElement("select");
  Object.entries(CHART_CHOICES).forEach(([key, text]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = text;
    select.appendChild(option);
  });
  controls.append(label, select);
  card.appendChild(controls);

  const chartBox = document.createElement("div");
  card.appendChild(chartBox);
  drawChart(chartBox, sessions, "overall");
  select.onchange = () => drawChart(chartBox, sessions, select.value);

  // Strongest and weakest skill
  if (stats.strongest !== stats.weakest) {
    const insight = document.createElement("p");
    insight.className = "small";
    insight.textContent =
      `Strongest: ${CHART_CHOICES[stats.strongest]} (average ${stats.skill_averages[stats.strongest]}). ` +
      `Needs most work: ${CHART_CHOICES[stats.weakest]} (average ${stats.skill_averages[stats.weakest]}).`;
    card.appendChild(insight);
  }

  const note = document.createElement("p");
  note.className = "small";
  note.textContent =
    "Scores are estimates made by a small local AI, so look at the trend over several sessions rather than single numbers.";
  card.appendChild(note);

  // History, newest first
  const historyTitle = document.createElement("h4");
  historyTitle.textContent = "Session history";
  card.appendChild(historyTitle);

  [...sessions].reverse().forEach((s) => {
    const details = document.createElement("details");
    details.className = "history-item";

    const summary = document.createElement("summary");
    summary.textContent = `${s.date} · ${s.mode_label} · ${s.overall} / 10`;
    details.appendChild(summary);

    const scores = document.createElement("p");
    scores.textContent =
      `Grammar ${s.grammar} · Vocabulary ${s.vocabulary} · ` +
      `Clarity ${s.clarity} · Confidence ${s.confidence}`;
    details.appendChild(scores);

    if (s.strengths.length > 0) {
      const strengths = document.createElement("ul");
      s.strengths.forEach((text) => {
        const li = document.createElement("li");
        li.textContent = "+ " + text;
        strengths.appendChild(li);
      });
      details.appendChild(strengths);
    }
    if (s.improvements.length > 0) {
      const improvements = document.createElement("ul");
      s.improvements.forEach((text) => {
        const li = document.createElement("li");
        li.textContent = "- " + text;
        improvements.appendChild(li);
      });
      details.appendChild(improvements);
    }
    if (s.tip) {
      const tip = document.createElement("p");
      tip.textContent = "Tip: " + s.tip;
      details.appendChild(tip);
    }

    card.appendChild(details);
  });

  body.appendChild(card);
}

// ============================================================
// Sending messages
// ============================================================
// Used by the Send button and the Enter key
function sendFromInput() {
  if (busy || !sessionOpen) return;      // ignore while a reply is in progress
  const text = $("input").value;
  $("input").value = "";
  sendText(text);
}

// Used by typing AND by the microphone
async function sendText(text) {
  text = text.trim();
  if (!text || busy || !sessionOpen) return;
  stopSpeaking();                        // interrupt the partner if it is talking
  addBubble("user", text);
  await getReply(text);
}

$("send").addEventListener("click", sendFromInput);
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendFromInput();
});

// Asks the backend for a reply and shows it live, piece by piece
async function getReply(text) {
  busy = true;
  $("send").disabled = true;
  setStatus("Thinking...");
  const bubble = addBubble("assistant", "...");
  let fullText = "";
  let failed = false;
  let sources = [];

  try {
    const res = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona_id: currentPersona.id, message: text }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Server error");
    }

    // The backend tells us in a header which bank items it retrieved
    const header = res.headers.get("X-Sources");
    if (header) {
      try {
        sources = JSON.parse(decodeURIComponent(header));
      } catch {
        sources = [];
      }
    }

    // Read the reply as it arrives
    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
      bubble.textContent = fullText;
      setStatus("");
      $("messages").scrollTop = $("messages").scrollHeight;
    }
  } catch (err) {
    failed = true;
    bubble.textContent = "Error: " + err.message;
  }

  busy = false;
  $("send").disabled = false;
  setStatus("");
  $("input").focus();

  // On any problem, stop the hands-free loop instead of retrying forever
  if (failed || !fullText || fullText.startsWith("[Error:")) {
    $("handsFree").checked = false;
    return;
  }

  showSources(bubble, sources);
  afterReply(fullText);
}

// What happens when a reply is complete: speak it, then maybe listen again
function afterReply(text) {
  const next = () => {
    if ($("handsFree").checked) startListening();
  };
  if ($("voiceOn").checked) {
    speak(text, next);
  } else {
    next();
  }
}

// ============================================================
// Voice output (text to speech)
// ============================================================
function loadVoices() {
  if (!("speechSynthesis" in window)) return;
  voices = speechSynthesis.getVoices().filter((v) =>
    v.lang.toLowerCase().startsWith("en")
  );

  const select = $("voiceSelect");
  select.innerHTML = "";
  voices.forEach((v) => {
    const option = document.createElement("option");
    option.value = v.name;
    option.textContent = `${v.name} (${v.lang})`;
    select.appendChild(option);
  });

  // Use the saved voice, or pick a nicer-sounding one if available
  const saved = loadSetting("voiceName", "");
  const preferred =
    voices.find((v) => v.name === saved) ||
    voices.find((v) => /natural|google|online/i.test(v.name)) ||
    voices[0];
  if (preferred) select.value = preferred.name;
}

function selectedVoice() {
  return voices.find((v) => v.name === $("voiceSelect").value);
}

// Chrome loads its voice list a moment after the page opens
if ("speechSynthesis" in window) {
  speechSynthesis.onvoiceschanged = loadVoices;
}
loadVoices();

$("voiceSelect").addEventListener("change", () => {
  saveSetting("voiceName", $("voiceSelect").value);
  speak("Hello! This is how I sound.");      // quick preview
});

$("voiceOn").checked = loadSetting("voiceOn", "true") === "true";
$("voiceOn").addEventListener("change", () => {
  saveSetting("voiceOn", $("voiceOn").checked);
  if (!$("voiceOn").checked) stopSpeaking();
});

// A small pulse on the photo each time a word is spoken
function beat() {
  const avatar = $("avatar");
  avatar.classList.add("beat");
  setTimeout(() => avatar.classList.remove("beat"), 120);
}

function speak(text, onDone) {
  if (!("speechSynthesis" in window)) {
    if (onDone) onDone();
    return;
  }

  speechSynthesis.cancel();                // stop anything already being spoken
  const myToken = ++speakToken;            // identifies THIS speech

  // Remove markdown symbols, then split into sentences
  const clean = text.replace(/[*_`#>~]/g, "").replace(/\s+/g, " ").trim();
  const parts = (clean.match(/[^.!?]+[.!?]*/g) || [clean])
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    if (onDone) onDone();
    return;
  }

  speaking = true;
  $("avatar").classList.add("speaking");
  setStatus("Speaking...");

  const finish = () => {
    if (myToken !== speakToken) return;    // speech was interrupted: ignore
    speaking = false;
    $("avatar").classList.remove("speaking");
    setStatus("");
    if (onDone) onDone();
  };

  parts.forEach((part, i) => {
    const utterance = new SpeechSynthesisUtterance(part);
    const voice = selectedVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = SPEECH_LANG;
    }
    utterance.onboundary = beat;
    if (i === parts.length - 1) {          // only the last sentence ends the speech
      utterance.onend = finish;
      utterance.onerror = finish;
    }
    speechSynthesis.speak(utterance);
  });
}

function stopSpeaking() {
  speakToken++;                            // makes any pending "finish" ignore itself
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  speaking = false;
  $("avatar").classList.remove("speaking");
}

// ============================================================
// Voice input (speech to text)
// ============================================================
let recognition = null;
let heardText = "";          // what the microphone understood so far
let discardResult = false;   // true when we cancel on purpose (don't send)
let micFailed = false;       // true if the microphone reported a problem

function setupRecognition() {
  if (!SpeechRecognition) {
    // This browser (for example Firefox) has no speech recognition
    $("mic").classList.add("hidden");
    $("handsFree").parentElement.classList.add("hidden");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = SPEECH_LANG;
  recognition.interimResults = true;       // show words while you are speaking
  recognition.continuous = false;          // stop automatically after you pause

  recognition.onstart = () => {
    listening = true;
    heardText = "";
    discardResult = false;
    micFailed = false;
    $("mic").classList.add("listening");
    $("avatar").classList.add("listening");
    setStatus("Listening...");
  };

  recognition.onresult = (event) => {
    let finalPart = "";
    let interimPart = "";
    for (let i = 0; i < event.results.length; i++) {
      const piece = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalPart += piece;
      else interimPart += piece;
    }
    heardText = (finalPart + interimPart).trim();
    $("input").value = heardText;           // show what is being heard
  };

  recognition.onerror = (event) => {
    micFailed = true;
    if (event.error === "no-speech") {
      addNote("I didn't hear anything. Press the mic and try again.");
    } else if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      addNote("Microphone is blocked. Click the lock icon in the address bar and allow it.");
    } else if (event.error === "network") {
      addNote("Speech recognition needs an internet connection in this browser.");
    } else if (event.error !== "aborted") {
      addNote("Microphone error: " + event.error);
    }
    $("handsFree").checked = false;         // stop the hands-free loop
  };

  recognition.onend = () => {
    listening = false;
    $("mic").classList.remove("listening");
    $("avatar").classList.remove("listening");
    setStatus("");

    const text = discardResult || micFailed ? "" : heardText;
    $("input").value = "";
    if (text) sendText(text);               // send what the user said
  };
}

function startListening() {
  if (!recognition || listening || busy || !sessionOpen) return;
  stopSpeaking();                           // never listen while the partner talks
  try {
    recognition.start();
  } catch {
    /* already started: ignore */
  }
}

function abortListening() {
  if (recognition && listening) {
    discardResult = true;
    recognition.abort();
  }
}

// Microphone button: click to start, click again to finish early
$("mic").addEventListener("click", () => {
  if (listening) recognition.stop();
  else startListening();
});

// Hands-free: turn it on and the mic starts; it re-opens after each reply
$("handsFree").addEventListener("change", () => {
  if ($("handsFree").checked) {
    if (!busy && !speaking && !listening) startListening();
  } else {
    abortListening();
  }
});

// Stop sound, microphone and the hands-free loop (used when changing page)
function stopEverything() {
  $("handsFree").checked = false;
  abortListening();
  stopSpeaking();
  setStatus("");
}

// ---------- Start ----------
setupRecognition();
loadModes().then(loadPersonas).then(route);