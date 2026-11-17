# GD LIVE STUDIO — Create. Connect. Go Live.

A mobile-first, installable PWA for camera/mic studio work, local recording, overlays, scheduling and (with the right setup) live broadcasting to YouTube, Facebook Pages and custom RTMP/WHIP destinations.
Powered by **GD TECH ACADEMY** · https://gyaankadabba.blogspot.com · @GYAANKADABBA

## What it is (and is not)
- **Front end:** static files (vanilla JS ES modules) → host on GitHub Pages.
- **Back end:** Google Apps Script web app + Google Sheets (14 auto-created tabs) + Google Drive.
- **Optional gateway:** `gateway/` (MediaMTX + small Node relay + ffmpeg + Caddy, all open source) — required for multi-platform and RTMP destinations, because browsers cannot speak RTMP.
- Everything works on free services. Nothing shows "Live" unless a platform/API actually confirmed it.

## Folder map
| Path | Contents |
|---|---|
| `index.html`, `manifest.json`, `service-worker.js` | App shell, PWA |
| `js/`, `css/`, `pages/`, `assets/` | Client code, styles, page fragments, logo/icons |
| `apps-script/` | Backend (`.gs` files + `appsscript.json`) |
| `gateway/` | Optional streaming gateway (Docker) |
| `tests/` | Backend test-suite running the real `.gs` code under Node with a Google-services mock |
| `docs/` | All guides |

## Quick start (about 30 minutes)
1. `docs/APPS_SCRIPT_DEPLOYMENT.md` — deploy the backend, run `setup()`.
2. `docs/OAUTH_SETUP.md` — Google Cloud OAuth client (needed for Google sign-in, YouTube, Drive).
3. Put the Web-app URL and Client ID in `js/config.js`.
4. `docs/GITHUB_DEPLOYMENT.md` — publish to GitHub Pages.
5. Optional: `docs/GATEWAY_GUIDE.md`.

Start with `docs/TESTING_REPORT.md` for an honest account of what has and has not been verified, and `docs/REQUIREMENTS_CHECKLIST.md` for the section-by-section mapping to the master prompt.

## Documents
GITHUB_DEPLOYMENT · APPS_SCRIPT_DEPLOYMENT · SHEETS_DRIVE_SETUP · OAUTH_SETUP · GATEWAY_GUIDE · SECURITY · MOBILE_INSTALL · TROUBLESHOOTING · API_REFERENCE · TESTING_REPORT · REQUIREMENTS_CHECKLIST (all in `docs/`).

## Roles
Guest (camera, recording, overlays, local use) · Registered user (platforms, Go Live, scheduler, history, Drive upload) · Super Admin (admin panel, audit logs, feature controls, backups). The first Super Admin is whoever signs in with Google using the email in the `OWNER_EMAIL` script property.

## About
Created for GD TECH ACADEMY by Md. Sabbir — Digital Creator | Tech Tutor | Video Editor.
