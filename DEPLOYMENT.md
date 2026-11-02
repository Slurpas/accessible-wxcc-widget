# Deployment

Overview: CI builds **one static file**, `accessible-wxcc-widget.js`. You host it at a
stable HTTPS URL and point the Desktop Layout at that URL. Nothing runs on a server.

```
developer → git push → GitHub Actions (npm ci → test → build → verify) → static host → Desktop loads script
```

## 1. Choose hosting

Desktop loads the widget with a normal `<script>` request from each agent's browser.
The host therefore has to be reachable from agent PCs **without a separate login**.

| Option | Fits? | Notes |
|---|---|---|
| **A. Company static web hosting / CDN** (Azure Static Web Apps or Storage static website, AWS S3 + CloudFront, internal IIS/nginx static site) | **Recommended for production** | Company-controlled, can restrict by network/IP if agents are on known networks, company TLS and change control. Upload the files from the CI artifact. |
| **B. GitHub Pages (public site)** | Acceptable for a pilot | Free, simple, built into the workflow. **The published site is public even if the repository is private** (and Pages from a private repo needs a paid plan). Acceptable only because the bundle holds no secrets or data; anyone with the URL can read the widget code. |
| C. GitHub Pages with private visibility (Enterprise Cloud) | **Not suitable** | Private Pages requires each viewer to sign in to GitHub. Agents' Desktop sessions would get a GitHub login page instead of the script, so the widget would not load. |
| D. Approved public CDN (e.g. publishing the package to npm and using jsDelivr) | Not recommended | Puts the code outside company control and adds a third party to the agent's page. |

A backend is **not** needed for any option.

## 2a. Option A — company static hosting

1. In GitHub → Actions → latest successful "Build and test" run on `main` → download the
   artifact `accessible-wxcc-widget-<sha>`.
2. Upload `accessible-wxcc-widget.js` (and optionally `build-info.json`) to a stable path, e.g.
   `https://static.example.com/wxcc/accessible-wxcc-widget/accessible-wxcc-widget.js`.
3. Response headers:
   - `Content-Type: application/javascript; charset=utf-8`
   - `Cache-Control: public, max-age=300` (5 minutes, so updates reach agents quickly while keeping load low)
   - HTTPS only. No CORS header is needed for a classic script tag.
4. Optional: automate with a deploy step using your cloud's OIDC federation
   (no long-lived keys in GitHub).

## 2b. Option B — GitHub Pages

1. Repository → Settings → Pages → Source: **GitHub Actions**.
2. Settings → Environments → `github-pages` → add **Required reviewers** (manual approval per release).
3. Settings → Secrets and variables → Actions → **Variables** → add `DEPLOY_TARGET` = `github-pages`.
4. Push to `main`. After approval the file is served at
   `https://<org>.github.io/<repo>/accessible-wxcc-widget/accessible-wxcc-widget.js`.
   (GitHub Pages sets `Cache-Control: max-age=600`.)

Until `DEPLOY_TARGET` is set, the workflow only builds and tests.

## 3. Add the widget to Desktop

Follow [desktop-layout/README.md](desktop-layout/README.md): download the current layout,
merge the one navigation entry, set the script URL, upload it as a new layout and
assign it to the pilot team only.

## 4. Updating the widget

1. Change code → `npm run check` locally → open a pull request → CI must pass → merge to `main`.
2. Deploy (Option A: upload the new artifact; Option B: approve the Pages deployment).
3. **Keep the same URL.** Cisco advises not to change a widget's script URL. Agents pick up the
   new version after the cache time (5–10 min) when they **reload Desktop or sign in again**.
4. Confirm the served file: compare the SHA-384 of the live file with `build-info.json`
   (command in SECURITY.md).
5. Bump `version` in `package.json` for every release so `build-info.json` identifies it.

If an urgent fix must reach agents immediately: ask them to reload Desktop (Ctrl+F5).

## 5. Rollback

- Fast: re-deploy the previous artifact (GitHub keeps artifacts 30 days; for Pages, re-run the
  workflow for the previous commit, or `git revert` and push).
- Full: assign the pilot team back to the original Desktop layout in Control Hub.

## 6. Pilot checklist

- [ ] Hosting option chosen and approved by IT security.
- [ ] Bundle URL reachable from an agent PC (open it in the browser; you should see minified JavaScript).
- [ ] New layout uploaded and assigned only to the pilot team.
- [ ] Manual tests T1–T15 in [docs/TESTING.md](docs/TESTING.md) passed in the tenant.
- [ ] Agent trained: where the page is, text-size and theme buttons, what "STATUS NOT VERIFIED" means.
- [ ] Rollback layout available.
