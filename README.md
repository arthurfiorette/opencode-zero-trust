<p align="center">
   <b>Using this package?</b> Please consider <a href="https://github.com/sponsors/arthurfiorette" target="_blank">donating</a> to support my open source work ❤️
  <br />
  <sup>
   Help opencode-zero-trust grow! Star and share this amazing repository with your friends and co-workers!
  </sup>
</p>

<br />

<p align="center" title="OpenCode Zero Trust screenshot">
  <a href="https://github.com/arthurfiorette/opencode-zero-trust">
    <img src="https://raw.githubusercontent.com/arthurfiorette/opencode-zero-trust/main/docs/banner-side.png" width="800" alt="OpenCode TUI showing a pairing QR code next to a phone running the same session" />
  </a>
</p>

# OpenCode Zero Trust

Reach your local OpenCode daemon from other devices through a Cloudflare Named Tunnel, and pair them by scanning a QR code.

The daemon keeps running on your computer with your files, tools, and credentials. The plugin starts a `cloudflared` connector next to it, so a hostname like `opencode-mac.example.com` reaches the daemon without open ports or a VPN, and the QR code signs your other device in to OpenCode's own web app. Pick up a session from your phone, follow an agent's progress, or reply while away from your desk.

**Requirements:** a domain on Cloudflare, OpenCode V2 running as a managed service, Node.js 24.16+ installed separately, and `cloudflared` (2025.6.1+ recommended).

> [!WARNING]
> The daemon runs tools as your local user. Protect the whole hostname with a [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) application limited to trusted identities, and never use a Bypass policy. Access adds a gate in front of OpenCode's own authentication and does not replace it.

## Get started

1. Create a locally-managed tunnel, following [Cloudflare's guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/):

   ```sh
   cloudflared tunnel login
   cloudflared tunnel create opencode-mac
   chmod 600 ~/.cloudflared/TUNNEL-UUID.json
   ```

   On Windows, protect the credentials file and its directory with NTFS ACLs instead of `chmod`. Create one tunnel and one hostname per computer. Remotely-managed tunnel tokens are not supported.

2. Create a self-hosted [Cloudflare Access application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) for the hostname you will use, with an Allow policy limited to your own identity. Every request to the hostname passes through it before reaching OpenCode.

3. Add the plugin to `~/.config/opencode/opencode.json` (or `$XDG_CONFIG_HOME/opencode/opencode.json`; `.jsonc` also works):

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

4. Restart the daemon with `opencode service restart` and open a project.

5. Click **Scan QR code** in the Zero Trust sidebar, or run `/zero-trust`, and scan it from your other device. It signs in to Access, pairs, and opens OpenCode's web app connected to this daemon. See [PWA](#pwa) to keep it on your home screen.

The plugin owns the connector. Do not run `cloudflared tunnel run` or install another connector service for the same tunnel.

## Pairing

Each QR code holds a single-use pairing link that expires after five minutes. It never contains your permanent OpenCode password, but anyone holding it can pair until it expires or is used, so treat it as a credential. **Copy link** (or `c`) copies the same link. If Access is enabled, the device signs in to Access before pairing.

Short hostnames produce smaller QR codes. If the code does not fit the terminal, the panel asks you to enlarge it.

## Tunnel lifecycle

The tunnel starts the first time a project with the plugin configured opens, and keeps running after you close the TUI. Set `"autoStart": false` to start offline and connect manually. With no options, the plugin starts nothing.

| Command                  | Effect                                                             |
| ------------------------ | ------------------------------------------------------------------ |
| `/zero-trust`            | Shows the pairing QR code when connected, otherwise the status     |
| `/zero-trust status`     | Shows connection details without creating a pairing link           |
| `/zero-trust connect`    | Starts the connector                                               |
| `/zero-trust disconnect` | Stops this daemon's connector after confirmation (alias `disable`) |

The sidebar offers the same actions and disables them while a connection change is in progress. Its status dot is green when connected, yellow while connecting or disconnecting, muted when offline, and red on error. **Details** shows the full hostname when the sidebar truncates it.

Configuration changes take effect only after `opencode service restart`; reloading a project keeps the daemon's existing tunnel. All projects must use the same plugin options, otherwise **Details** reports a conflict.

A `ready` status means the connector is up. It does not prove that DNS, Access, or the public hostname work, so test pairing, live session updates, and the terminal from a remote device before relying on it.

## DNS

With the default `autoDns: true`, the plugin runs `cloudflared tunnel route dns` to create the hostname's DNS record when it is missing, using the `cert.pem` from `cloudflared tunnel login`. It never overwrites an existing record. Failures appear in `/zero-trust`.

To manage DNS yourself, set `autoDns: false` and [create the route](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/):

```sh
cloudflared tunnel route dns TUNNEL-UUID opencode-mac.example.com
```

## Access validation

To also make the connector reject requests without a valid Access JWT, add `access` to the plugin options:

```json
{
  "hostname": "opencode-mac.example.com",
  "access": {
    "teamName": "your-team",
    "audience": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }
}
```

`teamName` is the `your-team` part of `https://your-team.cloudflareaccess.com`, and `audience` is the application's [64-hex AUD tag](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#get-your-aud-tag). Both are required. Leaving `access` out disables only this check; the Access application still applies.

## PWA

Open the hostname on your phone and install it: **Share > Add to Home Screen** in Safari, or **Install app** in Android browsers. The daemon serves OpenCode's PWA from its bundled frontend, so the app always matches your installed OpenCode version.

Chrome may warn about missing manifest screenshots. That affects only its install dialog and does not block installation.

### SRI integrity checks failed

Cloudflare JavaScript Detections and automatic Web Analytics inject scripts into `index.html`, which changes its hash and breaks the service worker. Disable those injections for this hostname and keep Access enabled. Check their scope before changing zone-wide settings, and never disable CSP or integrity validation instead.

To suppress JavaScript Detections without turning off bot protection for the zone, enable `preventTransform` and restart the daemon:

```jsonc
{
  "hostname": "opencode-mac.example.com",
  // Workaround for https://github.com/anomalyco/opencode/issues/55905
  "preventTransform": true
}
```

The helper then routes traffic through a loopback-only proxy that appends `no-transform` to the `Cache-Control` header of HTML responses. Response bodies, existing cache directives, cookies, CSP, and authentication are unchanged, and API streams and WebSockets pass through. Other HTML injections still need to be disabled in Cloudflare.

## Disable or uninstall

Run `/zero-trust disconnect` and confirm. Credentials, Cloudflare tunnels, and DNS records are kept, and `/zero-trust connect` starts the connector again.

To uninstall, disconnect first, then remove the plugin entry from your configuration. Removing the entry alone leaves the running tunnel up until you run `opencode service restart`. The plugin leaves no local files to delete.

## Configuration reference

| Option             | Default                           | Description                                                                              |
| ------------------ | --------------------------------- | ---------------------------------------------------------------------------------------- |
| `hostname`         | Required                          | Public hostname, optionally with [variables](#hostname-variables).                       |
| `credentialsFile`  | Sole `~/.cloudflared/<UUID>.json` | Tunnel credentials JSON. Absolute or starting with `~/` (`~\` on Windows).               |
| `access`           | Omitted                           | Connector-side [Access validation](#access-validation).                                  |
| `autoDns`          | `true`                            | Create a missing DNS record for the hostname.                                            |
| `autoStart`        | `true`                            | Start the tunnel when a project opens. `false` waits for Connect.                        |
| `preventTransform` | `false`                           | Append `no-transform` to HTML responses. See [SRI errors](#sri-integrity-checks-failed). |
| `nodePath`         | `node`                            | Node.js command name or absolute path, without arguments.                                |
| `cloudflaredPath`  | `cloudflared`                     | `cloudflared` command name or absolute path, without arguments.                          |
| `serviceFile`      | Default managed service           | Absolute path to the service registration of a custom channel or host.                   |

When `credentialsFile` is omitted and `~/.cloudflared` contains more than one `<UUID>.json` file, set it explicitly. Unknown options and invalid hostnames are rejected.

### Hostname variables

| Variable     | Value                          |
| ------------ | ------------------------------ |
| `{username}` | `os.userInfo().username`       |
| `{hostname}` | `os.hostname()`                |
| `{os}`       | `macos`, `windows`, or `linux` |

For example, `opencode-{os}.example.com`. The hostname is published in public DNS, so avoid variables that reveal personal names, such as `{username}` or a `{hostname}` like `arthurs-macbook-pro`. Each computer needs its own hostname; if two share an operating system, give one a fixed name.

Values are converted to lowercase DNS labels: accents are removed, punctuation becomes hyphens, and leading or trailing hyphens are dropped. Add a length after a comma to truncate: `{hostname,5}` keeps the first five characters and `{hostname,-5}` the last five, with lengths from 1 to 63. Truncated names can collide across machines.

[Development and architecture](docs/README.md)

## License

[MIT](LICENSE) © [Arthur Fiorette](https://github.com/arthurfiorette)
