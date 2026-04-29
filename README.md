# Cold Email Shooter

A production-grade Outlook email scheduler. Upload a CSV/Excel file, set dates and times, and the system sends emails through your Microsoft Outlook account via the Graph API — reliably, with deduplication, retries, and full status tracking.

---

## Architecture

```
cold-email-shooter/
├── apps/
│   ├── api/              # Express + Prisma + BullMQ backend
│   └── web/              # Next.js 14 frontend
├── test-data/
│   └── sample-emails.csv # Sample file to test with
├── docker-compose.yml    # PostgreSQL + Redis
└── .env.example
```

**Stack choices:**

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 14 | App Router, built-in proxy via rewrites, TypeScript |
| Backend | Express + TypeScript | Clean separation of concerns, easy to test |
| Database | PostgreSQL + Prisma | Type-safe queries, proper migrations, ACID |
| Queue | BullMQ + Redis | Persistent jobs survive restarts, exponential backoff |
| Email | Microsoft Graph API | Official Outlook integration, delegated OAuth 2.0 |
| Auth | MSAL Node | First-party, handles PKCE + token cache |

---

## Prerequisites

- Node.js 20+
- Docker + Docker Compose (for PostgreSQL and Redis)
- A Microsoft Azure app registration (see below)

---

## Azure App Registration

1. Go to [https://portal.azure.com](https://portal.azure.com) → **Azure Active Directory** → **App registrations** → **New registration**
2. Name: `Cold Email Shooter` (or anything)
3. Supported account types: *Accounts in any organizational directory and personal Microsoft accounts*
4. Redirect URI: `Web` → `http://localhost:3001/api/auth/callback`
5. After creation:
   - Copy **Application (client) ID** → `MICROSOFT_CLIENT_ID`
   - Copy **Directory (tenant) ID** → `MICROSOFT_TENANT_ID`
   - Go to **Certificates & secrets** → New client secret → copy value → `MICROSOFT_CLIENT_SECRET`
6. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated**:
   - `openid`, `profile`, `email`, `offline_access`
   - `Mail.Send`
   - `User.Read`
7. Click **Grant admin consent**

---

## Setup

### 1. Clone and install

```bash
cd "cold email shooter"
npm install            # installs root + workspaces
```

### 2. Environment variables

```bash
# Root .env (used by the API)
cp .env.example .env

# Fill in:
#   MICROSOFT_CLIENT_ID
#   MICROSOFT_CLIENT_SECRET
#   MICROSOFT_TENANT_ID
#   MICROSOFT_REDIRECT_URI=http://localhost:3001/api/auth/callback
#   SESSION_SECRET=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
#   DATABASE_URL=postgresql://ces_user:ces_pass@localhost:5432/cold_email_shooter
#   REDIS_URL=redis://localhost:6379
#   SAFE_MODE=true

# Frontend
cp apps/web/.env.local.example apps/web/.env.local
```

### 3. Start infrastructure

```bash
npm run infra:up       # starts PostgreSQL and Redis in Docker
```

### 4. Database migrations

```bash
npm run db:migrate     # runs Prisma migrations
npm run db:generate    # generates Prisma client
```

### 5. Start development servers

```bash
npm run dev            # starts both API (port 3001) and web (port 3000)
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## SAFE_MODE

When `SAFE_MODE=true` (default):
- Emails are **not** sent through Outlook.
- The worker logs what would have been sent.
- All other functionality (scheduling, status tracking, queue, DB) works normally.
- Email jobs are marked as `SENT` with a `[SAFE_MODE]` note in the logs.

When `SAFE_MODE=false`:
- Emails are sent for real through the Microsoft Graph API.
- Ensure you have valid OAuth tokens and the correct permissions.

---

## CSV/Excel Format

Required columns (case-insensitive, order doesn't matter):

| Column | Format | Example |
|---|---|---|
| `recipient_email` | Valid email | `alice@example.com` |
| `subject` | Plain text | `Hello Alice!` |
| `body` | Plain text or HTML | `Dear Alice, ...` |
| `send_date` | `YYYY-MM-DD` | `2026-05-01` |
| `send_time` | `HH:MM` or `HH:MM:SS` | `09:30` |
| `timezone` | IANA timezone (optional) | `America/New_York` |

See [test-data/sample-emails.csv](test-data/sample-emails.csv) for an example.

---

## API Endpoints

### Auth
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/auth/login` | Get Microsoft OAuth URL |
| `GET` | `/api/auth/callback` | OAuth callback (redirect) |
| `GET` | `/api/auth/me` | Get current user |
| `POST` | `/api/auth/logout` | Clear session |

### Files
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/files/upload` | Upload CSV/Excel, returns parsed preview |
| `GET` | `/api/files` | List uploaded files |

### Emails
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/emails` | List email jobs (filters: status, dateFrom, dateTo, page, limit) |
| `GET` | `/api/emails/stats` | Dashboard statistics |
| `POST` | `/api/emails/schedule` | Schedule a batch of email jobs |
| `GET` | `/api/emails/:id` | Get single email job with logs |
| `PATCH` | `/api/emails/:id/cancel` | Cancel a scheduled email |
| `POST` | `/api/emails/:id/retry` | Retry a failed email |
| `DELETE` | `/api/emails/:id` | Delete a completed/failed/cancelled email |
| `POST` | `/api/emails/test` | Send a test email immediately |

---

## Running Tests

```bash
cd apps/api
npm test
```

---

## Production Deployment

1. Set `NODE_ENV=production` and `SAFE_MODE=false`
2. Use managed PostgreSQL (e.g., Supabase, Railway, AWS RDS)
3. Use managed Redis (e.g., Upstash, Redis Cloud)
4. Set `MICROSOFT_REDIRECT_URI` to your production callback URL
5. Run `npm run build` in both `apps/api` and `apps/web`
6. Run `npm run db:migrate:prod` to apply migrations
7. Start with `node dist/index.js` (API) and `next start` (web)
8. Use a process manager like PM2 or deploy via Docker

---

## Security

- Sessions stored in Redis (not in-memory) — survives restarts
- OAuth state parameter validated to prevent CSRF
- Tokens stored server-side, never exposed to the frontend
- Token expiry checked and refreshed automatically (60s before expiry)
- File uploads validated by type, size, and column schema
- All inputs validated with Zod
- Idempotency keys prevent duplicate email sends
- `httpOnly`, `sameSite`, `secure` cookies in production
- CORS restricted to `FRONTEND_URL`
- Helmet headers enabled
