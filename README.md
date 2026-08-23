# Cold Email Shooter

A production-grade cold email scheduler for **Outlook and Gmail**. Upload a CSV/Excel file, set dates and times, and the system sends emails through your own Microsoft or Google account via their official APIs — reliably, with deduplication, retries, and full status tracking. Also includes reply/bounce detection, threaded follow-up scheduling, and outreach-history checking.

**⚠️ Every person who runs this app needs their own credentials.** See [Multi-user setup](#multi-user-setup--each-person-needs-their-own-credentials) below before sharing this repo with anyone else — do not hand out your `.env` file or your Azure/Google app credentials.

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
- Your **own** Microsoft Azure app registration (see below) — required for Outlook
- Your **own** Google Cloud OAuth app (see below) — optional, only if you want Gmail sending too

---

## Multi-user setup — each person needs their own credentials

This app is designed to run **locally, one instance per person**. If you're sharing this repo with someone else (a friend, teammate, etc.), each person must:

1. **Clone the repo fresh** — never copy someone else's `.env` file. It's gitignored on purpose and contains secrets tied to one specific Azure/Google app and one specific session.
2. **Create their own Azure App Registration** (steps below) — do not reuse someone else's `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`. The client secret is effectively a password for that app registration; sharing it gives someone else's app the ability to act as that registration.
3. **Create their own Google Cloud OAuth app** (steps below) if they want Gmail support — same reasoning as above.
4. **Generate their own `SESSION_SECRET`** — never reuse one from another `.env`.
5. **Run their own Postgres + Redis** via `npm run infra:up` — each person's Docker containers are local to their machine, so there's no shared database and no risk of one person's OAuth tokens or scheduled campaigns showing up for another person. This happens automatically as long as everyone follows the setup steps below on their own machine — there's nothing extra to configure here.

When you log into Outlook or Gmail inside the app, the access/refresh tokens returned by Microsoft/Google are stored **only in your own local Postgres database** — they never leave your machine and are never committed to git. As long as each person has their own Azure/Google app registration and runs their own local database, there is no way for one person's login to end up using another person's tokens.

---

## Azure App Registration

Do this once per person using the app — **do not share your `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET` with anyone else.**

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
   - `Mail.ReadWrite` — needed for bounce/reply detection, threaded follow-up replies, and the outreach-history checker
   - `User.Read`
7. Click **Grant admin consent**

---

## Google Cloud OAuth App (optional — for Gmail support)

Only needed if you want the option to send/follow-up through Gmail as well as Outlook. Skip this section if you're only using Outlook.

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com) → create or select a project
2. **APIs & Services → Library** → search **Gmail API** → **Enable**
3. **APIs & Services → OAuth consent screen** (may show as "Google Auth Platform") → **Get started**:
   - App name: `Cold Email Shooter` (or anything)
   - Audience: *External* (unless you have a Google Workspace org)
   - Add your own Google account under **Test users** — while the app is in Testing mode, only test users can authorize it
4. **Data Access** tab → **Add or remove scopes** → add:
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.readonly` — needed for threaded follow-up replies
5. **APIs & Services → Credentials** → **Create Credentials → OAuth client ID**:
   - Application type: *Web application*
   - Authorized redirect URI: `http://localhost:3001/api/auth/google/callback`
6. Copy the **Client ID** → `GOOGLE_CLIENT_ID` and **Client Secret** → `GOOGLE_CLIENT_SECRET`

---

## Setup

### 1. Clone and install

```bash
cd "cold email shooter"
npm install            # installs root + workspaces
```

### 2. Environment variables

**Important:** the file the API actually reads is `apps/api/.env`, not the root `.env` — copy the example there.

```bash
cp .env.example apps/api/.env

# Fill in (use YOUR OWN values from the Azure/Google steps above — never copy someone else's):
#   MICROSOFT_CLIENT_ID
#   MICROSOFT_CLIENT_SECRET
#   MICROSOFT_TENANT_ID
#   MICROSOFT_REDIRECT_URI=http://localhost:3001/api/auth/callback
#   GOOGLE_CLIENT_ID          (optional, only if you want Gmail support)
#   GOOGLE_CLIENT_SECRET      (optional)
#   GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback
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

## Features

- **Campaign scheduling** — upload Apollo/LinkedIn/generic CSVs, personalize with `{{first_name}}`, `{{company}}`, `{{title}}`, `{{location}}`, schedule with per-recipient stagger, send via Outlook or Gmail
- **Follow-up tracking** — scans your Inbox for replies and out-of-office notices, groups recipients into Not followed up / Awaiting response / Responded, supports scheduled or immediate threaded follow-up replies (single or bulk), with attachments
- **Sent Log** — pick a date, see everything actually sent that day (reads real mailbox Sent Items, catches manually-sent emails too), with the same threaded follow-up tools
- **Analytics** — bounce/NDR detection, split by "Mail Delivery Subsystem" vs. other failure sources
- **Check Outreach** — upload a contact list, checks each recipient's Sent Items history to flag who's already been contacted
- **Hard safety rule** — the app refuses to send a follow-up to anyone who has already replied, enforced at the worker level (not just the UI)

## API Endpoints

### Auth
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/auth/login` | Get Microsoft OAuth URL |
| `GET` | `/api/auth/callback` | OAuth callback (redirect) |
| `GET` | `/api/auth/me` | Get current user |
| `GET` | `/api/auth/token-status` | Check Outlook token health |
| `POST` | `/api/auth/logout` | Clear session |
| `GET` | `/api/auth/google/login` | Get Google OAuth URL (Gmail) |
| `GET` | `/api/auth/google/callback` | Google OAuth callback |
| `GET` | `/api/auth/google/status` | Check Gmail connection status |
| `POST` | `/api/auth/google/disconnect` | Disconnect Gmail |

### Files & Attachments
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/files/upload` | Upload pre-formatted CSV/Excel, returns parsed preview |
| `POST` | `/api/files/upload-contacts` | Upload Apollo/LinkedIn/generic contacts CSV |
| `GET` | `/api/files` | List uploaded files |
| `POST` | `/api/attachments/upload` | Upload files to attach to campaigns |

### Emails
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/emails` | List email jobs (filters: status, dateFrom, dateTo, page, limit) |
| `GET` | `/api/emails/stats` | Dashboard statistics |
| `POST` | `/api/emails/schedule` | Schedule a batch of pre-formatted email jobs |
| `POST` | `/api/emails/schedule-campaign` | Schedule a personalized campaign from a contacts list |
| `GET` | `/api/emails/:id` | Get single email job with logs |
| `PATCH` | `/api/emails/:id/cancel` | Cancel a scheduled email |
| `POST` | `/api/emails/:id/retry` | Retry a failed email |
| `DELETE` | `/api/emails/:id` | Delete a completed/failed/cancelled email |
| `POST` | `/api/emails/test` | Send a test email immediately |

### Follow-up
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/followup/scan` | Scan Inbox for replies/OOO, refresh the follow-up list |
| `POST` | `/api/followup/sync-manual` | Check Sent Items for follow-ups sent manually (slow, on-demand) |
| `GET` | `/api/followup` | List current follow-ups |
| `PATCH` | `/api/followup/:id` | Mark a follow-up as done/not done |
| `POST` | `/api/followup/:id/send` | Send (or schedule) a threaded follow-up reply |
| `POST` | `/api/followup/bulk-send` | Send (or schedule) follow-ups to multiple recipients |
| `DELETE` | `/api/followup/:id` | Remove from the follow-up list |

### Sent Log
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sent-log` | Scan Sent Items for a date range, optionally excluding repliers |
| `POST` | `/api/sent-log/send` | Send a threaded follow-up to one Sent Log entry |
| `POST` | `/api/sent-log/bulk-send` | Bulk threaded follow-up from Sent Log entries |

### Analytics & Outreach
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/analytics/bounces` | Bounce/NDR report for a date range |
| `POST` | `/api/outreach/check` | Check a contact list against Sent Items history |

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
