# developer.kakitu.org

The Kakitu developer documentation: a Docusaurus site (`docs/`, `src/pages/`), the OpenAPI
spec it serves at `/openapi.yaml` and renders at `/api-reference` (`static/openapi.yaml`), and
the three SDKs (`sdk/ts`, `sdk/python`, `sdk/php`).

**A push to `main` deploys the site** (Railway, `railway.toml`). Work on a branch.

## Local development

```bash
npm ci
npm start          # dev server with live reload
npm run build      # runs scripts/check-docs.mjs first, then builds into build/
```

`scripts/check-docs.mjs` fails the build if the docs or the spec have drifted from the
server's events, error codes, payout states and fields. To also check its own lists against
the server source, point it at a checkout of the wallet server:

```bash
KAKITU_SERVER_DIR=/path/to/kakitu-wallet-server npm run check-docs
```

Lint the spec with `npx @redocly/cli@1.25.0 lint static/openapi.yaml`.

## SDKs

Each SDK has its own README and tests (`npm test` in `sdk/ts`, `pytest` in `sdk/python`,
`vendor/bin/phpunit` in `sdk/php`). Publishing is manual: see `sdk/PUBLISHING.md`.
