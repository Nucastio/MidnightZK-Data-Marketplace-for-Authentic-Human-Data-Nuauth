const $ = (id) => document.getElementById(id);

/* ── State ──────────────────────────────────────── */
let serverMidnightCli = false;
let currentDatasetId = "";
let stampTxHash = "";
let l1AnchorHex = "";

const logPlain = { cardano: "", midnight: "" };

/* ── Helpers ────────────────────────────────────── */
function ts() { return `${new Date().toISOString()} `; }
function logScroll(id) { return $(id).querySelector(".log-view-scroll"); }

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function detectSeverity(text) {
  const t = text.trimStart();
  if (/^OK\b/i.test(t)) return "ok";
  if (/^ERR\b/i.test(t)) return "err";
  if (/^WARN\b/i.test(t)) return "warn";
  return "neutral";
}

function formatLogClock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function enrichLogMessage(plain, chain) {
  let s = escapeHtml(plain);
  const hexes = [...plain.matchAll(/\b([0-9a-f]{64})\b/gi)].map((m) => m[1].toLowerCase());
  s = s.replace(/\b([0-9a-f]{64})\b/gi, (hex) => {
    const lower = hex.toLowerCase();
    return `<button type="button" class="log-hash" data-hash="${lower}" title="Copy hash">${hex}</button>`;
  });
  if (chain === "cardano" && hexes.length && /\b(txHash|lockTxHash|purchase txHash|stamp txHash)\b/i.test(plain)) {
    s += ` <a class="log-explorer" href="https://preprod.cardanoscan.io/transaction/${hexes[0]}" target="_blank" rel="noopener noreferrer">Cardanoscan</a>`;
  }
  return s;
}

function appendLogBlock(container, block, chain) {
  const raw = block.endsWith("\n") ? block.slice(0, -1) : block;
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const tMatch = i === 0 ? line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s+(.*)$/) : null;
    const msgText = tMatch ? tMatch[2] : line;
    const sev = detectSeverity(msgText);
    const row = document.createElement("div");
    row.className = "log-row";
    if (i > 0) row.classList.add("log-row--cont");
    if (sev !== "neutral") row.classList.add(`log-row--${sev}`);
    const timeEl = document.createElement("div");
    timeEl.className = "log-row-time";
    if (tMatch) { timeEl.textContent = formatLogClock(tMatch[1]); timeEl.title = tMatch[1]; }
    else { timeEl.textContent = "↳"; }
    const msgEl = document.createElement("div");
    msgEl.className = "log-row-msg";
    msgEl.innerHTML = enrichLogMessage(msgText, chain);
    row.append(timeEl, msgEl);
    container.append(row);
  }
}

function bindLogHashCopy(root) {
  root.addEventListener("click", (e) => {
    const btn = e.target.closest(".log-hash");
    if (!btn || !root.contains(btn)) return;
    e.preventDefault();
    navigator.clipboard.writeText(btn.dataset.hash);
    btn.classList.add("log-hash--copied");
    setTimeout(() => btn.classList.remove("log-hash--copied"), 1100);
  });
}

function appendCardano(line) {
  const block = `${ts()}${line}\n`;
  logPlain.cardano += block;
  const sc = logScroll("logCardano");
  appendLogBlock(sc, block, "cardano");
  sc.scrollTop = sc.scrollHeight;
}

function appendMidnight(line) {
  const block = `${ts()}${line}\n`;
  logPlain.midnight += block;
  const sc = logScroll("logMidnight");
  appendLogBlock(sc, block, "midnight");
  sc.scrollTop = sc.scrollHeight;
}

function appendBoth(line) {
  appendCardano(line);
  appendMidnight(line);
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function apiBase() { return $("apiBase").value.trim().replace(/\/$/, ""); }

async function apiFetch(path, { method = "GET", body } = {}) {
  const url = `${apiBase()}${path}`;
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  const text = await r.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { _raw: text }; }
  if (!r.ok) {
    const msg = json.error || json.message || text || r.statusText;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return json;
}

/* ── Step flow ──────────────────────────────────── */
function setStepStatus(stepNum, status) {
  const el = $(`step-${stepNum}`);
  if (el) el.dataset.status = status;
}

function activateStep(stepNum) {
  setStepStatus(stepNum, "active");
  const el = $(`step-${stepNum}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function unlockThrough(stepNum) {
  for (let i = 1; i <= stepNum; i++) {
    const el = $(`step-${i}`);
    if (el && el.dataset.status === "locked") {
      el.dataset.status = "active";
    }
  }
}

function showResult(id, isError) {
  const el = $(id);
  if (!el) return;
  el.hidden = false;
  el.classList.toggle("result-error", !!isError);
}

function cardanoscanUrl(hash) {
  return `https://preprod.cardanoscan.io/transaction/${hash}`;
}

function setTxLink(id, hash) {
  const el = $(id);
  if (!el) return;
  el.textContent = hash;
  el.href = cardanoscanUrl(hash);
}

/* ── Health ──────────────────────────────────────── */
function setHealth(ok, msg) {
  const pill = $("healthPill");
  const dot = $("statusDot");
  pill.textContent = msg;
  pill.dataset.state = ok ? "ok" : "err";
  dot.dataset.state = ok ? "ok" : "err";
}

async function refreshFeatures() {
  try {
    const j = await apiFetch("/health");
    serverMidnightCli = !!j.features?.serverMidnightCli;
    setHealth(true, `Connected · ${j.cardanoBackend} · ${j.network}`);
    appendCardano(`OK /health cardanoBackend=${j.cardanoBackend} network=${j.network}`);
    appendMidnight(`OK /health midnightStrict=${j.zkPolicy?.midnightRequiredForMarketplace} serverMidnightCli=${serverMidnightCli}`);
    updateMidnightHint();
  } catch (e) {
    setHealth(false, `Offline — ${e.message}`);
    appendCardano(`ERR /health ${e.message}`);
  }
}

function updateMidnightHint() {
  const hint = $("midnightHint");
  if (!serverMidnightCli) {
    hint.textContent = "Server-side Midnight CLI is disabled. Set NUAUTH_SERVER_MIDNIGHT_CLI=1 in .env, or use manual attestation below.";
  } else {
    hint.textContent = "";
  }
}

/* ── Event handlers ─────────────────────────────── */
$("btnHealth").addEventListener("click", refreshFeatures);

$("btnSample").addEventListener("click", async () => {
  try {
    const r = await fetch(new URL("./sample-dataset.txt", import.meta.url));
    if (!r.ok) throw new Error(String(r.status));
    $("bodyText").value = await r.text();
    appendCardano("OK loaded sample-dataset.txt");
  } catch (e) {
    $("bodyText").value = "NuAuth sample — paste any UTF-8 text here.\nThe backend stores encrypted ciphertext + commitment only.";
    appendCardano(`WARN sample load: ${e.message}`);
  }
});

// Step 1 — Register
$("btnRegister").addEventListener("click", async () => {
  const text = $("bodyText").value;
  if (!text.trim()) return;
  setStepStatus(1, "running");
  try {
    const reg = await apiFetch("/api/creator/register", {
      method: "POST",
      body: {
        filename: $("filename").value.trim() || "dataset.txt",
        contentBase64: utf8ToBase64(text),
      },
    });
    currentDatasetId = reg.datasetId;
    $("outDatasetId").textContent = reg.datasetId;
    $("outCreator").textContent = reg.creatorAddress || "";
    $("outCommitment").textContent = reg.commitment || "";
    showResult("result-register");
    setStepStatus(1, "complete");
    activateStep(2);
    appendCardano(`OK register datasetId=${reg.datasetId} creator=${reg.creatorAddress}`);
  } catch (e) {
    setStepStatus(1, "error");
    appendCardano(`ERR register ${e.message}`);
  }
});

// Step 2 — Stamp
$("btnStamp").addEventListener("click", async () => {
  if (!currentDatasetId) return;
  setStepStatus(2, "running");
  try {
    const st = await apiFetch("/api/creator/stamp", {
      method: "POST",
      body: { datasetId: currentDatasetId },
    });
    stampTxHash = st.txHash || "";
    l1AnchorHex = st.midnight?.l1AnchorDigestHex || "";
    setTxLink("outStampTx", stampTxHash);
    $("outL1Anchor").textContent = l1AnchorHex;
    showResult("result-stamp");
    setStepStatus(2, "complete");
    activateStep(3);
    appendCardano(`OK stamp txHash=${stampTxHash}`);
    if (l1AnchorHex) appendMidnight(`OK stamp → l1AnchorDigestHex=${l1AnchorHex}`);
  } catch (e) {
    setStepStatus(2, "error");
    appendCardano(`ERR stamp ${e.message}`);
  }
});

// Step 3 — Midnight ZK
$("btnMidnightServer").addEventListener("click", async () => {
  if (!currentDatasetId) return;
  setStepStatus(3, "running");
  try {
    appendMidnight("… run-all-and-attest started — may take several minutes");
    const j = await apiFetch("/api/creator/midnight/run-all-and-attest", {
      method: "POST",
      body: { datasetId: currentDatasetId },
    });
    const a = j.midnightAttestation;
    $("outContract").textContent = a?.contractAddress || "";
    $("outProveTx").textContent = a?.proveCreatorStampTxHash || "";
    $("outBindTx").textContent = a?.bindL1StampTxHash || "";
    $("outZkComplete").textContent = j.zkComplete ? "Yes" : "No";
    showResult("result-attest");
    setStepStatus(3, "complete");
    activateStep(4);
    appendMidnight(`OK run-all-and-attest zkComplete=${j.zkComplete} contract=${a?.contractAddress}`);
  } catch (e) {
    setStepStatus(3, "error");
    appendMidnight(`ERR run-all-and-attest ${e.message}`);
  }
});

$("btnAttest").addEventListener("click", async () => {
  if (!currentDatasetId) return;
  setStepStatus(3, "running");
  try {
    const j = await apiFetch("/api/creator/midnight/attest", {
      method: "POST",
      body: {
        datasetId: currentDatasetId,
        contractAddress: $("contractAddr").value.trim(),
        proveCreatorStampTxHash: $("proveTx").value.trim(),
        bindL1StampTxHash: $("bindTx").value.trim(),
      },
    });
    $("outContract").textContent = $("contractAddr").value.trim();
    $("outProveTx").textContent = $("proveTx").value.trim();
    $("outBindTx").textContent = $("bindTx").value.trim();
    $("outZkComplete").textContent = j.zkComplete ? "Yes" : "No";
    showResult("result-attest");
    setStepStatus(3, "complete");
    activateStep(4);
    appendMidnight(`OK manual attest zkComplete=${j.zkComplete}`);
  } catch (e) {
    setStepStatus(3, "error");
    appendMidnight(`ERR attest ${e.message}`);
  }
});

// Step 4 — List
$("btnList").addEventListener("click", async () => {
  if (!currentDatasetId) return;
  setStepStatus(4, "running");
  try {
    const j = await apiFetch("/api/creator/list-license", {
      method: "POST",
      body: {
        datasetId: currentDatasetId,
        priceLovelace: $("priceLovelace").value.trim(),
      },
    });
    const h = j.licenseListing?.lockTxHash || "";
    setTxLink("outListTx", h);
    showResult("result-list");
    setStepStatus(4, "complete");
    activateStep(5);
    appendCardano(`OK list-license lockTxHash=${h}`);
  } catch (e) {
    setStepStatus(4, "error");
    appendCardano(`ERR list-license ${e.message}`);
  }
});

// Step 5 — License
$("btnLicense").addEventListener("click", async () => {
  if (!currentDatasetId) return;
  setStepStatus(5, "running");
  try {
    const j = await apiFetch("/api/developer/license", {
      method: "POST",
      body: {
        datasetId: currentDatasetId,
        lovelace: $("buyLovelace").value.trim(),
      },
    });
    setTxLink("outLicenseTx", j.txHash || "");
    showResult("result-license");
    setStepStatus(5, "complete");
    activateStep(6);
    appendCardano(`OK license purchase txHash=${j.txHash}`);
  } catch (e) {
    setStepStatus(5, "error");
    appendCardano(`ERR license ${e.message}`);
  }
});

// Step 6 — Decrypt
$("btnDecrypt").addEventListener("click", async () => {
  if (!currentDatasetId) return;
  setStepStatus(6, "running");
  try {
    const j = await apiFetch("/api/developer/decrypt", {
      method: "POST",
      body: { datasetId: currentDatasetId },
    });
    const b64 = j.plaintextBase64;
    let shown = b64 || "";
    try { if (b64) shown = base64ToUtf8(b64); } catch { shown = `(binary base64)\n${b64}`; }
    $("plainOut").value = shown;
    showResult("result-decrypt");
    setStepStatus(6, "complete");
    appendCardano("OK decrypt (requires Cardano license + Midnight ZK policy)");
  } catch (e) {
    setStepStatus(6, "error");
    appendCardano(`ERR decrypt ${e.message}`);
  }
});

// Registry
$("btnDatasets").addEventListener("click", async () => {
  try {
    const j = await apiFetch("/api/datasets");
    $("datasetsPre").textContent = JSON.stringify(j, null, 2);
    appendCardano("OK GET /api/datasets");
  } catch (e) {
    $("datasetsPre").textContent = e.message;
  }
});

// Manifest
$("btnManifest").addEventListener("click", () => {
  const lines = [
    "NuAuth run manifest",
    `generated: ${new Date().toISOString()}`,
    `apiBase: ${apiBase()}`,
    `datasetId: ${currentDatasetId}`,
    `stampTxHash: ${stampTxHash}`,
    `l1AnchorDigestHex: ${l1AnchorHex}`,
    "",
    "=== Cardano log ===",
    logPlain.cardano.trimEnd(),
    "",
    "=== Midnight log ===",
    logPlain.midnight.trimEnd(),
    "",
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "nuauth-run-manifest.txt";
  a.click();
  URL.revokeObjectURL(a.href);
});

// Log controls
$("btnCopyLogsAll").addEventListener("click", async () => {
  const block = `=== Cardano ===\n${logPlain.cardano.trimEnd()}\n\n=== Midnight ===\n${logPlain.midnight.trimEnd()}\n`;
  await navigator.clipboard.writeText(block);
  appendBoth("(copied logs to clipboard)");
});

$("btnClearLogsAll").addEventListener("click", () => {
  logPlain.cardano = "";
  logPlain.midnight = "";
  logScroll("logCardano").innerHTML = "";
  logScroll("logMidnight").innerHTML = "";
});

// Step header click to collapse/expand
document.querySelectorAll(".step-header").forEach((header) => {
  header.addEventListener("click", () => {
    const step = header.closest(".step");
    if (step.dataset.status === "locked") return;
    const body = step.querySelector(".step-body");
    if (body) body.hidden = !body.hidden;
  });
});

/* ── Init ───────────────────────────────────────── */
bindLogHashCopy($("logCardano"));
bindLogHashCopy($("logMidnight"));

refreshFeatures().then(() => {
  appendBoth("Ready — follow the steps: Register → Stamp → ZK Attest → List → License → Decrypt");
});
