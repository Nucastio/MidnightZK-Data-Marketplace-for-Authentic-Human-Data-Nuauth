# Frontend Guide

## Overview

The NuAuth UI is a single-page application built with vanilla HTML, CSS, and JavaScript — no framework, no build step. It communicates with the backend via `fetch()` and implements a 6-step guided pipeline.

**Files:**
- `ui/index.html` — page structure
- `ui/app.js` — application logic
- `ui/styles.css` — styling
- `ui/sample-dataset.txt` — example dataset content

## Running

Serve the `ui/` directory with any static file server:

```bash
cd ui
python3 -m http.server 5175
# or
npx serve -l 5175
```

Open `http://127.0.0.1:5175` in a browser. Set the API base URL in the top nav bar to your backend address (default: `http://127.0.0.1:8788`).

## Step flow

The UI implements a sequential 6-step pipeline. Steps unlock as previous steps complete.

### Step states

| State | Visual | Behavior |
|-------|--------|----------|
| `locked` | Dimmed, non-interactive | Cannot interact until previous step completes |
| `active` | Purple left border | Ready for user action |
| `running` | Spinner icon | Request in flight |
| `complete` | Green checkmark | Step finished, next step unlocked |
| `error` | Red X icon | Step failed, can retry |

### State management

```javascript
setStepStatus(stepNum, status)  // Set a step's state
activateStep(stepNum)           // Set to active + scroll into view
unlockThrough(stepNum)          // Unlock all steps up to N
showResult(id)                  // Show inline result block
```

Steps are tracked by `data-status` attribute on each `.step` element.

## Key state variables

| Variable | Set by | Used by |
|----------|--------|---------|
| `currentDatasetId` | Step 1 (Register) | Steps 2-6 |
| `stampTxHash` | Step 2 (Stamp) | Activity log, manifest |
| `l1AnchorHex` | Step 2 (Stamp) | Activity log |
| `serverMidnightCli` | Health check | Step 3 (show/hide server button) |

## API communication

All API calls go through `apiFetch(path, options)`:

```javascript
const result = await apiFetch("/api/creator/register", {
  method: "POST",
  body: { filename: "data.txt", contentBase64: "..." }
});
```

The function:
1. Prepends the API base URL from the input field
2. Sets `Content-Type: application/json`
3. Parses JSON response
4. Throws on non-2xx status with the error message

## Activity log

The bottom of the page has a collapsible activity log split into two columns:

- **Cardano (L1)** — stamp transactions, listing locks, license purchases
- **Midnight (ZK)** — attestation progress, contract addresses, circuit tx hashes

Log entries include:
- Timestamps
- Severity detection (OK/ERR/WARN)
- Clickable hash buttons (copy to clipboard)
- Cardanoscan links for Cardano tx hashes

### Log functions

```javascript
appendCardano(line)   // Add to Cardano log
appendMidnight(line)  // Add to Midnight log
appendBoth(line)      // Add to both logs
```

## Result blocks

Each step has a hidden `.result` div that shows after completion:

- **Step 1:** Dataset ID, creator address, commitment
- **Step 2:** Tx hash (Cardanoscan link), L1 anchor hex
- **Step 3:** Contract address, prove tx, bind tx, ZK complete status
- **Step 4:** Lock tx hash (Cardanoscan link)
- **Step 5:** Purchase tx hash (Cardanoscan link)
- **Step 6:** Decrypted plaintext textarea

## Phase labels

Steps are grouped under phase badges:

| Phase | Steps | Color |
|-------|-------|-------|
| Creator | 1, 2, 3 | Purple |
| Marketplace | 4 | Teal |
| Developer | 5, 6 | Amber |

## CSS architecture

CSS custom properties for theming:

```css
--nc-brand: #8213e5;      /* Nucast purple */
--nc-bg: #0d0d12;         /* Dark background */
--nc-surface: #16161e;    /* Card background */
--nc-border: #2a2a36;     /* Subtle borders */
--nc-text: #e2e2ea;       /* Primary text */
--nc-text2: #9393a8;      /* Secondary text */
--nc-ok: #16a34a;         /* Success green */
--nc-err: #ef4444;        /* Error red */
--nc-warn: #f59e0b;       /* Warning amber */
```

## Dataset registry

Below the pipeline, a "Dataset Registry" section shows all registered datasets as formatted JSON. Click "Refresh" to reload from the API, or "Download manifest" to export a text file with the current run's details and activity logs.

## Extending the UI

To add a new step:

1. Add HTML in `index.html` following the `.step` template
2. Add a click handler in `app.js` following the pattern:
   ```javascript
   $("btnMyAction").addEventListener("click", async () => {
     setStepStatus(N, "running");
     try {
       const result = await apiFetch("/api/...", { method: "POST", body: {...} });
       // Update result display
       setStepStatus(N, "complete");
       activateStep(N + 1);
     } catch (e) {
       setStepStatus(N, "error");
     }
   });
   ```
3. Add styles for any new elements in `styles.css`
