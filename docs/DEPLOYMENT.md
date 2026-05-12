# Deployment Guide

## Local development

See [Setup Guide](SETUP.md) for full local setup instructions.

```bash
deno task serve          # Backend on :8788
cd ui && python3 -m http.server 5175  # Frontend on :5175
```

## Docker deployment (recommended)

### Midnight network (required for ZK)

The Midnight local network runs in Docker:

```bash
cd /path/to/midnight-local-network
docker compose up -d node indexer
```

Proof servers must also be running (ports 6300, 6301).

### Containerizing the backend

Example `Dockerfile` for the Deno backend:

```dockerfile
FROM denoland/deno:2.0.0

WORKDIR /app
COPY . .
RUN bash scripts/patch-libsodium-deno.sh
RUN deno cache backend/api/main.ts

EXPOSE 8788
CMD ["deno", "task", "serve"]
```

### Single VPS deployment

For a complete deployment on one machine (e.g., DigitalOcean, Hetzner):

1. Install Docker and Deno on the VPS
2. Clone the repo
3. Copy `.env` with production values
4. Start Midnight Docker stack
5. Start the backend (`deno task serve`)
6. Serve `ui/` via nginx or a static file server
7. Configure a reverse proxy (nginx/Caddy) for HTTPS

### Nginx example

```nginx
server {
    listen 443 ssl;
    server_name nuauth.example.com;

    # Frontend
    location / {
        root /path/to/ui;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:8788;
        proxy_set_header Host $host;
        proxy_read_timeout 600s;  # Midnight ZK step takes minutes
    }

    location /health {
        proxy_pass http://127.0.0.1:8788;
    }

    location /docs {
        proxy_pass http://127.0.0.1:8788;
    }
}
```

Note: `proxy_read_timeout 600s` is needed because the Midnight ZK pipeline (`/api/creator/midnight/run-all-and-attest`) can take 3-5 minutes.

## Cloudflare Tunnel (quick public access)

For temporary public URLs without configuring DNS or HTTPS:

```bash
# Install cloudflared
curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared

# Tunnel the backend
cloudflared tunnel --url http://127.0.0.1:8788 --no-autoupdate &

# Tunnel the frontend
cloudflared tunnel --url http://127.0.0.1:5175 --no-autoupdate &
```

Update the API base URL in `ui/index.html` to point to the backend tunnel URL.

These are free quick tunnels — no Cloudflare account needed, but URLs are temporary and have no uptime guarantee.

## Split deployment (CDN + VPS)

Deploy the frontend to a CDN and the backend to a VPS:

### Frontend on Vercel / Netlify / GitHub Pages

The `ui/` directory is static — no build step needed:

```bash
# Vercel
cd ui && npx vercel --prod

# Netlify
cd ui && npx netlify deploy --prod --dir .

# GitHub Pages
# Push ui/ contents to gh-pages branch
```

Update the default API base URL in `index.html` to the backend's public URL.

### Backend on VPS

Run the Deno backend + Midnight Docker stack on the VPS as described above.

## Environment variables for production

| Variable | Production value | Notes |
|----------|-----------------|-------|
| `CARDANO_BACKEND` | `blockfrost` | Always use Blockfrost for testnet/mainnet |
| `CARDANO_NETWORK` | `Preprod` or `Mainnet` | Choose your target network |
| `NUAUTH_SERVER_MIDNIGHT_CLI` | `0` | Disable server-side CLI in production |
| `NUAUTH_REQUIRE_MIDNIGHT_STRICT` | `true` | Always enforce ZK in production |
| `ABE_MASTER_KEY_HEX` | Random 64-char hex | Generate fresh: `openssl rand -hex 32` |
| `WALLET_MNEMONIC` | Dedicated wallet | Never reuse test mnemonics |

## Security checklist

- [ ] `.env` is not committed to git (check `.gitignore`)
- [ ] `ABE_MASTER_KEY_HEX` is unique and randomly generated
- [ ] Wallet mnemonics are dedicated to this application (not shared with other projects)
- [ ] `NUAUTH_SERVER_MIDNIGHT_CLI=0` in production (or add authentication)
- [ ] Backend is behind HTTPS (via reverse proxy or tunnel)
- [ ] CORS `origin` is restricted to your frontend domain (currently `*`)
- [ ] API rate limiting is configured at the reverse proxy level
- [ ] Blockfrost API key is not exposed in error responses (verified: it's sent as HTTP header, not in URLs)
- [ ] Docker containers are on an internal network (not exposed to the internet)

## Resource requirements

| Component | RAM | CPU | Disk |
|-----------|-----|-----|------|
| Deno backend | 256 MB | 1 core | Minimal |
| Midnight node | 1 GB | 1 core | 5 GB |
| Midnight indexer | 512 MB | 1 core | 1 GB |
| Proof server (each) | 2 GB | 2 cores | 10 GB (prover keys) |
| **Total** | ~4-6 GB | 4+ cores | ~20 GB |

Proof servers are the heaviest component — they download prover keys (~2 GB each) on first start and require significant RAM during proof generation.

## Monitoring

### Health check

```bash
curl https://your-domain.com/health
```

Returns JSON with service status, Cardano backend, network, and feature flags.

### Docker container health

```bash
docker inspect node --format '{{.State.Health.Status}}'
docker inspect indexer --format '{{.State.Health.Status}}'
```

### Logs

```bash
# Backend
tail -f /path/to/backend.log

# Docker containers
docker logs -f node
docker logs -f indexer
```
