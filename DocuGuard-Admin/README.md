# DocuGuard Admin (PWA-ready)

Expo Router admin portal configured for web/PWA output and future Capacitor wrapping. **Only this folder was modified for this setup.**

## What changed for PWA

- `app.json` web output set to `single` (SPA/static export-friendly) with PWA metadata.
- `src/app/+html.tsx` adds web head tags, manifest link, Apple/mobile web app meta, and icons.
- `public/manifest.webmanifest`, `public/sw.js`, and `public/icons/*` added for installability/app shell caching.
- `src/app/_layout.tsx` registers the service worker on web.
- Web-safe fallbacks added:
  - `src/services/adminSession.ts`: uses `localStorage` on web, `expo-secure-store` on native.
  - `src/services/adminBiometrics.ts`: hardware-backed key signing/enrollment is native-only; web shows a clear unsupported message (Capacitor/native required for device-bound auth).
  - `src/services/notificationService.tsx`, `src/utils/updates.ts`: web-safe no-op guards.

## Run as web / PWA (dev)

```bash
npm install
npm run web
```

Open in a browser and install when prompted/supported.

## Build & preview PWA

```bash
npm run build:web
npm run preview:web
```

`build:web` exports to `dist/` (static web output). `preview:web` serves the exported build locally for install/service-worker testing.

## Native (unchanged workflows)

```bash
npm run start
npm run android
npm run ios
```

## Future: Capacitor (planned)

This app is prepared as a web-first shell for Capacitor later:
1. Build web assets: `npm run build:web` (outputs `dist/`).
2. Add Capacitor in this folder (`@capacitor/core`, `@capacitor/cli`, platforms) and point `webDir` to `dist`.
3. Rewire device-bound admin security to Capacitor/native plugins (secure storage, biometrics/keystore/signing) while keeping the same API flow.
4. Keep service worker/PWA behavior for browser installs and use native bridges when running inside Capacitor.

## Connect to deployed backend (recommended)

The admin app fetches data from the DocuGuard API (`/admin/*`, `/admin-auth/*`). For production/deployed use:

1. Copy `.env.example` to `.env` and set:
   - `EXPO_PUBLIC_API_BASE_URL=https://<your-deployed-api>` (default: `https://docuguard-api-onoj.onrender.com`)
2. Restart `npm run web` / rebuild (`npm run build:web`) after changing env vars (`EXPO_PUBLIC_*` is embedded at build/start time).
3. Ensure the **deployed DocuGuard-Server** allows this admin web origin in CORS:
   - Server env: `CORS_ALLOWED_ORIGINS=https://<admin-web-domain>` (comma-separated for multiple exact origins).
   - In production, missing/wrong CORS origin causes browser `TypeError: Failed to fetch`.
4. Sign in with a valid admin account that exists/has admin role in the **deployed** database.

## Notes

- No `DocuGuard-Server`, mobile app, or other workspace folders were changed as part of this PWA setup.
- Device-bound cryptographic admin login/enrollment remains a native/Capacitor capability; web build is installable but does not perform hardware key signing.
