# ONLYOFFICE Remote Setup (x86_64)

This setup is the recommended path for stable DOCX/XLSX/PPTX editing in EasyVault Desktop.

## 1) Requirements

- Linux x86_64 server (Ubuntu 22.04/24.04 recommended)
- DNS A record pointing `onlyoffice.yourdomain.com` to that server
- Docker + Docker Compose plugin installed
- Ports `80` and `443` open in firewall/security group

## 2) Deploy

From this repo:

```bash
cd ops/onlyoffice
cp .env.example .env
```

Edit `.env`:

- `DOMAIN=onlyoffice.yourdomain.com`
- `ACME_EMAIL=you@yourdomain.com`
- `ONLYOFFICE_JWT_SECRET=<long_random_secret>`

Start:

```bash
docker compose up -d
```

Check:

```bash
./check.sh
```

If healthy, this must return `200`:

```bash
curl -I "https://${DOMAIN}/web-apps/apps/api/documents/api.js"
```

## 3) Base44 env vars

Set in Base44 project env:

- `ONLYOFFICE_URL=https://onlyoffice.yourdomain.com`
- `ONLYOFFICE_JWT_SECRET=<same_secret_as_above>`

## 4) Callback settings

`onlyofficeEditorSession` must provide:

- `editorConfig.callbackUrl = https://easy-vault.com/api/apps/69970fbb1f1de2b0bede99df/functions/onlyofficeCallback`
- `editorConfig.customization.forcesave = true`

## 5) Verification flow

1. Open DOCX in EasyVault Desktop.
2. Edit text.
3. Save in ONLYOFFICE.
4. Confirm a new version appears in EasyVault.

Optional log checks:

```bash
docker logs onlyoffice --tail 200
docker exec onlyoffice sh -lc "tail -n 200 /var/log/onlyoffice/documentserver/docservice/out.log"
```

## 6) Operations

Update image:

```bash
cd ops/onlyoffice
docker compose pull
docker compose up -d
```

Restart:

```bash
docker compose restart
```

Rollback strategy:

- Pin known-good tag in `docker-compose.yml` instead of `latest`.
- Re-deploy with `docker compose up -d`.

