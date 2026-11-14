# DocuGuard

> Intelligent e-document lifecycle management for secure storage, organization, tracking, protection, and expiration monitoring.

DocuGuard is a BSIT capstone project consisting of a React Native (Expo) mobile app, a Node.js/Express API, and a separate admin mobile app. It helps users store and manage important documents, track validity/expiry, receive reminders, and maintain auditable document activity.

## Repository Components

| Component      | Path                | Purpose                                                                                                                                |
| -------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile app     | `/`                 | Main Expo Router app for end users (documents, reminders, profile, scan/OCR, auth, backup, subscription flow).                         |
| Backend API    | `DocuGuard-Server/` | Express/Node API, PostgreSQL/Supabase data access, auth, document processing, notifications, audit logs, subscription/demo activation. |
| Admin app      | `DocuGuard-Admin/`  | Expo app for admin/device enrollment and trusted admin flows (biometric/device trust).                                                 |
| Shared modules | `shared/`           | Shared schemas/utilities used by app and/or server (e.g. backup schema).                                                               |

## Core Features (Main App)

- **Authentication & security:** registration/login, email verification flow, password reset, 2FA (TOTP + recovery codes), biometric login/preferences, app-lock preferences, secure token storage.
- **Document management:** add/edit/view/delete documents, categories/tags/metadata, document details, file handling and download/share flows, cloud sync/local vault behavior.
- **OCR & scanning:** camera/document scan and OCR-assisted capture (Azure Document Intelligence integration on server side where configured).
- **Expiration & reminders:** validity/expiry tracking, reminder scheduling/sync, reminders dashboard/counts, push/local notification support.
- **Activity & audit:** document activity history with search/action filters, audit log capture for upload/access/modify/delete events (server-backed).
- **Backup & restore:** export/import local backup (document/reminder metadata; attachments not included in backup payload as indicated in UI).
- **Profile & settings:** personal/profile settings, notification/preferences, appearance/theme support (System/Light/Dark), subscription/plan view.
- **Subscription (demo):** in-app demo Pro activation flow (`POST /subscription`, demo payment payload) that persists subscription data when backend/DB are configured.
- **Privacy/startup:** privacy consent/onboarding/startup flow before app access.

## Architecture

```text
Mobile App (React Native + Expo Router)
            |
            v
Express REST API (DocuGuard-Server)
            |
   +--------+---------+------------------+
   |                  |                  |
PostgreSQL/Supabase  Supabase/Storage   External services
(data, migrations)   (files/config)     Azure OCR, Firebase push,
                                        Resend email
```

## Technology Stack

### Mobile (`/`)

- React Native 0.86, React 19, Expo SDK ~57, Expo Router
- TypeScript, NativeWind/Tailwind (configured), Reanimated/Gesture Handler
- Expo modules: Camera, Image Picker/Manipulator, Document Scanner, SQLite, Secure Store, Local Authentication, Notifications, File System, Sharing, Document Picker, etc.
- Axios/Zod/React Hook Form

### Backend (`DocuGuard-Server/`)

- Node.js, Express 5
- PostgreSQL (`pg`), Supabase client
- Auth/security: JWT, bcrypt/bcryptjs, helmet, cors, express-rate-limit
- Integrations: Azure AI Form Recognizer, Firebase Admin (push), Resend (email), multer, ws, node-cron
- Validation/utilities: Zod

### Admin (`DocuGuard-Admin/`)

- Expo SDK ~58, Expo Router
- `react-native-biometric-signature`, Secure Store, notifications/device integrations

## Project Structure

```text
DocuGuard/
├─ app/                    # Expo Router screens (auth, tabs, document flows, etc.)
├─ components/             # Shared UI components
├─ context/                # Theme/app context providers
├─ hooks/                  # App hooks
├─ services/               # API, local DB, sync, notifications, backup, audit, etc.
├─ constants/              # Theme/colors/config constants
├─ utils/                  # Helpers
├─ types/                  # TypeScript types
├─ shared/                 # Shared schemas/utilities
├─ assets/                 # App assets
├─ DocuGuard-Server/       # Express API, routes, controllers, services, migrations
├─ DocuGuard-Admin/        # Admin Expo app
├─ app.json                # Expo config (scheme, plugins, EAS project, apiBaseUrl extra)
├─ eas.json                # EAS build/update profiles
└─ package.json            # Mobile app scripts/dependencies
```

### Key Backend Areas (`DocuGuard-Server/`)

- `routes/`: `auth`, `documents`, `dashboard`, `reminder`, `notification`, `admin`, `adminAuth`, `search`, `export`, `backup`, `subscription`, `profile`, `auditLogs`
- `controllers/`, `services/`, `middleware/`, `jobs/`, `utils/`, `config/`
- `migrations/001`–`012`: settings, audit log/retention, search vector, user roles, admin identity/device trust, privacy consent history, session revocation, idempotency, 2FA recovery codes, 2FA setup expiration, document audit logs, users 2FA/verification columns

## Getting Started

### Prerequisites

- Node.js (LTS recommended) and npm
- Expo tooling / Android/iOS environment as needed for React Native development
- PostgreSQL or Supabase project for backend data
- API keys/credentials for enabled integrations (see server env)

### 1) Install dependencies

```powershell
# Mobile app (root)
npm install

# Backend
cd DocuGuard-Server
npm install

# Admin app (optional)
cd ..\DocuGuard-Admin
npm install
```

### 2) Configure environment

- **Mobile:** `app.json` → `expo.extra.apiBaseUrl` points to the deployed/local API base URL (update for your environment/build profile).
- **Backend:** create `DocuGuard-Server/.env` from `DocuGuard-Server/.env.example` and set required values (database/Supabase, JWT, CORS, encryption, email, OCR/push as needed).
  - `NODE_ENV=production` requires `CORS_ALLOWED_ORIGINS` and proper secrets per server config.
  - `DISABLE_DEMO_SUBSCRIPTION_PAYMENTS=true` disables demo subscription activation route behavior.
- **Never commit real secrets** (`.env`, service keys, database credentials).

### 3) Database migrations

Apply SQL migrations in `DocuGuard-Server/migrations/` to your target database in order (review before production use). Recent additions include 2FA/recovery/setup and user verification/2FA columns (`012_users_2fa_verification_columns.sql`).

### 4) Run

```powershell
# Mobile app
npm start
npm run android
npm run ios

# Backend
cd DocuGuard-Server
npm run dev   # or: npm start
```

## Scripts

### Mobile (`package.json`)

- `npm start` — Expo dev server
- `npm run android` / `npm run ios` — native runs
- `npm run typecheck` — TypeScript check
- `npm test` — Node tests in `tests/*.test.js`
- `npm run check:server` — server checks from root context
- `npm run check` — typecheck + tests + server checks

### Backend (`DocuGuard-Server/package.json`)

- `npm run dev` — nodemon
- `npm start` — start server
- `npm run check:syntax` / `npm run check` — syntax/tests checks
- `npm test` — server tests

## Notes

- Some features depend on backend availability and correct environment/configuration (OCR, push notifications, email delivery, cloud storage/sync, subscription persistence).
- Native changes (plugins, permissions, splash/icon config, dev client requirements) may require a rebuild/prebuild/EAS build.
- 2FA recovery codes are stored hashed in `public.user_two_factor_recovery_codes`; verification/2FA fields are maintained on `users` per migrations/controllers.
- Demo subscription activation is not real payment processing; it updates subscription records for the authenticated user when enabled.

## License

Intended for academic and educational purposes (BSIT Capstone). See `LICENSE`.

## COMMANDS USED IN DEVELOPMENT PHASE:

eas build --platform android --profile preview
.\gradlew.bat app:assembleRelease -x lint -x test --configure-on-demand --build-cache
npx eas-cli update --channel preview --message "Debug login authentication flow" --platform android --environment preview
npx expo run:android
npx expo start --dev-client
npx expo run:android --variant release
