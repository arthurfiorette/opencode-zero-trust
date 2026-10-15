# Implementation plan

## Repository foundation

- [x] Confirm that `opencode-zero-trust` has no published package in the npm registry. Publication acceptance remains unverified.
- [x] Create an independent repository under `~/dev`, without modifying OpenCode.
- [x] Apply the `jev-playwright` Node, pnpm, Biome, TypeScript, release, and dependency-update baseline.
- [x] Provide server, TUI, and public RPC entrypoints in one package.
- [x] Verify unit tests, isolated OpenCode integration, packed exports, and cross-platform CI configuration locally.
- [x] Create the GitHub repository. Commit and push the verified foundation as the delivery step.

## Tunnel implementation (not implemented)

- [ ] Establish process-wide tunnel ownership across concurrent Location plugin instances and plugin reloads.
- [ ] Start on first plugin activation. Document that daemon startup without an activated Location does not load this plugin.
- [ ] Resolve the hosting daemon through public APIs and verify its identity before selecting the tunnel target. Never start another daemon as a discovery side effect.
- [ ] Supervise `cloudflared` as a subprocess on Windows, Linux, and macOS, without an OS-level watcher service.
- [ ] Verify normal shutdown, abrupt daemon death, connector crashes, network recovery, duplicate activations, and conflicting configuration.
- [ ] If a helper is required, bind it to the daemon using a process-lifetime connection. A PID file alone is not proof of ownership.
- [ ] Require preconfigured Named Tunnel credentials and a stable per-device hostname for the first functional release.
- [ ] Keep credentials out of RPC responses, logs, URLs, and process arguments. Avoid inheriting unrelated daemon secrets into child processes.
- [ ] Test Cloudflare Access together with native OpenCode authentication, SSE, and terminal WebSocket traffic.
- [ ] Extend `/zero-trust` with status and an expiring, single-use pairing QR code. Do not conflict with OpenCode's existing `/connect` command.

## Hosted multi-server UI (separate deployment)

- [ ] Deploy the official OpenCode frontend to Cloudflare without a fork if its existing multi-server support suffices.
- [ ] Register explicit stable daemon URLs, with browser-local persistence. Do not scan numbered hostnames.
- [ ] Verify exact-origin CORS, per-server pairing tokens, Access preflight/login behavior, SSE, and WebSockets across subdomains.
- [ ] Do not assume authentication on the UI domain automatically authenticates API calls to daemon domains.

## Provisioning and release (later)

- [ ] Add optional Cloudflare provisioning using separately scoped credentials. Runtime connector credentials must not grant DNS or Access administration.
- [ ] Configure npm trusted publishing for the GitHub workflow and its environment.
- [ ] Publish only after tunnel lifecycle and authentication pass on all supported platforms. Publishing an empty scaffold does not reserve a usable product.
