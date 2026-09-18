# DocuGuard Backend Deployment Guide

## Option A: Render (Recommended) - Free Tier Available

### Prerequisites
- GitHub account (for auto-deploys)
- Render account (free at render.com)

### Step 1: Create Render PostgreSQL Database
1. Go to Render Dashboard → **New** → **PostgreSQL**
2. Name: `docuguard-db`
3. Database: `docuguard`
4. User: `docuguard`
5. Region: Oregon (US West)
6. Plan: Free
7. Click **Create Database**
8. Wait for status "Available"
9. Copy **External Database URL** and connection details

### Step 2: Create Supabase Project (for cloud sync/exports)
1. Go to supabase.com → **New Project**
2. Name: `docuguard`
3. Database Password: (save this!)
4. Region: US East (N. Virginia) or closest to you
5. Wait for setup (2-3 min)
6. Go to **Settings** → **API**
7. Copy: Project URL, anon key, service_role key
8. Go to **SQL Editor** → Run the contents of `supabase-schema.sql`

### Step 3: Create Render Web Service
1. Render Dashboard → **New** → **Web Service**
2. Connect your GitHub repo: `AsherDoesTechs/DocuGuard`
3. Root Directory: `DocuGuard-Server`
4. Configuration:
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: Free
5. Click **Create Web Service**

### Step 4: Configure Environment Variables
In Render Web Service → **Environment**, add all variables from `.env.example`:

**Required (from Step 1):**
```
DB_HOST=your-db-host.oregon-postgres.render.com
DB_USER=docuguard
DB_PASSWORD=your-db-password
DB_NAME=docuguard
DB_PORT=5432
DB_SSL=true
```

**Required (from Step 2):**
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWKS_URL=https://your-project.supabase.co/auth/v1/jwks
```

**Required (generate):**
```
JWT_SECRET=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```

**Optional (add as needed):**
```
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password

AWS_REGION=us-east-1
AWS_BUCKET_NAME=your-bucket
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx

AZURE_ENDPOINT=https://xxx.cognitiveservices.azure.com/
AZURE_KEY=xxx

FIREBASE_PROJECT_ID=xxx
FIREBASE_CLIENT_EMAIL=xxx
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

DEBUG_LOG_FILE=/tmp/docuguard_debug.log
```

### Step 5: Deploy
1. Click **Manual Deploy** → **Deploy latest commit**
2. Wait for build (2-3 min)
3. Test: `https://your-app.onrender.com/health` → should return `{"status":"ok"}`

---

## Option B: Supabase Edge Functions (Alternative)

If you prefer serverless, you can deploy as Supabase Edge Functions, but this requires more code changes. Render is simpler for this Express app.

---

## Frontend Configuration for Production

### Update `app.json` with your Render URL:
```json
{
  "expo": {
    "extra": {
      "apiBaseUrl": "https://your-render-app.onrender.com"
    }
  }
}
```

### Build and Test Production App:
```bash
# Install EAS CLI if not installed
npm install -g eas-cli

# Login to Expo
eas login

# Configure project (first time)
eas build:configure

# Build for production
eas build --platform all --profile production

# Or build preview for testing
eas build --platform all --profile preview
```

---

## Verify Deployment

### 1. Test Health Endpoint
```bash
curl https://your-app.onrender.com/health
# Expected: {"status":"ok","timestamp":"..."}
```

### 2. Test Auth Endpoints
```bash
# Register
curl -X POST https://your-app.onrender.com/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","password":"password123"}'

# Login
curl -X POST https://your-app.onrender.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

### 3. Test Protected Endpoints (with token from login)
```bash
curl https://your-app.onrender.com/documents \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### 4. Test Frontend
1. Install Expo Go on your phone
2. Run `npx expo start --tunnel` (for physical device testing)
3. Or build production APK/IPA with EAS

---

## Troubleshooting

### Database Connection Issues
- Verify `DB_SSL=true` for Render PostgreSQL
- Check firewall: Render allows all IPs by default
- Test locally with `psql "postgresql://user:pass@host:5432/db?sslmode=require"`

### CORS Errors
- Backend uses `cors()` with default settings (allows all origins)
- For production, restrict to your app domain in `app.js`:
  ```js
  app.use(cors({ origin: "https://your-app-domain.com" }));
  ```

### JWT Errors
- Ensure `JWT_SECRET` is set and same across restarts
- Token expires in 7 days (`expiresIn: "7d"`)

### Cron Job (expirationChecker)
- Runs daily at midnight on Render Free tier (may be delayed)
- For reliable cron, upgrade to paid plan or use external cron service

---

## Cost Summary (Free Tier)
| Service | Cost |
|---------|------|
| Render Web Service | Free (750 hrs/mo) |
| Render PostgreSQL | Free (90 days, then $7/mo) |
| Supabase | Free (500MB DB, 2GB bandwidth) |
| **Total** | **$0/month** (first 90 days) |

After 90 days: ~$7/mo for Render PostgreSQL, or migrate to Supabase free PostgreSQL.