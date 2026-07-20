const $ = (id) => document.getElementById(id);
let currentRun = null;
let eventSource = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function renderRun(run) {
  currentRun = run;
  $("run-title").textContent = run.task;
  $("run-status").textContent = run.status.replaceAll("_", " ");
  $("run-status").className = `status ${run.status}`;
  const approval = run.pendingApproval;
  $("approval").classList.toggle("hidden", !approval);
  if (approval) {
    $("approval-reasons").textContent = approval.assessment.reasons.join(" ");
    $("approval-command").textContent = JSON.stringify(approval.call.arguments, null, 2);
    $("confirmation").placeholder = approval.assessment.confirmationPhrase;
  }
}

function appendEvent(event) {
  if ($("timeline").querySelector(`[data-event-id="${event.id}"]`)) return;
  $("timeline").querySelector(".empty")?.remove();
  const element = document.createElement("article");
  element.className = `event ${event.type}`;
  element.dataset.eventId = event.id;
  const details = event.data ? `<details><summary>details</summary><pre>${escapeHtml(JSON.stringify(event.data, null, 2))}</pre></details>` : "";
  element.innerHTML = `<div class="time">${new Date(event.at).toLocaleTimeString()}</div><div class="dot"></div><div class="event-card"><strong>${escapeHtml(event.type)}</strong><p>${escapeHtml(event.message)}</p>${details}</div>`;
  $("timeline").append(element);
}

async function refreshRun() {
  if (!currentRun) return;
  const { run } = await api(`/api/runs/${currentRun.id}`);
  renderRun(run);
  for (const event of run.events) appendEvent(event);
}

function streamRun(run) {
  eventSource?.close();
  eventSource = new EventSource(`/api/runs/${run.id}/events`);
  eventSource.onmessage = async ({ data }) => {
    appendEvent(JSON.parse(data));
    await refreshRun();
  };
  eventSource.onerror = () => setTimeout(refreshRun, 1000);
}

$("run-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const { run } = await api("/api/runs", { method: "POST", body: JSON.stringify({ task: $("task").value, provider: $("provider").value, cwd: $("cwd").value || undefined }) });
    $("timeline").innerHTML = "";
    renderRun(run);
    streamRun(run);
  } catch (error) { alert(error.message); }
  finally { button.disabled = false; }
});

$("approve").addEventListener("click", async () => {
  const approval = currentRun?.pendingApproval;
  if (!approval) return;
  try {
    await api(`/api/runs/${currentRun.id}/approvals/${approval.id}`, { method: "POST", body: JSON.stringify({ decision: "approve", confirmation: $("confirmation").value }) });
    await refreshRun();
  } catch (error) { alert(error.message); }
});

$("reject").addEventListener("click", async () => {
  const approval = currentRun?.pendingApproval;
  if (!approval) return;
  await api(`/api/runs/${currentRun.id}/approvals/${approval.id}`, { method: "POST", body: JSON.stringify({ decision: "reject" }) });
  await refreshRun();
});

api("/health").then((health) => { $("health").textContent = `${health.platform} · ${health.model}`; $("health").className = "pill ok"; }).catch(() => { $("health").textContent = "service offline"; });
api("/api/runs").then(({ runs }) => { if (runs[0]) { renderRun(runs[0]); for (const event of runs[0].events) appendEvent(event); streamRun(runs[0]); } });
