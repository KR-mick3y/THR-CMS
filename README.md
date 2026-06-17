# File-Backed Docs CMS Release

This directory contains a clean example distribution:

- `cms/`: Next.js admin CMS
- `example-wiki/`: VitePress documentation repository used by the CMS

No local Git settings, deploy keys, `.cms-private`, `.git`, `.next`, or `node_modules` directories are included.

## Run Admin

```bash
cd cms
npm install
npm run dev -- -p 3001
```

Open:

```text
http://localhost:3001/edit/pages
```

Example login:

```text
username: admin
password: admin
```

## Run Public Preview

```bash
cd example-wiki
npm install
npm run docs:dev -- --host 0.0.0.0 --port 5175
```

The CMS preview iframe uses `NEXT_PUBLIC_DOCS_PREVIEW_URL=http://localhost:5175`.
