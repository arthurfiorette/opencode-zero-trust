<p align="center">
   <b>Using this package?</b> Please consider <a href="https://github.com/sponsors/arthurfiorette" target="_blank">donating</a> to support my open source work ❤️
  <br />
  <sup>
   Help opencode-zero-trust grow! Star and share this repository with your friends and co-workers!
  </sup>
</p>

<br />

# OpenCode Zero Trust

An OpenCode V2 plugin scaffold for remote access through Cloudflare Tunnel and Access. One package contains the server plugin, terminal commands, and a public RPC contract.

> [!WARNING]
> This is a development scaffold. It does not start `cloudflared`, configure Cloudflare Access, expose your daemon, or generate pairing QR codes. `/zero-trust` reports that tunnel support is not implemented. Do not rely on this package to secure a server.

**Requirements:** Node.js 24.16+ for development, pnpm 12.6.0, and OpenCode packages 2.0.29. CI targets Windows, Linux, and macOS. Cross-platform tunnel process handling is still planned.

[Get started](#get-started) · [Configuration reference](#configuration-reference) · [Development](#development) · [Implementation plan](PLAN.md)

<br />

## Get started

The package has not been published to npm. Build a local checkout:

```sh
git clone https://github.com/arthurfiorette/opencode-zero-trust.git
cd opencode-zero-trust
nvm use
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

Add the absolute checkout path to the `plugins` list in your global OpenCode configuration:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-zero-trust"]
}
```

OpenCode resolves the server entrypoint and the companion `./tui` export from the same package. Once OpenCode loads the plugin for a Location, use `/zero-trust` to display its scaffold status. No Cloudflare credentials are needed for this check.

After a functional version is published, the intended configuration is a single package entry: `"plugins": ["opencode-zero-trust"]`. There are no separate server and TUI packages to install.

<br />

## Configuration reference

Options use OpenCode's package-and-options syntax:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-zero-trust",
      "options": {
        "hostname": "opencode-mac.example.com"
      }
    }
  ]
}
```

| Option | Type | Default | Current behavior |
| --- | --- | --- | --- |
| `hostname` | DNS hostname | Unset | Validated, normalized to lowercase, and included in the status response. Does not create DNS records or start a tunnel. |

URLs, IP addresses, wildcard domains, single-label names, and unknown options are rejected. There are no token or password options in this scaffold. Do not put secrets in plugin options.

### Public exports

| Export | Purpose |
| --- | --- |
| `opencode-zero-trust` | Default server plugin definition |
| `opencode-zero-trust/tui` | Default terminal plugin definition |
| `opencode-zero-trust/rpc` | `ZeroTrust` RPC definition and status schema/type |

`ZeroTrust.status({})` returns `{ state: "not-implemented", hostname?: string }`. It does not report a working tunnel. RPC calls must target the Location where the plugin is loaded.

<br />

## Development

```sh
pnpm check
```

| Command | Purpose |
| --- | --- |
| `pnpm build` | Compile ESM and TypeScript declarations into `dist/` |
| `pnpm format` | Format using the shared Biome configuration |
| `pnpm lint-ci` | Check formatting and lint rules without writing files |
| `pnpm test-types` | Typecheck source and tests |
| `pnpm test` | Run configuration and terminal-command unit tests |
| `pnpm test:integration` | Load the plugin in an isolated embedded OpenCode host and call its RPC |
| `pnpm test:package` | Pack, install, and smoke-test the compiled public exports in a temporary consumer |
| `pnpm check` | Run lint, typecheck, tests, build, and package verification |

Integration tests do not use your running daemon, personal OpenCode database, model credentials, or Cloudflare account. They exercise the public SDK and plugin API without issuing model requests.

The SDK development dependency includes native parser addons. Installing it may require Python and a C/C++ build toolchain. Their build scripts are explicitly approved in `pnpm-workspace.yaml`; CI uses hosted runners with those tools available.

See [AGENTS.md](AGENTS.md) for development constraints and [PLAN.md](PLAN.md) for the remaining work.

<br />

## Planned architecture

The server plugin will own one tunnel manager per daemon process, shared across Location instances. It will supervise `cloudflared` on Windows, Linux, and macOS. The terminal entrypoint will show tunnel status and short-lived pairing QR codes.

OpenCode plugin setup and cleanup are Location-scoped. They are not global daemon startup or shutdown hooks. The earliest supported startup point is the first activation of a Location that loads this plugin; a daemon with no activated Location may never load it. Closing the terminal must not stop the tunnel, and unloading one Location must not stop a tunnel used by the process.

A hosted OpenCode frontend can use its existing multi-server registry with a stable hostname for each computer. That frontend deployment is separate from this npm package. Numbered-hostname scanning and an always-running OS discovery service are not part of the plan.

### Security boundaries

Use a preconfigured Named Tunnel, Cloudflare Access, and OpenCode's native authentication. A tunnel alone does not authenticate visitors. An exposed daemon can execute tools with the local user's permissions; it is not merely a read-only chat page.

Each independent computer needs its own tunnel identity. Reusing one tunnel token across computers creates replicas that can receive traffic for the same routes. Keep administrative provisioning credentials separate from runtime connector credentials.

The planned pairing QR must contain only a short-lived, single-use pairing link, never a permanent password. A separate hosted UI also requires exact-origin CORS, per-server authentication, and verification of Access redirects, SSE, and WebSocket connections.

<br />

## Releases

The release workflow verifies the tag against `package.json`, runs the checks, and publishes through npm trusted publishing. Configure npm's trusted publisher for `arthurfiorette/opencode-zero-trust`, workflow `publish.yml`, and GitHub environment `NPM Registry` before publishing. No npm token is committed to this repository.

No release has been published. Do not publish this scaffold as a working Cloudflare integration. See [the release guide](docs/releasing.md) for the setup and release procedure.

<br />

## License

[MIT](LICENSE) © [Arthur Fiorette](https://github.com/arthurfiorette)
