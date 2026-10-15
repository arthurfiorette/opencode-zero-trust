<p align="center">
   <b>Using this package?</b> Please consider <a href="https://github.com/sponsors/arthurfiorette" target="_blank">donating</a> to support my open source work ❤️
  <br />
  <sup>
   Help opencode-zero-trust grow! Star and share this repository with your friends and co-workers!
  </sup>
</p>

<br />

# OpenCode Zero Trust

An OpenCode V2 plugin for remote access through a preconfigured Cloudflare Named Tunnel and Access application. One package contains the server plugin, `/zero-trust` terminal command, and public RPC contract. Without options, it stays inert.

> [!WARNING]
> Remote access gives authenticated visitors the daemon's tool-execution capabilities as your local user. Keep both Cloudflare Access and native OpenCode authentication enabled. Connector readiness does not prove that public DNS, Access policies, pairing, SSE, or WebSockets work end to end. Live Cloudflare verification remains outstanding.

**Requirements:** OpenCode V2 (this package uses 2.0.29), separately installed Node.js 24.16+ and `cloudflared` (2025.6.1+ recommended), plus an existing locally-managed Named Tunnel, DNS route, and Cloudflare Access application. Local builds use pnpm 12.6.0. CI targets Windows, Linux, and macOS; local checks do not establish cross-platform lifecycle correctness.

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

Add the absolute checkout path to `plugins` in your global `~/.config/opencode/opencode.json(c)` (or under `$XDG_CONFIG_HOME/opencode`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-zero-trust"]
}
```

OpenCode resolves the server entrypoint and companion `./tui` export from the same package. Activate a Location and run `/zero-trust`: it should show `unconfigured`. This check needs no Cloudflare credentials and starts no connector.

### Prepare Cloudflare

The plugin does not provision resources. If you already have a locally-managed tunnel, use its credentials JSON and existing DNS route. Remotely-managed tunnel tokens are unsupported.

For a new setup, follow Cloudflare's [locally-managed tunnel guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/). These commands are manual account mutations, not commands run by the plugin:

```sh
cloudflared tunnel login
cloudflared tunnel create opencode-mac
```

Record the generated tunnel UUID and credentials JSON path. `login` creates an administrative `cert.pem`; the plugin needs only the tunnel's JSON file, not that certificate or an API token. On POSIX systems, restrict the JSON file to mode `600` or `400`:

```sh
chmod 600 /absolute/path/to/.cloudflared/TUNNEL-UUID.json
```

On Windows, protect the file and its directory with NTFS ACLs so other users cannot read the credentials. POSIX mode checks do not validate Windows ACLs.

Before routing traffic, create or verify a [self-hosted Access application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) for the exact hostname, covering all paths. Configure an Allow policy restricted to your intended identities and an identity provider. Do not use a Bypass policy. Copy the application's [Application Audience (AUD) Tag](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#get-your-aud-tag) from its additional settings. The team name is the slug in `https://TEAM-NAME.cloudflareaccess.com`, not the full URL.

If the DNS route does not exist, create it after Access is configured:

```sh
cloudflared tunnel route dns TUNNEL-UUID opencode-mac.example.com
```

This creates the CNAME to `TUNNEL-UUID.cfargotunnel.com`. Do not also run `cloudflared tunnel run` or install a second connector service for this tunnel; the plugin owns the connector. Use a separate tunnel identity and stable hostname for each independent daemon/computer.

### Enable remote access

Check `node --version` and `cloudflared --version` in the environment used to launch the daemon. Node.js is the helper runtime; the OpenCode executable is not assumed to run JavaScript. Both commands must be on the daemon's PATH unless you provide absolute executable paths below.

Replace the inert plugin entry with the complete options object in the [configuration reference](#configuration-reference). Restart the daemon, activate a configured Location, and run `/zero-trust` again. When the connector is `ready`, the dialog requests a native five-minute, single-use pairing link and displays a QR code if the terminal has enough space. Open it on the remote device and complete Cloudflare Access authentication. Treat the link as a temporary credential; do not save, log, or share screenshots of it.

Verify the public hostname separately: unauthenticated visitors must encounter Access, disallowed identities must be denied, and allowed visitors must still complete native OpenCode authentication. Test pairing, SSE updates, and terminal WebSockets before relying on remote access. No live resources have been provisioned or tested by this repository's automated checks.

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
        "hostname": "opencode-mac.example.com",
        "credentialsFile": "/absolute/path/to/.cloudflared/TUNNEL-UUID.json",
        "access": {
          "teamName": "your-team",
          "audience": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        }
      }
    }
  ]
}
```

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `hostname` | DNS hostname | Required when configured | Exact public hostname, normalized to lowercase. |
| `credentialsFile` | Absolute path | Required when configured | Locally-managed Named Tunnel credentials JSON. The parent validates it and derives `TunnelID`. |
| `access.teamName` | Cloudflare team slug | Required when configured | Lowercase letters, digits, and internal hyphens; no domain or URL. |
| `access.audience` | 64-character hexadecimal string | Required when configured | Access application's AUD tag, normalized to lowercase. Replace the example value. |
| `serviceFile` | Absolute path | Default managed-service registration | Existing OpenCode service registration for a custom channel or host. |
| `cloudflaredPath` | Command name or absolute executable path | `cloudflared` | User-installed connector executable, without arguments. |
| `nodePath` | Command name or absolute executable path | `node` | Separately installed Node.js 24.16+ helper runtime, without arguments. |

Omit options or use `{}` to remain unconfigured. Otherwise, `hostname`, `credentialsFile`, and both Access fields are required together. Partial configuration and unknown options are rejected. Hostnames cannot be URLs, IP addresses, wildcards, or single-label names. Paths must be absolute where specified; `~` is not expanded. Do not put tokens, passwords, or credential contents in plugin options.

Only the default background managed service is discovered automatically. Discovery uses public `Service.discover`, requires native authentication and a loopback endpoint, and checks that `server.info().pid === process.pid`. It never calls `ensure` or starts another daemon. Custom channels and standalone/embedded hosts need an explicit `serviceFile` for their own authenticated registration. Private servers without such a registration are unsupported; pointing at another daemon's registration fails the PID check.

### Public exports

| Export | Purpose |
| --- | --- |
| `opencode-zero-trust` | Default server plugin definition |
| `opencode-zero-trust/tui` | Default terminal plugin definition |
| `opencode-zero-trust/rpc` | `ZeroTrust` RPC definition, status/pairing schemas and types |

RPC calls target the Location where the plugin is loaded:

- `ZeroTrust.status({})` returns `{ state, hostname?, url?, helperPid?, connectorPid?, error? }`. States are `unconfigured`, `starting`, `connecting`, `ready`, `restarting`, and `error`. `error` is a sanitized code, never raw subprocess output or credentials. `ready` means connector-ready, not public end-to-end verification.
- `ZeroTrust.pair({})` returns `{ url, expiresIn }`, with expiry in seconds from native OpenCode pairing (five minutes). It reports declared `not_ready` errors with `{ state }`, or `unavailable` with `{}` if pairing cannot be issued. The link contains a single-use code, never the permanent daemon password.

See [the RPC schemas](src/rpc.ts) for the complete error-code enum. `/zero-trust` displays status, public URL, available process IDs, and a readable diagnosis; it requests pairing only when ready. Pairing URLs are not persisted or logged by the plugin.

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
| `pnpm test` | Run configuration, lifecycle, and terminal-command unit tests |
| `pnpm test:integration` | Load the plugin in an isolated real OpenCode SDK host and exercise RPC/authentication |
| `pnpm test:package` | Pack, install, and smoke-test the compiled public exports in a temporary consumer |
| `pnpm check` | Run lint, typecheck, tests, build, and package verification |

Tests use a fake connector and an isolated real SDK host, not a live Cloudflare tunnel. They do not use your running daemon, personal OpenCode database, model credentials, or Cloudflare account, and issue no model requests. Live DNS/Access behavior and SSE/WebSocket traffic through Cloudflare remain unverified. Cross-platform lifecycle results must come from CI, not an assumption based on local macOS checks.

The lifecycle, SDK integration, and packed-consumer checks [passed on Windows, Linux, and macOS](https://github.com/arthurfiorette/opencode-zero-trust/actions/runs/38682707950) at commit `6590947`.

The SDK development dependency includes native parser addons. Installing it may require Python and a C/C++ build toolchain. Their build scripts are explicitly approved in `pnpm-workspace.yaml`; CI uses hosted runners with those tools available.

See [AGENTS.md](AGENTS.md) for development constraints and [PLAN.md](PLAN.md) for the remaining work.

<br />

## Architecture

The server plugin owns one process-global tunnel manager shared across configured Location instances and plugin reloads. It starts a Node helper on the first configured Location activation. An unconfigured Location starts no connector. Configuration changes require a daemon restart; conflicting configured Locations report `configuration-conflict`.

Plugin setup/cleanup is Location-scoped, not a global daemon startup/shutdown hook. A daemon with no activated configured Location may never start the tunnel. Closing a TUI or unloading a Location does not stop the process-owned connector.

The helper supervises `cloudflared` and is tied to the daemon through IPC. Normal shutdown or abrupt daemon death disconnects IPC, causing the helper to terminate its connector. If the helper itself is forcibly killed, the OS cannot guarantee child cleanup. The manager therefore reports failure without automatically launching a replacement helper, avoiding duplicate connectors; check for a surviving connector before restarting the daemon. No OS watcher service is installed.

A hosted OpenCode frontend with a multi-server registry remains a later, separate deployment. Numbered-hostname scanning is out of scope.

### Security boundaries

The generated connector configuration routes only the exact hostname to the verified loopback daemon, followed by an `http_status:404` fallback. It sets `originRequest.access` with `required: true`, `teamName`, and `audTag: [audience]`, requiring [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/#access) before forwarding requests. Missing or invalid Access JWTs fail closed.

The helper receives no daemon password. Child environments exclude unrelated model and Cloudflare administrative secrets. Native OpenCode authentication remains in place; there is no proxy that injects an administrative password. Keep runtime tunnel credentials separate from administrative provisioning credentials, and never share a tunnel identity between independent daemons.

A separate hosted UI requires exact-origin CORS, per-server authentication, and verification of Access redirects, SSE, and WebSockets. Authentication on the UI domain does not automatically authenticate requests to daemon domains.

<br />

## Releases

The release workflow verifies the tag against `package.json`, runs the checks, and publishes through npm trusted publishing. Configure npm's trusted publisher for `arthurfiorette/opencode-zero-trust`, workflow `publish.yml`, and GitHub environment `NPM Registry` before publishing. No npm token is committed to this repository.

No npm release has been published. Release acceptance still requires lifecycle and authentication verification on the supported platforms. See [the release guide](docs/releasing.md) for the setup and release procedure.

<br />

## License

[MIT](LICENSE) © [Arthur Fiorette](https://github.com/arthurfiorette)
