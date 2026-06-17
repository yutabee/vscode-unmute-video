# Publishing & Releasing

Releases are automated by [`.github/workflows/release.yml`](../.github/workflows/release.yml).
Pushing an annotated `vX.Y.Z` tag builds, tests, packages the extension, publishes
it to the **VS Code Marketplace** and **Open VSX**, and attaches the `.vsix` to a
**GitHub Release**.

## One-time setup (maintainers)

The workflow reads two repository secrets. Each publish step is skipped when its
secret is absent, so you can enable the registries one at a time.

| Secret | Registry | How to obtain |
| --- | --- | --- |
| `VSCE_PAT` | VS Code Marketplace | Create the `yutabee` publisher at the [Marketplace management portal](https://marketplace.visualstudio.com/manage), then create an Azure DevOps Personal Access Token with **Marketplace › Manage** scope for **all accessible organizations**. |
| `OVSX_PAT` | Open VSX | Sign the Eclipse Open VSX Publisher Agreement, then generate an access token at [open-vsx.org](https://open-vsx.org/user-settings/tokens). The `yutabee` namespace is created automatically by the workflow. |

Add them under **Settings → Secrets and variables → Actions** (or
`gh secret set VSCE_PAT` / `gh secret set OVSX_PAT`). Tokens are never echoed by
the workflow.

## Cutting a release

1. Bump `version` in `package.json` following [Semantic Versioning](https://semver.org/).
2. In `CHANGELOG.md`, move the `## [Unreleased]` notes into a new
   `## [X.Y.Z] - YYYY-MM-DD` section and add the matching link reference at the
   bottom.
3. Open a PR, get CI green, and merge to `main`.
4. Tag and push:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
5. Watch the **Release** workflow. The publish steps run independently
   (`continue-on-error`), so open the run logs and confirm each registry reports
   a successful publish.

## Re-running a release

If a publish step fails (for example a transient registry error), re-run the
workflow from the Actions tab via **Run workflow** (`workflow_dispatch`), or:

```bash
gh workflow run release.yml --ref main
```

The re-run re-attempts each publish and creates the Open VSX namespace if it is
missing. A duplicate Marketplace version is rejected harmlessly and does not
block the other registry. Manual runs do not create a GitHub Release (that step
runs only for tag builds).

## What ships in the package

`vsce` packages the compiled `out/` and `media/` (including the generated
`media/player.js`), the icon, README, CHANGELOG, and LICENSE. Source, tests,
CI config, and local files are excluded via [`.vscodeignore`](../.vscodeignore).
CI asserts that `media/player.js` is present in the built `.vsix` so a missing
webview build fails the pipeline instead of shipping silently.
