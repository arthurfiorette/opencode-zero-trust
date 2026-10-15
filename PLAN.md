# Implementation plan

## Repository foundation

- [x] Confirm that `opencode-zero-trust` has no published package in the npm registry. Publication acceptance remains unverified.
- [x] Create an independent repository under `~/dev`, without modifying OpenCode.
- [x] Apply the `jev-playwright` Node, pnpm, Biome, TypeScript, release, and dependency-update baseline.
- [x] Provide server, TUI, and public RPC entrypoints in one package.
- [x] Verify unit tests, isolated OpenCode integration, packed exports, and cross-platform CI configuration locally.
- [x] Create the GitHub repository. Commit and push the verified foundation as the delivery step.

## Tunnel implementation (active)

Implementation scope: locally-managed Named Tunnel with an existing credentials JSON file, DNS route, and Cloudflare Access application. No Cloudflare account mutations or live exposure during development. The plugin will generate a connector-only JSON/YAML config with exact-host ingress and a 404 fallback, and require Access JWT validation at the connector. Runtime config remains opt-in; an unconfigured plugin is inert.

Process ownership: one process-global manager starts a Node helper on first configured Location activation. An IPC channel ties the helper to the daemon's lifetime. The helper supervises cloudflared and terminates it when the IPC channel closes. Location cleanup does not close the shared manager. The helper receives no OpenCode password. Its environment excludes model and Cloudflare admin secrets. Node 24.16+ and cloudflared must be installed separately.

Public configuration planned for this implementation: `hostname`, `credentialsFile`, `access: { teamName, audience }`, optional absolute `serviceFile`, optional `cloudflaredPath` and `nodePath` (bare command name or absolute executable path). A partial configuration is rejected. `hostname` alone is no longer sufficient to enable a tunnel. No raw tokens or passwords in plugin options.

Public RPC: `status({})` returns `state` (`unconfigured`, `starting`, `connecting`, `ready`, `restarting`, `error`), optional hostname, URL, helper/connector PID, and a sanitized error code. `pair({})` returns `{ url, expiresIn }` after checking readiness and requesting a single-use code from the native daemon API. Expected pairing failures use declared RPC errors, never raw transport errors.

- [x] Establish process-wide tunnel ownership across concurrent Location plugin instances and plugin reloads.
- [x] Start on first plugin activation. Document that daemon startup without an activated Location does not load this plugin.
- [x] Resolve the hosting daemon through public APIs and verify its identity before selecting the tunnel target. Never start another daemon as a discovery side effect.
- [x] Implement `cloudflared` subprocess supervision without an OS-level watcher service. Platform results remain a separate verification gate.
- [x] Verify normal shutdown, abrupt daemon death, connector crashes, network recovery, duplicate activations, and conflicting configuration on Windows, Linux, and macOS using isolated fake-connector processes. [Passing CI run](https://github.com/arthurfiorette/opencode-zero-trust/actions/runs/38682707950).
- [x] Bind the helper to the daemon through IPC. Real-process tests cover normal stop and abrupt parent death; force-killing the helper itself is a documented orphan risk.
- [x] Require preconfigured Named Tunnel credentials and a stable per-device hostname for the first functional release.
- [x] Keep credentials out of RPC responses, logs, URLs, and process arguments. Avoid inheriting unrelated daemon secrets into child processes.
- [ ] Test Cloudflare Access together with native OpenCode authentication, SSE, and terminal WebSocket traffic.
- [x] Extend `/zero-trust` with status and an expiring, single-use pairing QR code. Do not conflict with OpenCode's existing `/connect` command.

Verification includes isolated configured SDK activation through the actual package loader, authenticated discovery, manager/helper startup, required Access ingress configuration, native pairing issuance, reuse across Location reloads, and failure without helper replacement. All 52 unit tests, two SDK integration tests, build/type/lint checks, and packed-consumer checks passed in CI on Windows, Linux, and macOS at commit `6590947`. Windows helper processes are detached from Node's kill-on-parent-exit job so they can perform IPC cleanup; connector processes remain attached to the helper. Only the external connector executable is substituted at the launch boundary. Offline ingress validation passed with installed cloudflared 2026.10.0. Live Cloudflare and camera scanning remain unverified.

## Hosted multi-server UI (separate deployment)

- [ ] Deploy the official OpenCode frontend to Cloudflare without a fork if its existing multi-server support suffices.
- [ ] Register explicit stable daemon URLs, with browser-local persistence. Do not scan numbered hostnames.
- [ ] Verify exact-origin CORS, per-server pairing tokens, Access preflight/login behavior, SSE, and WebSockets across subdomains.
- [ ] Do not assume authentication on the UI domain automatically authenticates API calls to daemon domains.

## Provisioning and release (later)

- [ ] Add optional Cloudflare provisioning using separately scoped credentials. Runtime connector credentials must not grant DNS or Access administration.
- [ ] Configure npm trusted publishing for the GitHub workflow and its environment.
- [ ] Publish only after tunnel lifecycle and authentication pass on all supported platforms. Publishing an empty scaffold does not reserve a usable product.
