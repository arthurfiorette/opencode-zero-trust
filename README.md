<p align="center">
  Using this package? Consider <a href="https://github.com/sponsors/arthurfiorette">sponsoring</a> my open source work.
</p>

# OpenCode Zero Trust

Remote access to OpenCode through a Cloudflare Named Tunnel, with `/zero-trust` for QR pairing.

> [!WARNING]
> Protect the entire hostname, covering all paths, with [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/). The daemon executes tools as your local user. Restrict access to trusted identities; do not use a Bypass policy. Access is optional but recommended, and never replaces native OpenCode authentication.

## Setup

Requires OpenCode V2 running as a managed service, separately installed Node.js 24.16+, and user-installed `cloudflared` (2025.6.1+ recommended). Prepare a locally-managed Named Tunnel before enabling the plugin.

Add this to your global `~/.config/opencode/opencode.json(c)` (or `$XDG_CONFIG_HOME/opencode/opencode.json(c)`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-zero-trust@latest",
      "options": {
        "hostname": "opencode-{os}.example.com"
      }
    }
  ]
}
```

The plugin selects the sole regular `<UUID>.json` file in `os.homedir()/.cloudflared`. If several exist, set `credentialsFile`, for example `~/.cloudflared/TUNNEL-UUID.json`. The JSON authenticates the connector; `cert.pem` authorizes automatic DNS setup.

Restart the daemon, activate a configured Location, and click **Scan QR code** in the Zero Trust sidebar, or run `/zero-trust`. Use **Copy link** below the QR (or press `c`) to copy the same pairing URL. Pairing is generated on demand, expires after five minutes, and works once; it never contains the permanent OpenCode password. Complete Access authentication if enabled. Treat the QR and copied link as temporary credentials.

The dot beside the hostname is green when connected, yellow during a transition, muted when offline, and red on error. Actions are disabled while connecting or disconnecting. Long hostnames stay on one line with `...`; Details shows the full address.

The tunnel starts on the first configured Location activation and survives closing the TUI. Set `"autoStart": false` to start offline, then use **Connect** in the sidebar or `/zero-trust connect`. Configuration changes require a daemon restart. Empty or omitted options start nothing.

If Details reports conflicting configurations, ensure projects use the same plugin options and run `opencode service restart` after saving them. Reloading a project does not replace the daemon's existing tunnel configuration.

### Disable or uninstall

Run **`/zero-trust disconnect`** (or `/zero-trust disable`) and confirm to stop this daemon's connector. Use `/zero-trust connect` to start it again. `/zero-trust status` shows connection details without generating a pairing code. Credentials, Cloudflare tunnels, and DNS records are kept.

To uninstall, disable first, then remove the plugin entry from your OpenCode configuration. If you already removed it, run `opencode service restart` to close the old daemon and helper. Removing the configuration alone does not stop a process-owned tunnel. No local files need to be deleted.

### Prepare Cloudflare

Follow Cloudflare's [locally-managed tunnel guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/):

```sh
cloudflared tunnel login
cloudflared tunnel create opencode-mac
chmod 600 ~/.cloudflared/TUNNEL-UUID.json
```

On Windows, protect the credentials file and directory with NTFS ACLs instead of `chmod`. Use a separate tunnel identity and stable hostname per computer. Remotely-managed tunnel tokens are unsupported.

Configure Access for the hostname before exposing it. By default, `autoDns: true` creates a missing DNS route using `cloudflared tunnel route dns`, authenticated by your existing `cert.pem`. Existing records are never overwritten. DNS lookup or routing failures appear in `/zero-trust`.

To manage DNS yourself, set `autoDns: false` and [create the route](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/):

```sh
cloudflared tunnel route dns TUNNEL-UUID opencode-mac.example.com
```

Do not also run `cloudflared tunnel run` or install another connector service for this tunnel. The plugin owns the connector.

## Configuration

| Option             | Default                           | Description                                                                           |
| ------------------ | --------------------------------- | ------------------------------------------------------------------------------------- |
| `hostname`         | Required                          | Public DNS hostname, optionally using the variables below.                            |
| `credentialsFile`  | Sole `~/.cloudflared/<UUID>.json` | Tunnel credentials path; absolute or starting with `~/`.                              |
| `access`           | Omitted                           | Connector-side Access JWT validation; both fields below are required.                 |
| `autoDns`          | `true`                            | Create a missing hostname route using the existing Cloudflare login.                  |
| `autoStart`        | `true`                            | Start on plugin activation. Set `false` to require an explicit Connect action.        |
| `preventTransform` | `false`                           | Route through a local header proxy that appends `no-transform` to HTML Cache-Control. |
| `nodePath`         | `node`                            | Command name or absolute executable path, without arguments.                          |
| `cloudflaredPath`  | `cloudflared`                     | Command name or absolute executable path, without arguments.                          |
| `serviceFile`      | Default managed service           | Absolute service-registration path for a custom channel or host.                      |

`credentialsFile` expands `~` and `~/` using `os.homedir()` (`~\` also works on Windows). Other path options still require absolute paths or the documented command names. Unknown options and invalid hostnames are rejected. Native OpenCode authentication must remain enabled.

### Hostname variables

Use `oc-{hostname}.example.com` or `oc-{username}-{os}.example.com`:

| Variable     | Value                             |
| ------------ | --------------------------------- |
| `{username}` | `os.userInfo().username`          |
| `{hostname}` | `os.hostname()`, the machine name |
| `{os}`       | `macos`, `windows`, or `linux`    |

Add a signed character limit after a comma: `{hostname,5}` takes the first five normalized characters, and `{hostname,-5}` takes the last five. For example, `oc-{hostname,5}.example.com`. Limits run from 1 to 63; truncation can create collisions, so choose distinct machine names or limits.

Replacements become lowercase DNS labels: accents are normalized, punctuation becomes hyphens, and leading/trailing hyphens are removed. Unknown variables or invalid replacements are rejected. Usernames often repeat across computers; prefer `{hostname}` for uniqueness. Automatic DNS uses the expanded hostname.

Short hostnames produce smaller QR codes. The QR panel uses the terminal's available space and asks you to enlarge it if the code cannot fit without clipping.

### Access validation

Add this object inside `options` to require connector-side JWT validation:

```json
{
  "access": {
    "teamName": "your-team",
    "audience": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }
}
```

Use the team slug from `https://your-team.cloudflareaccess.com` and the application's [64-hex AUD tag](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#get-your-aud-tag). Both fields are required when `access` is present. Omitting it disables only connector-side JWT validation; it does not bypass an existing Cloudflare Access application.

Connector `ready` status does not verify public DNS, Access, or end-to-end connectivity. Check remote pairing, streaming updates, and terminal WebSockets before relying on access.

## Mobile app

Open the paired hostname on your phone. In Safari, use **Share > Add to Home Screen**; on Android, use the browser's **Install app** option. The daemon serves OpenCode's PWA using its bundled frontend. Use that address so the frontend follows your installed OpenCode version.

### PWA installation fails

If the service worker reports **SRI integrity checks failed** for `index.html`, Cloudflare may be modifying the HTML. JavaScript Detections and automatic Web Analytics injection change the file's hash and prevent precaching. Disable those injections for this hostname, while keeping Access enabled. Check the scope before changing zone-wide settings. Do not disable CSP or integrity validation to work around it.

To suppress JavaScript Detections without disabling bot protection zone-wide, enable the local header proxy:

```jsonc
{
  "hostname": "opencode-mac.example.com",
  // Workaround for https://github.com/anomalyco/opencode/issues/55905
  "preventTransform": true
}
```

Add these fields inside the plugin's `options`, then restart the daemon. The helper appends `no-transform` to HTML response headers while preserving existing cache directives, response bytes, authentication, CSP, and cookies. API streams and WebSockets pass through. The proxy listens only on loopback and stops with the helper. This directive suppresses Cloudflare JavaScript Detections; other HTML injections must also be disabled if they still alter the page.

Missing manifest screenshots affect only Chrome's richer installation dialog; those warnings do not block installation.

[Development and architecture](docs/README.md)

## License

[MIT](LICENSE) © [Arthur Fiorette](https://github.com/arthurfiorette)
