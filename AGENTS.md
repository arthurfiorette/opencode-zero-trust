# OpenCode Zero Trust

## Scope

- Build a standalone OpenCode V2 plugin. Do not modify OpenCode or depend on its private Core/Server modules.
- One npm package exposes the server plugin at `.` and the terminal plugin at `./tui`. Keep `./rpc` usable by clients.
- Runtime tunnel support is opt-in. Empty options must remain inert. Keep connector readiness distinct from public DNS/Access end-to-end verification; live Cloudflare validation remains outstanding.
- Track implementation in `PLAN.md`. Do not expose a local daemon, provision Cloudflare resources, publish npm releases, or change user configuration without explicit authorization.

## Toolchain

- Follow the baseline from `../jev-playwright`: pnpm 12, Node.js 24.16+, ESM, TypeScript, and Arthur's shared Biome configuration.
- Use `pnpm` scripts. Keep the lockfile committed and installs reproducible.
- Keep OpenCode dependencies on matching exact versions. Consult V2 documentation and installed public types before using an API.
- Use normal TypeScript modules, type-only imports, and `.js` relative imports for the compiled ESM output.
- Never commit generated `dist`, credentials, tunnel tokens, or local OpenCode state.
- The helper requires separately installed Node.js 24.16+ (`node` on PATH or absolute `nodePath`). Do not assume the OpenCode executable can run JavaScript. `cloudflared` is user-installed; recommend 2025.6.1+.

## Architecture

- Plugin setup/cleanup is Location-scoped, not a global daemon startup/shutdown hook. Do not equate them.
- Tunnel ownership is process-global and starts on the first configured Location activation. Closing a TUI or unloading a Location must not stop it. Configuration changes require a daemon restart; reject conflicting configured Locations.
- Keep the Node helper tied to daemon lifetime through IPC. Normal or abrupt daemon death must disconnect it and terminate the connector. A forcibly killed helper may leave a connector alive; do not automatically start a replacement helper and risk duplicates.
- Use locally-managed Named Tunnel credentials JSON, never remotely-managed tunnel tokens. Validate credentials and derive `TunnelID` in the parent. Require private POSIX permissions (recommend 600/400); Windows users must protect NTFS ACLs.
- Keep one stable hostname and tunnel identity per computer. Do not share credentials between independent daemons. Runtime configuration needs hostname, absolute credentialsFile, and Access team slug plus 64-hex AUD; executable options accept only command names or absolute paths without arguments.
- Discover only the existing default managed service automatically, using public `Service.discover`, native authentication, loopback validation, and `server.info().pid === process.pid`. Never ensure/start a daemon as a discovery side effect. Other channels/hosts need an explicit absolute serviceFile; private servers without registration are unsupported.
- Generate exact-host ingress plus a 404 fallback. Require connector-side Access JWT validation with `originRequest.access.required`, teamName, and audTag. Do not allow a configuration that omits this check.
- Never place a permanent OpenCode password in a QR code, URL, process arguments, or logs.
- Give the helper no daemon password and exclude unrelated secrets from child environments. Pair through the native five-minute, single-use API; never persist or log the pairing URL. Keep status errors sanitized.
- Keep Cloudflare Access plus native OpenCode authentication. Do not add a proxy that injects an administrative password.
- Hosted multi-server UI support remains a separate deployment. Do not assume UI-domain Access authentication authorizes requests to daemon domains.

## Verification

- Run `pnpm check` before committing.
- Unit tests protect configuration, process lifecycle, and terminal-plugin behavior. Integration tests use a fake connector and an isolated real OpenCode SDK host without paid models or live Cloudflare access.
- Package tests must exercise the packed build, not only source imports.
- CI targets Windows, Linux, and macOS. Claim platform lifecycle validation only after the relevant CI results pass. Local macOS tests do not prove Windows behavior; fake-connector tests do not prove live DNS, Access, SSE, or WebSocket behavior.
- Do not add skipped placeholder tests or tests that merely duplicate implementation logic.

## Documentation

- Follow the README layout and concise style of `../jev-playwright`. Write documentation in English.
- Separate instructions, configuration reference, and architecture explanations. Mark planned functionality as planned.
- Keep the README sponsor block, sentence-case headings, and code examples consistent. Do not invent badges, assets, or published releases.
