# NuAuth protocol console (UI)

Minimal **text-only** browser UI for the NuAuth Deno API (`backend/api/main.ts`). No file uploads: paste UTF-8 into the payload field, or use **Load sample-dataset.txt** (requires HTTP hosting so the file can be fetched).

Design notes live in `.impeccable.md` (Impeccable skill context).

## Run

1. Start the API (from repo root), e.g. `deno task serve` (includes `--allow-run` for optional server-side Midnight).

   Optional — **one-click Midnight** from the UI: set `NUAUTH_SERVER_MIDNIGHT_CLI=1` in `.env` so `POST /api/creator/midnight/run-all-and-attest` can spawn `npm run run-all` inside `midnight-local-cli` on the API host. **Trusted dev only** (never on a public API).
2. Serve **this directory** over HTTP (not `file://`):

```bash
cd ui
python3 -m http.server 5175 --bind 127.0.0.1
```

Alternatively: `npx --yes serve . -p 5175` (some environments need a moment before the port accepts connections).

3. Open `http://127.0.0.1:5175` and set **API base URL** if your API is not on `http://127.0.0.1:8788`.

## Impeccable skill

Install/update the skill from the repo root:

```bash
npx skills add pbakaus/impeccable --yes
```

Then follow the skill’s **teach** flow when you want project-wide design context in `.impeccable.md` at the repository root.

## Media

If you need a binary payload, **do not** add a file picker here: put bytes in a `.txt` workflow (e.g. base64 in a text file) and paste into the payload field, or extend the backend separately.
