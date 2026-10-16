# OpenCode Zero Trust

Standalone OpenCode V2 plugin. User docs live in `README.md`; architecture and rationale in `docs/README.md`.

## Boundaries

- Do not modify OpenCode or import its private Core/Server modules. Use public V2 APIs only, and check the installed types before relying on one.
- Do not expose a local daemon, provision Cloudflare resources, publish npm releases, or change user configuration without explicit authorization.
- Never commit credentials, tunnel tokens, or local OpenCode state.
- Keep all `@opencode/*` dependencies pinned to the same exact version.
- `./rpc` must stay importable by clients without loading OpenTUI.

## Invariants

Changes must preserve these. `docs/README.md` explains the reasoning.

- Empty options are inert. `autoStart: false` performs no discovery, DNS change, or process launch before an explicit connect.
- One process-global tunnel per daemon. Location setup/cleanup is not daemon startup/shutdown, so closing a TUI or unloading a Location never stops the tunnel. Conflicting options are rejected.
- Never launch a replacement helper or connector after unexpected helper death or an unconfirmed stop, and never report shutdown success after a timeout. Disable never deletes credentials, tunnels, or DNS records.
- The helper runs on a separately installed Node.js. Do not assume the OpenCode executable can run JavaScript.
- Native OpenCode authentication always stays on. Access is an additional gate, never a replacement, and is all-or-nothing when configured. No proxy may inject credentials.
- The daemon password never reaches QR codes, URLs, process arguments, logs, or the helper. Pairing links come only from the native single-use API and are never persisted or logged.
- Child processes use the sanitized environment from `src/environment.ts`. Status errors stay sanitized codes.
- Only locally-managed credentials JSON is supported, never remotely-managed tunnel tokens.
- Daemon discovery never starts or ensures a daemon.
- `autoDns` creates only missing records, after daemon identity is verified. Never overwrite records or treat lookup failures as missing.
- The `preventTransform` proxy stays in `src/proxy.ts`, binds loopback only, and only appends `no-transform` to HTML Cache-Control. Never weaken CSP, SRI, or TLS verification.
- Connector readiness is not end-to-end verification. Never claim DNS, Access, or public reachability from it.

## Verification

- Run `pnpm check` before committing.
- Tests must never mutate DNS or touch a real Cloudflare account.
- TUI changes need a native render test that mounts the public slot through OpenTUI under Bun, including cold lazy-loading. Never insert raw text nodes into box renderables.
- Package tests must exercise the packed build.
- Claim platform behavior only after CI passes on that platform. Fake-connector tests do not prove live DNS, Access, SSE, or WebSocket behavior.
- No skipped placeholder tests or tests that duplicate implementation logic.

## Documentation

- English, concise, matching the README style of `../jev-playwright`. Keep the sponsor block and sentence-case headings. Do not invent badges, assets, or releases.
- The root README is user-facing only. Development and architecture belong in `docs/README.md`. Mark planned functionality as planned.
