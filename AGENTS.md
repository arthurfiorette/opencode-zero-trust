# OpenCode Zero Trust

## Scope

- Build a standalone OpenCode V2 plugin. Do not modify OpenCode or depend on its private Core/Server modules.
- One npm package exposes the server plugin at `.` and the terminal plugin at `./tui`. Keep `./rpc` usable by clients.
- This repository currently contains a scaffold, not a working tunnel. Keep documentation and status responses honest.
- Track implementation in `PLAN.md`. Do not expose a local daemon, provision Cloudflare resources, publish npm releases, or change user configuration without explicit authorization.

## Toolchain

- Follow the baseline from `../jev-playwright`: pnpm 12, Node.js 24.16+, ESM, TypeScript, and Arthur's shared Biome configuration.
- Use `pnpm` scripts. Keep the lockfile committed and installs reproducible.
- Keep OpenCode dependencies on matching exact versions. Consult V2 documentation and installed public types before using an API.
- Use normal TypeScript modules, type-only imports, and `.js` relative imports for the compiled ESM output.
- Never commit generated `dist`, credentials, tunnel tokens, or local OpenCode state.

## Architecture

- Plugin setup/cleanup is Location-scoped, not a global daemon startup/shutdown hook. Do not equate them.
- Future tunnel ownership must be process-wide and work on Windows, Linux, and macOS. Closing a TUI or unloading one Location must not terminate a tunnel still owned by the daemon.
- Keep one stable hostname and tunnel identity per computer. Do not share a tunnel token between independent daemons.
- Never place a permanent OpenCode password in a QR code, URL, process arguments, or logs.
- Keep Cloudflare Access plus native OpenCode authentication. Do not add a proxy that injects an administrative password.

## Verification

- Run `pnpm check` before committing.
- Unit tests protect configuration and terminal-plugin behavior; integration tests use an isolated, real embedded OpenCode host without paid models or Cloudflare access.
- Package tests must exercise the packed build, not only source imports.
- CI covers Windows, Linux, and macOS. Passing local macOS tests does not prove Windows process lifecycle behavior.
- Do not add skipped placeholder tests or tests that merely duplicate implementation logic.

## Documentation

- Follow the README layout and concise style of `../jev-playwright`. Write documentation in English.
- Separate instructions, configuration reference, and architecture explanations. Mark planned functionality as planned.
- Keep the README sponsor block, sentence-case headings, and code examples consistent. Do not invent badges, assets, or published releases.
