# File-Backed Docs CMS

Standalone Next.js admin UI for editing a local documentation repository that contains `docs/`, `docs/navigation.json`, and `docs/site-settings.json`.

## Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

The app binds to port `3000` by default:

```text
http://localhost:3000/edit/pages
```

Set `CMS_REPO_ROOT` to the absolute path of the documentation repository.

## Build

```bash
npm run typecheck
npm run build
npm run start
```
