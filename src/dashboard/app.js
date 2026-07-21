const $ = (id) => document.getElementById(id);
const state = { threads: [], selected: localStorage.getItem("winyolo.thread"), archived: false, mode: "safe", activeTurn: null, request: null, events: null, isolationRun: new URLSearchParams(location.search).get("isolation") || localStorage.getItem("winyolo.isolation") };

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
const formatTime = (seconds) => seconds ? new Date(seconds * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Unknown time";
const sourceName = (source) => typeof source === "string" ? source : source?.subAgent ? "subagent" : Object.keys(source ?? {})[0] ?? "Codex";
const statusName = (status) => typeof status === "string" ? status : status?.type ?? "idle";

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
  return data;
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.remove("hidden");
  setTimeout(() => $("toast").classList.add("hidden"), 2200);
}

function threadTitle(thread) { return thread.name || thread.preview || "Untitled conversation"; }

function renderThreadList() {
  $("thread-list").innerHTML = state.threads.length ? state.threads.map((thread) => `
    <button class="thread-row ${thread.id === state.selected ? "active" : ""}" data-thread="${escapeHtml(thread.id)}">
      <strong>${escapeHtml(threadTitle(thread))}</strong>
      <span>${escapeHtml(thread.cwd)} · ${formatTime(thread.updatedAt)}</span>
    </button>`).join("") : '<div class="sidebar-empty">No conversations found.</div>';
  document.querySelectorAll("[data-thread]").forEach((button) => button.addEventListener("click", () => selectThread(button.dataset.thread)));
}

async function loadThreads() {
  const query = new URLSearchParams({ archived: String(state.archived), limit: "50" });
  const search = $("thread-search").value.trim();
  if (search) query.set("search", search);
  const data = await api(`/api/codex/threads?${query}`);
  state.threads = data.threads;
  renderThreadList();
  if (state.selected && !state.threads.some((thread) => thread.id === state.selected) && !search) state.selected = null;
  if (!state.selected && state.threads[0]) await selectThread(state.threads[0].id);
}

function renderInput(input) {
  if (input.type === "text") return escapeHtml(input.text);
  if (input.type === "localImage" || input.type === "image") return `<div class="tool-card">Image · <code>${escapeHtml(input.path || input.url)}</code></div>`;
  return `<code>${escapeHtml(JSON.stringify(input))}</code>`;
}

function renderItem(item) {
  if (item.type === "userMessage") return `<article class="message user"><div class="bubble">${item.content.map(renderInput).join("<br>")}</div></article>`;
  if (item.type === "agentMessage") return `<article class="message"><div class="avatar">CX</div><div class="message-body"><p>${escapeHtml(item.text)}</p></div></article>`;
  if (item.type === "plan") return `<article class="message"><div class="avatar">PL</div><div class="message-body plan-card">${escapeHtml(item.text)}</div></article>`;
  if (item.type === "commandExecution") return `<article class="message"><div class="avatar">›_</div><div class="message-body tool-card"><div class="tool-head"><span>Command</span><span>${escapeHtml(item.status)}</span></div><code>${escapeHtml(item.command)}</code>${item.aggregatedOutput ? `<pre>${escapeHtml(item.aggregatedOutput)}</pre>` : ""}</div></article>`;
  if (item.type === "fileChange") return `<article class="message"><div class="avatar">Δ</div><div class="message-body tool-card"><div class="tool-head"><span>Patch</span><span>${escapeHtml(item.status)}</span></div><pre>${escapeHtml(JSON.stringify(item.changes, null, 2))}</pre></div></article>`;
  if (item.type === "mcpToolCall" || item.type === "dynamicToolCall" || item.type === "collabAgentToolCall") return `<article class="message"><div class="avatar">⚙</div><div class="message-body tool-card"><div class="tool-head"><span>${escapeHtml(item.type)}</span><span>${escapeHtml(item.status)}</span></div><code>${escapeHtml(item.tool)}</code><pre>${escapeHtml(JSON.stringify(item.result || item.arguments || item, null, 2))}</pre></div></article>`;
  return `<article class="message"><div class="avatar">·</div><div class="message-body tool-card"><div class="tool-head"><span>${escapeHtml(item.type)}</span></div><pre>${escapeHtml(JSON.stringify(item, null, 2))}</pre></div></article>`;
}

function renderTranscript(thread) {
  const items = (thread.turns || []).flatMap((turn) => turn.items || []);
  $("transcript").innerHTML = items.length ? items.map(renderItem).join("") : `<div class="welcome"><div class="welcome-mark">WY</div><h2>${escapeHtml(threadTitle(thread))}</h2><p>This native Codex thread has no loaded turns yet.</p></div>`;
  $("transcript").scrollTop = $("transcript").scrollHeight;
}

async function selectThread(threadId) {
  state.selected = threadId;
  localStorage.setItem("winyolo.thread", threadId);
  renderThreadList();
  const { thread } = await api(`/api/codex/threads/${encodeURIComponent(threadId)}`);
  $("thread-title").textContent = threadTitle(thread);
  $("thread-meta").textContent = `${formatTime(thread.updatedAt)} · ${thread.cwd} · ${sourceName(thread.source)} · ${statusName(thread.status)}`;
  $("resume-terminal").disabled = false;
  $("archive-thread").disabled = false;
  $("archive-thread").textContent = state.archived ? "Unarchive" : "Archive";
  const inProgress = [...(thread.turns || [])].reverse().find((turn) => turn.status === "inProgress");
  state.activeTurn = inProgress?.id || null;
  $("stop-turn").classList.toggle("hidden", !state.activeTurn);
  renderTranscript(thread);
  connectEvents();
  await loadPendingRequest();
}

async function loadPendingRequest() {
  const { pendingRequests = [] } = await api("/api/codex/diagnostics");
  state.request = pendingRequests.find((request) => request.params?.threadId === state.selected) || null;
  renderApproval();
}

function renderApproval() {
  const card = $("approval-card");
  card.classList.toggle("hidden", !state.request);
  if (!state.request) return;
  $("approval-title").textContent = state.request.method.replaceAll("/", " › ");
  $("approval-detail").textContent = JSON.stringify(state.request.params, null, 2);
}

function connectEvents() {
  state.events?.close();
  if (!state.selected) return;
  const after = sessionStorage.getItem("winyolo.lastEvent") || "0";
  state.events = new EventSource(`/api/codex/events?threadId=${encodeURIComponent(state.selected)}&after=${after}`);
  state.events.onmessage = async ({ data, lastEventId }) => {
    const event = JSON.parse(data);
    if (lastEventId) sessionStorage.setItem("winyolo.lastEvent", lastEventId);
    if (event.type === "reset") sessionStorage.removeItem("winyolo.lastEvent");
    if (event.type === "serverRequest") { state.request = event.data; renderApproval(); }
    if (event.type === "serverRequest/resolvedByClient") { state.request = null; renderApproval(); }
    if (event.type === "turn/started") { state.activeTurn = event.data.turn?.id; $("stop-turn").classList.remove("hidden"); }
    if (event.type === "turn/completed") { state.activeTurn = null; $("stop-turn").classList.add("hidden"); }
    if (event.type === "item/agentMessage/delta") {
      let live = document.querySelector("[data-live-assistant]");
      if (!live) { $("transcript").insertAdjacentHTML("beforeend", '<article class="message" data-live-assistant><div class="avatar">CX</div><div class="message-body"><p></p></div></article>'); live = document.querySelector("[data-live-assistant]"); }
      live.querySelector("p").textContent += event.data.delta || "";
      $("transcript").scrollTop = $("transcript").scrollHeight;
    }
    if (["item/completed", "turn/completed", "turn/plan/updated", "item/fileChange/patchUpdated"].includes(event.type)) await selectThread(state.selected);
  };
}

async function sendMessage(event) {
  event.preventDefault();
  const text = $("message").value.trim();
  const images = $("images").value.split(",").map((value) => value.trim()).filter(Boolean);
  if (!text && !images.length) return;
  $("send").disabled = true;
  try {
    if (state.mode === "isolated") {
      const created = await api("/api/isolation/runs", { method: "POST", body: JSON.stringify({ task: text, cwd: null }) });
      state.isolationRun = created.run.id; localStorage.setItem("winyolo.isolation", state.isolationRun);
      $("message").value = ""; $("images").value = ""; renderIsolation(created.run); connectIsolation(); return;
    }
    if (!state.selected) {
      const created = await api("/api/codex/threads", { method: "POST", body: JSON.stringify({ mode: state.mode }) });
      state.selected = created.thread.id;
      localStorage.setItem("winyolo.thread", state.selected);
    }
    const result = await api(`/api/codex/threads/${encodeURIComponent(state.selected)}/turns`, { method: "POST", body: JSON.stringify({ text, images, mode: state.mode }) });
    state.activeTurn = result.turn?.id;
    $("message").value = ""; $("images").value = "";
    $("stop-turn").classList.toggle("hidden", !state.activeTurn);
    await loadThreads();
  } catch (error) { toast(error.message); }
  finally { $("send").disabled = false; }
}

function renderIsolation(run) {
  $("isolation-card").classList.remove("hidden");
  $("isolation-title").textContent = `${run.status} · ${run.id}`;
  $("isolation-output").textContent = (run.events || []).filter((event) => event.type === "process.output").map((event) => event.data?.chunk || "").join("");
  $("isolation-accept").disabled = run.status !== "completed";
  $("isolation-rollback").disabled = ["accepted", "rolled_back"].includes(run.status);
  $("stop-turn").classList.toggle("hidden", run.status !== "running");
}

async function loadIsolation() {
  if (!state.isolationRun) return;
  const { run } = await api(`/api/isolation/runs/${encodeURIComponent(state.isolationRun)}`); renderIsolation(run);
  if (run.checkpointId) {
    const checkpoints = await api("/api/checkpoints");
    const checkpoint = checkpoints.checkpoints.find((entry) => entry.id === run.checkpointId);
    $("isolation-diff").textContent = checkpoint?.finalDiffHash ? `Diff SHA-256: ${checkpoint.finalDiffHash}\nPatch: ${checkpoint.patchPath}` : "Patch will be exported when the run finishes.";
  }
}

function connectIsolation() {
  state.events?.close(); if (!state.isolationRun) return;
  state.events = new EventSource(`/api/isolation/runs/${encodeURIComponent(state.isolationRun)}/events`);
  state.events.onmessage = () => loadIsolation().catch((error) => toast(error.message));
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll("[data-mode]").forEach((item) => item.classList.toggle("selected", item.dataset.mode === mode));
  const labels = { safe: ["SAFE · WORKSPACE", "Safe uses workspace-write, on-request approvals, and denied command networking."], yolo: ["YOLO · CONSTRAINED", "YOLO removes approvals but keeps workspace, network, and secret boundaries."], isolated: ["ISOLATED · RUNNER", "Isolated runs under WinYOLORunner in a disposable Git worktree with rollback."] };
  $("mode-indicator").textContent = labels[mode][0]; $("mode-indicator").className = `yolo-indicator ${mode}`; $("mode-note").textContent = labels[mode][1];
}

async function respondApproval(decision) {
  if (!state.request) return;
  try {
    await api(`/api/codex/requests/${encodeURIComponent(state.request.id)}/respond`, { method: "POST", body: JSON.stringify({ decision }) });
    state.request = null; renderApproval();
  } catch (error) { toast(error.message); }
}

async function loadAudit() {
  const { runs } = await api("/api/runs");
  $("audit-list").innerHTML = runs.length ? runs.map((run) => `<article class="audit-run"><h3>${escapeHtml(run.task)}</h3><p>${escapeHtml(run.status)} · ${escapeHtml(run.provider)} · ${new Date(run.createdAt).toLocaleString()} · ${run.events.length} events</p></article>`).join("") : '<div class="sidebar-empty">No WinYOLO execution receipts yet.</div>';
}

function showView(audit) {
  $("conversation-view").classList.toggle("hidden", audit);
  $("audit-view").classList.toggle("hidden", !audit);
  $("audit-tab").classList.toggle("active", audit);
  $("conversations-tab").classList.toggle("active", !audit);
  if (audit) loadAudit().catch((error) => toast(error.message));
}

$("composer").addEventListener("submit", sendMessage);
$("new-thread").addEventListener("click", () => { state.selected = null; localStorage.removeItem("winyolo.thread"); $("thread-title").textContent = "New conversation"; $("thread-meta").textContent = "Official Codex session store"; $("transcript").innerHTML = '<div class="welcome"><div class="welcome-mark">WY</div><h2>What are we building?</h2><p>Start a Codex thread here, or launch the official TUI with <code>winyolo</code>.</p></div>'; });
$("thread-search").addEventListener("input", (() => { let timer; return () => { clearTimeout(timer); timer = setTimeout(() => loadThreads().catch((error) => toast(error.message)), 180); }; })());
$("active-filter").addEventListener("click", () => { state.archived = false; $("active-filter").classList.add("active"); $("archived-filter").classList.remove("active"); loadThreads(); });
$("archived-filter").addEventListener("click", () => { state.archived = true; $("archived-filter").classList.add("active"); $("active-filter").classList.remove("active"); loadThreads(); });
document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
$("resume-terminal").addEventListener("click", async () => { if (!state.selected) return; await navigator.clipboard.writeText(`winyolo resume ${state.selected}`); toast("Resume command copied"); });
$("archive-thread").addEventListener("click", async () => { if (!state.selected) return; await api(`/api/codex/threads/${encodeURIComponent(state.selected)}/${state.archived ? "unarchive" : "archive"}`, { method: "POST", body: "{}" }); state.selected = null; localStorage.removeItem("winyolo.thread"); await loadThreads(); });
$("stop-turn").addEventListener("click", async () => { if (state.mode === "isolated" && state.isolationRun) return void await api(`/api/isolation/runs/${encodeURIComponent(state.isolationRun)}/interrupt`, { method: "POST", body: "{}" }); if (!state.selected || !state.activeTurn) return; await api(`/api/codex/threads/${encodeURIComponent(state.selected)}/turns/${encodeURIComponent(state.activeTurn)}/interrupt`, { method: "POST", body: "{}" }); });
$("isolation-accept").addEventListener("click", async () => { await api(`/api/isolation/runs/${encodeURIComponent(state.isolationRun)}/accept`, { method: "POST", body: "{}" }); await loadIsolation(); toast("Isolated patch accepted"); });
$("isolation-rollback").addEventListener("click", async () => { await api(`/api/isolation/runs/${encodeURIComponent(state.isolationRun)}/rollback`, { method: "POST", body: "{}" }); await loadIsolation(); toast("Isolated worktree rolled back; patch retained"); });
$("approval-accept").addEventListener("click", () => respondApproval("approve"));
$("approval-reject").addEventListener("click", () => respondApproval("reject"));
$("audit-tab").addEventListener("click", () => showView(true));
$("conversations-tab").addEventListener("click", () => showView(false));
$("refresh-audit").addEventListener("click", loadAudit);

api("/health").then((health) => { $("health").textContent = `● ${health.platform} · ${health.codex.available ? "Codex ready" : "Codex missing"}`; }).catch(() => { $("health").textContent = "● Service offline"; });
loadThreads().catch((error) => { $("thread-list").innerHTML = `<div class="sidebar-empty">${escapeHtml(error.message)}</div>`; });
setMode("safe");
if (state.isolationRun) { setMode("isolated"); loadIsolation().then(connectIsolation).catch(() => localStorage.removeItem("winyolo.isolation")); }
