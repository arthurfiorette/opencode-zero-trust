# Implementation plan

## Repository foundation

- [x] Confirm that `opencode-zero-trust` has no published package in the npm registry. Publication acceptance remains unverified.
- [x] Create an independent repository under `~/dev`, without modifying OpenCode.
- [x] Apply the `jev-playwright` Node, pnpm, Biome, TypeScript, release, and dependency-update baseline.
- [x] Provide server, TUI, and public RPC entrypoints in one package.
- [x] Verify unit tests, isolated OpenCode integration, packed exports, and cross-platform CI configuration locally.
- [x] Create the GitHub repository. Commit and push the verified foundation as the delivery step.

## Tunnel implementation (active)

Implementation scope: locally-managed Named Tunnel with an existing credentials JSON file and DNS route. Cloudflare Access is optional; native OpenCode authentication is always required. No Cloudflare account mutations or live exposure during development. The plugin generates a connector-only JSON/YAML config with exact-host ingress and a 404 fallback. When `access` is configured, connector-side Access JWT validation is required; otherwise the entire `originRequest` block is omitted. Runtime config remains opt-in; an unconfigured plugin is inert.

Process ownership: one process-global manager starts a Node helper on first configured Location activation. An IPC channel ties the helper to the daemon's lifetime. The helper supervises cloudflared and terminates it when the IPC channel closes. Location cleanup does not close the shared manager. The helper receives no OpenCode password. Its environment excludes model and Cloudflare admin secrets. Node 24.16+ and cloudflared must be installed separately.

Public configuration: required `hostname` with optional `{username}`, `{hostname}`, and `{os}` variables; optional absolute `credentialsFile` (defaulting to the sole regular `<UUID>.json` in `~/.cloudflared`); optional `access: { teamName, audience }`, optional absolute `serviceFile`, optional `cloudflaredPath` and `nodePath` (bare command name or absolute executable path). Incomplete Access objects and ambiguous credentials are rejected. No raw tokens or passwords in plugin options.

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

## Optional Access (unreleased)

- [x] Allow omission of `access` without changing native daemon authentication or pairing.
- [x] Omit the connector's `originRequest` block when Access is absent; retain required JWT validation and complete field validation when it is present.
- [x] Cover both modes through configured SDK/manager/helper integration and update setup guidance.
- [x] Run the full local check, including the packed consumer on npm 12.

## Hostname-only setup and documentation

- [x] Add local username, machine-name, and OS substitutions with DNS-label normalization and unknown-variable errors.
- [x] Discover a sole UUID-named tunnel credentials JSON without using administrative cert.pem or guessing among multiple candidates.
- [x] Replace empty-options union validation so missing fields no longer report configured keys as unknown.
- [x] Simplify the root README and move development/architecture to `docs/README.md`; remove public exports, releases, and devlog content.
- [x] Verify hostname-only setup through the actual package loader and rebuild `dist` for local use. Local checks pass with 60 unit tests, three isolated SDK integrations, and packed-consumer verification.

## DNS routing and sidebar pairing

- [x] Add `autoDns` (default `true`): inspect DNS, create a missing route using `cloudflared tunnel route dns <UUID> <hostname>`, never force-overwrite an existing record, and sanitize command failures. Setting `autoDns: false` leaves DNS management external.
- [x] Keep connector readiness separate from DNS resolution; show DNS route results and actionable failure messages.
- [x] Add a collapsible Zero Trust sidebar contribution using only the public TUI slot API. Generate a pairing link only on expansion/explicit refresh, hide it when collapsed, and discard expired links without persisting them.
- [x] Keep the QR readable within the sidebar or provide a full-size fallback when space is insufficient. Preserve `/zero-trust` as a full-size fallback.
- [x] Cover both automatic and externally managed DNS without real account changes in tests; verify sidebar state and native rendering through public interfaces locally. Native render checks are wired into the three-platform CI; new platform results remain pending.
- [x] Reproduce and fix the cold lazy-loading orphan-text crash, with a native Bun renderer regression. Document the live PWA failure caused by Cloudflare HTML injection breaking the service worker's index.html integrity hash; no CSP/integrity bypass or Cloudflare security changes were made.

## Explicit disable and uninstall

- [x] Add a confirmed `/zero-trust disable` command and RPC operation that stop the owned helper, cancel initialization, and keep the process manager disabled across Location reloads.
- [x] Document disable-before-removal and native service restart after prior removal; no credential files or Cloudflare resources are deleted.
- [x] Verify real configured-helper shutdown, idempotence, and stopped-state persistence through the SDK integration, without credential or DNS deletion.

## Compact sidebar and manual connection

- [x] Keep sidebar Online/Offline state and compact action buttons stable across background polling; remove URL/DNS diagnostics from the sidebar, retain full status command.
- [x] Add `autoStart: false` manual startup and explicit connect/disconnect RPC plus slash/palette/sidebar controls. Serialize transitions and preserve orphan-helper safety.
- [x] Add `{hostname,5}` / `{hostname,-5}` slicing for normalized hostname variables, rejecting invalid lengths and empty results.
- [x] Document QR capacity as dependent on terminal width and full pairing URL; measure short-host recommendations rather than promise a universal hostname limit.
- [x] Verify no redraw churn, disabled startup without DNS/process work, reconnect after a confirmed stop, and native rendering locally. `pnpm check` passes; new CI platform results remain pending.

## On-demand QR and native action styling

- [x] Replace bracket buttons with bright icons and muted labels that brighten on hover; activate on left mouse-up to avoid dismissing newly opened confirmations.
- [x] Sidebar shows a colored status dot, single-line truncated bare hostname, and actions only. Remove inline QR, pairing captions, and refresh controls. Expanding or polling must not issue pairing codes.
- [x] Open a QR-only dialog on explicit Scan QR code action, expire it without renewal, and retain diagnostics in `/zero-trust status`.
- [x] Disable all actions immediately during connection/confirmation work and server transitions. Cancelled confirmation restores the buttons.
- [x] Separate hostname/status from actions with one blank row; native render checks verify grey icons and labels throughout pending actions and server transition states.
- [x] Add a Copy link action below the QR, plus `c` shortcut, using the renderer's terminal clipboard API. Copy the existing pairing link without renewal; disable copying after expiry and test mouse-release activation.
- [x] Cover cold dialog render, hover/click styles, release-only activation, no automatic issuance, expiry, pending-action gating, and native render stability locally. Full `pnpm check` passes; physical camera scanning and new CI platform results remain unverified.

## Optional no-transform proxy

- [x] Add `preventTransform` defaulting to false. The helper starts a loopback-only transparent proxy only when enabled and points generated ingress at its ephemeral URL.
- [x] Preserve HTML bytes, cookies, authentication, Host, Origin, CSP, existing cache directives, and response streams. Append `no-transform` only to HTML/XHTML Cache-Control without duplicating it.
- [x] Forward HTTP/S and WebSocket traffic without injecting the daemon password; keep upstream target fixed and validated as loopback.
- [x] Close proxy listeners, inbound and upstream sockets with helper shutdown/cancellation, including active SSE/WebSockets. Keep disabled ingress direct to the daemon.
- [x] Add offline HTTP, authentication/cookie, SSE, WebSocket, and helper-lifecycle tests; verify the packed build. Local `pnpm check` passes; new platform CI and live Cloudflare validation remain outstanding.
- [x] Document the opt-in workaround and add a README comment pointing to https://github.com/anomalyco/opencode/issues/55905. No live daemon exposure or Cloudflare changes during tests.

## Hosted multi-server UI (separate deployment)

- [ ] Deploy the official OpenCode frontend to Cloudflare without a fork if its existing multi-server support suffices.
- [ ] Register explicit stable daemon URLs, with browser-local persistence. Do not scan numbered hostnames.
- [ ] Verify exact-origin CORS, per-server pairing tokens, Access preflight/login behavior, SSE, and WebSockets across subdomains.
- [ ] Do not assume authentication on the UI domain automatically authenticates API calls to daemon domains.

## Provisioning and release (later)

- [ ] Add optional Cloudflare provisioning using separately scoped credentials. Runtime connector credentials must not grant DNS or Access administration.
- [x] Configure npm trusted publishing for the GitHub workflow and its environment (reported by the maintainer).
- [x] Publish version `0.1.1` (published by the maintainer).
- [ ] Complete live Cloudflare DNS, Access, pairing, SSE, and WebSocket verification before treating remote access as end-to-end validated.

## Release 0.2.0

- [x] Confirm package version `0.2.0` and pass local `pnpm check`, including native TUI, packed consumer, proxy streaming/WebSocket/authentication, and SDK integration tests.
- [ ] Commit and push the complete release candidate; wait for Windows, Linux, and macOS CI.
- [ ] Create GitHub release `v0.2.0` and verify the trusted-publishing workflow and npm registry version.

The maintainer confirmed that `preventTransform` resolved the PWA installation failure on the live Cloudflare hostname. This does not independently validate all live Access policies, SSE, or WebSocket behavior.
