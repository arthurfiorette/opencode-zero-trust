# Developer guide

## Development

Use Node.js 24.16+, pnpm 12, and Bun 1.3.14 for native TUI rendering tests. Build before adding the absolute repository path to OpenCode's `plugins` configuration.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm check
```

| Command | Purpose |
| --- | --- |
| `pnpm build` | Compile ESM and TypeScript declarations into `dist/`. |
| `pnpm format` | Apply the shared Biome configuration. |
| `pnpm lint-ci` | Check formatting and lint rules without writing files. |
| `pnpm test-types` | Typecheck source and tests. |
| `pnpm test` | Run configuration, lifecycle, and terminal-command unit tests. |
| `pnpm test:integration` | Exercise the plugin in an isolated real OpenCode SDK host. |
| `pnpm test:tui` | Mount the compiled sidebar through the public slot API using OpenTUI's headless renderer. |
| `pnpm test:package` | Pack, install, and smoke-test the compiled package. |
| `pnpm check` | Run lint, typechecks, tests, build, and package verification. |

SDK native parser addons may require Python and a C/C++ build toolchain. Their build scripts are approved in `pnpm-workspace.yaml`.

Tests use a fake connector and an isolated SDK host without model requests or live Cloudflare access. They do not establish public DNS, Access, SSE, or WebSocket correctness. Platform lifecycle claims require passing CI on the relevant platform.

Follow [AGENTS.md](../AGENTS.md) for contribution constraints and the [release guide](releasing.md) for publishing.

## Architecture

### Tunnel ownership

The server plugin shares one process-global tunnel manager across configured Locations and plugin reloads. It starts on the first configured Location activation unless `autoStart` is false, in which case only an explicit connect operation starts initialization. Empty options remain inert. Closing a TUI or unloading a Location does not stop the tunnel. Conflicting configurations are rejected; changing configuration requires a daemon restart.

The manager starts a Node.js helper that supervises `cloudflared`. IPC ties helper lifetime to the daemon, including when the helper is detached on Windows. Normal shutdown or abrupt daemon death disconnects IPC, causing the helper to terminate its connector. Readiness comes from `/ready` on the ephemeral loopback metrics port that `cloudflared` binds and announces on its own stderr; the helper never pre-selects a port another local process could claim, and discards all other connector output. A forcibly killed helper may leave the connector alive. The manager reports failure without automatically replacing that helper, avoiding duplicate connectors; check for a surviving connector before restarting.

Explicit disconnect/`disable` aborts startup/DNS work and closes the manager's owned IPC connection, awaiting helper shutdown before reporting `stopped`. Location reloads reuse that stopped manager. Explicit connect may initialize a new helper after a confirmed stop; uncertain cleanup or unexpected helper death must never launch a replacement. The command never deletes credentials, Cloudflare resources, or already-created DNS records.

### Daemon discovery

Only the existing default managed service is discovered automatically, through public `Service.discover`. Discovery requires native authentication, a loopback endpoint, and `server.info().pid === process.pid`. The registration's `pid` must also match before discovery sends any credentials, so a stale registration cannot leak them to whoever now holds its port. It never ensures or starts another daemon. Other channels or hosts require an absolute `serviceFile`; private servers without registration are unsupported.

### Credentials and authentication

The parent validates locally-managed credentials and derives the tunnel ID before starting the helper. Without an explicit `credentialsFile`, it accepts only the sole regular UUID-named JSON file in the user's `.cloudflared` directory. Credentials are never guessed among multiple candidates. Runtime credentials remain separate from administrative `cert.pem` files and remotely-managed tokens.

After authenticating and verifying the hosting daemon, `autoDns` checks A, AAAA, and CNAME answers. Existing records are left untouched. Only conclusive missing-record answers permit `cloudflared tunnel route dns <UUID> <hostname>`; lookup failures never trigger account changes. The parent runs this command with a sanitized environment and bounded timeout, using cloudflared's existing `cert.pem`. `autoDns: false` skips the check and command. A created route is reported separately from resolved DNS and connector readiness; public propagation and end-to-end authentication remain unverified.

Generated ingress routes only the exact configured hostname to the verified loopback daemon, with a 404 fallback. Optional `access` configuration enables connector-side JWT validation using `originRequest.access.required: true`, the team name, and the audience tag. Both Access fields are mandatory when provided. Omission disables that connector check, not an existing Cloudflare Access application. Native OpenCode authentication is always required.

The helper receives no daemon password, and child environments exclude unrelated secrets. Child processes run from the home directory because Windows searches the working directory before `PATH` for bare command names. `/zero-trust` requests a native five-minute, single-use pairing link only when the connector is ready. The link is neither persisted nor logged and contains no permanent password. Connector readiness is distinct from public end-to-end verification.

A separate hosted UI needs its own CORS and per-server authentication configuration. Access authentication on the UI domain does not authorize requests to daemon domains.

### Optional response header proxy

`preventTransform` defaults to false. When enabled, the helper calls `startProxy` in `src/proxy.ts` before writing cloudflared's config, replacing only the exact-host rule's service with an ephemeral `127.0.0.1` URL. The verified daemon remains the fixed upstream, and Access ingress validation and the 404 fallback are unchanged.

The proxy adds `no-transform` to HTML Cache-Control without replacing existing directives. It does not decode, buffer, or rewrite bodies, inject credentials, change Host/Origin, relax TLS verification, or weaken CSP/integrity checks. HTTP/S, SSE, and WebSocket traffic retain native authentication. Proxy listeners and active inbound/upstream sockets are owned by the helper and closed during cleanup. The disabled path connects cloudflared directly to the daemon.

This is an origin-header workaround for [OpenCode #55905](https://github.com/anomalyco/opencode/issues/55905). Cloudflare documents that `no-transform` suppresses JavaScript Detections injection; intermediary features that ignore it may still require separate configuration.

### Sidebar pairing

The TUI contributes a collapsible section through `sidebar.content`. Its native view loads only when mounted, keeping package imports usable in Node consumers. Solid's empty lazy-loading placeholder is converted to an absent node because OpenTUI boxes cannot contain raw text. The native render regression covers the cold-load path, mouse expansion, keyboard collapse, and width changes.

The sidebar shows a status dot and the bare hostname, truncated to its measured width. Stable action rows use a bright icon and muted label with hover feedback. An in-flight connection or confirmation immediately disables action dispatch; server transition states keep it disabled until initialization or shutdown finishes. Status polling and expansion never issue pairing codes. Only an explicit Scan QR code action requests pairing and opens a QR-only dialog. Expiration replaces the code without renewal; closing the dialog disposes its timer. Native button actions fire on left mouse-up so the release event cannot dismiss a confirmation opened by mouse-down.
