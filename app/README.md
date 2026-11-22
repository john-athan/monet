# Monet app: the web client

Svelte 5 PWA, one dependency (`svelte`). Build: `bun run build.ts` (hashed assets, brotli and gzip, the ML worker as its own bundle, `vendor/ort` copied unchanged).

- `client/` is the PWA: `pages/` one file per route, `components/`, `lib/` (api, state, layout maths, band, SHA-256, upload, passkeys). `lib/ml-api.ts` is the only door to `lib/ml`.
- Develop without the server: `bun run build.ts --dev && bun tools/dev-mock.ts` (port 4321, serves the photos in the folder `MONET_TESTDATA` names; `MOCK_LOGGED_OUT=1` for the login screens).
- Tests: `bun test` (`tests/client-*.test.ts`, `tests/deps.test.ts`).
- Routes: /setup, /login, /, /suche, /foto/:id, /personen, /personen/:id, /orte, /orte/:id, /alben, /alben/:id, /serie/:key, /geraete.
