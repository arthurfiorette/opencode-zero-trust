# Publish a release

This guide covers stable releases through GitHub Actions and npm trusted publishing. Run the complete platform matrix before publishing; record live Cloudflare validation separately from fake-connector tests.

## Configure trusted publishing

1. Enable GitHub Actions for this repository and create the `NPM Registry` environment. Add required reviewers if releases need manual approval.
2. On npm, configure a GitHub Actions trusted publisher for the package: owner `arthurfiorette`, repository `opencode-zero-trust`, workflow `publish.yml`, environment `NPM Registry`. Enable direct `npm publish` for this publisher; stage-only permission does not authorize the current workflow.
3. A new package may need a manual first publish before its trusted publisher can be configured. Complete that bootstrap using your npm account and required authentication, then use the workflow for subsequent releases. Do not store a long-lived npm token in the repository.

Complete a successful publish within two days of creating the trusted publisher, or npm expires the unvalidated configuration. Create it when the release is ready. See [npm's trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).

## Prepare and publish

1. Finish the tunnel lifecycle and authentication checks, including Windows, Linux, and macOS validation.
2. Update the package version and lockfile. Document the release's behavior and any migration requirements.
3. Run `pnpm install --frozen-lockfile` and `pnpm check` with the declared Node and pnpm versions.
4. Commit and push. Wait for all CI jobs to pass.
5. Create a GitHub release with tag `v<package.json version>`. The publishing workflow ignores prereleases and rejects a tag that does not match the package version.
6. Approve the environment deployment if required. Inspect the publish run and verify the published version on npm.

To rerun a failed publish, dispatch `publish.yml` with the existing stable release tag. npm versions are immutable; use a new version for changed package contents.
