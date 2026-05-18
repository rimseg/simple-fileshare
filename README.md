# Simple Fileshare

Self-hosted, password-protected file and folder sharing with one-click links.
Multi-user with role-based access: admins manage users, configure per-user
quotas and see all shares; regular users manage their own shares within their
limits.

```
fileshare/
├── backend/      # Node.js + Express API (SQLite, multer, cron cleanup)
├── frontend/     # React + Vite SPA (login, share management, public download page)
├── nginx/        # Reverse-proxy config (compose proxy + host example)
└── docker-compose.yml
```

## Features

- **Login** with username/password. The first admin is seeded from `.env` on
  initial start.
- **User management** (admin only): create/delete users, reset passwords,
  assign `admin` or `user` role, and set per-user limits:
  - **Max share lifetime in days** (`0` = unlimited; new users default to `14`,
    new admins default to `0`).
  - **Max storage in bytes** (`0` = no per-user cap; the user shares the
    system-wide pool, same view as admins).
- **Create share links** with an optional label, a download password and a
  lifetime in days. If your account allows it, lifetime `0` produces a link
  that never expires.
- **Upload files or whole folders** by drag-and-drop or file picker. Folder
  structure is preserved.
- **Drop-mode shares**: opt-in flag at creation that lets the recipient upload
  files via the public link (same password-protected page). The lifetime
  timer doesn't start until the first file is uploaded — so the link can be
  shared in advance and the recipient has time to deposit files.
- **Public share page** at `/share/<token>`: enter the password, then either
  download files individually / as a ZIP, or — if drop-mode is enabled —
  upload more files into the share.
- **Storage display** that adapts to the viewer:
  - Admins (and users without a personal cap) see real disk usage at the
    upload directory.
  - Users with a personal cap see their own consumption against that cap.
  - A pre-upload check rejects writes that would exceed the relevant limit.
- **Light / dark theme toggle** in the header (sun/moon icon, persisted to
  `localStorage`); falls back to the OS preference on first visit.
- **Automatic cleanup**: hourly cron job removes expired shares and their
  files. Drop shares whose timer hasn't started, and shares with no
  expiration, are skipped.
- **Docker Compose setup** with nginx as a reverse proxy.

## Setup

```bash
git clone <repo-url> fileshare
cd fileshare
cp backend/.env.example backend/.env
# Edit backend/.env — at a minimum change ADMIN_PASSWORD and JWT_SECRET!

docker compose up -d --build
```

The app is then reachable at <http://localhost:8080>:

- `/login` – login page (use the seeded admin credentials from `.env`)
- `/shares` – your own shares (any logged-in user)
- `/shares/:id` – manage files for a single share (upload, delete, change password)
- `/all-shares` – every share in the system (admin only)
- `/users` – user management (admin only)
- `/share/<token>` – public download page (password required)

## Configuration (`backend/.env`)

| Variable             | Meaning                                                                |
|----------------------|------------------------------------------------------------------------|
| `ADMIN_USERNAME`     | Admin username (only created on first start)                           |
| `ADMIN_PASSWORD`     | Admin plaintext password (hashed and written to the database)          |
| `JWT_SECRET`         | Secret used to sign session and download tokens — must be set          |
| `MAX_UPLOAD_BYTES`   | Maximum size per file in bytes (default 2 GiB)                         |
| `MAX_STORAGE_BYTES`  | Hard ceiling on total storage in bytes; `0` = use whatever disk allows |
| `PORT`               | Backend port inside the container (default 3000)                       |

`MAX_STORAGE_BYTES` is the system-wide cap — when it's `0`, the backend
reports the real free space on the filesystem hosting the upload directory
(`statfs`) and rejects uploads that wouldn't fit. When it's a positive
number, that's the ceiling instead (still bounded by what's actually
available on disk).

Per-user limits (`max_lifetime_days`, `max_storage_bytes`) are **not**
configured via env vars — they're set per account from the admin Users page.
Defaults for newly created accounts:

- new `user`: 14-day max lifetime, no personal storage cap (shares the system
  pool)
- new `admin`: unlimited lifetime, no personal storage cap

## Data & persistence

The backend stores everything under `/data` inside the container, mounted in
the `fileshare-data` volume:

- `/data/fileshare.db` – SQLite (users, shares, file metadata)
- `/data/uploads/<token>/...` – uploaded files, original folder structure preserved

When a share is deleted or expires, the database row and the corresponding
directory are removed together.

The first time the new schema is applied on top of an existing database, the
migration adds `max_lifetime_days` (default `14`) and `max_storage_bytes`
(default `0`) to existing users, then promotes existing admins to unlimited
lifetime.

## nginx

The stack ships with **two nginx layers**, and the difference matters when
you deploy:

```
internet ──TLS──> host nginx ──HTTP──> 127.0.0.1:8080
                                            │
                                            ▼
                               fileshare-proxy container
                                  (splits / vs /api/)
                                       │       │
                                       ▼       ▼
                                   frontend  backend
```

| File                       | Where it runs            | What it does                                       |
|----------------------------|--------------------------|----------------------------------------------------|
| `nginx/proxy.conf`         | Inside the Compose stack | Routes `/api/*` to the backend, everything else to the SPA. Talks to `backend:3000` / `frontend:80` via Docker DNS. |
| `nginx/host-example.conf`  | On the host (Ubuntu etc.)| Terminates TLS for your public domain and forwards everything to `127.0.0.1:8080`. |

The Compose stack only publishes the in-container proxy on
`127.0.0.1:8080` (loopback only) — your host nginx is what speaks to the
outside world.

### Deploying behind a real domain

1. Point an A/AAAA record at the server.
2. Copy `nginx/host-example.conf` to
   `/etc/nginx/sites-available/<your-domain>` and replace the placeholder
   hostname.
3. `sudo ln -s /etc/nginx/sites-available/<your-domain> /etc/nginx/sites-enabled/`
4. `sudo certbot --nginx -d <your-domain>` to obtain a cert and let
   Certbot fill in the `ssl_*` lines / add an HTTP→HTTPS redirect.
5. `sudo nginx -t && sudo systemctl reload nginx`.

### Common pitfall

Don't put `proxy_pass http://backend:3000` (or `frontend:80`) in the host
nginx config. Those names only resolve inside the Docker network. The host
nginx must always point at `http://127.0.0.1:8080`; the in-container proxy
handles the API/SPA split from there.

### Allowing large uploads

Three places need to agree, otherwise the smallest one will reject the
request:

```nginx
client_max_body_size 2g;        # set in BOTH host nginx and proxy.conf
proxy_request_buffering off;
proxy_read_timeout 1h;
proxy_send_timeout 1h;
```

…and `MAX_UPLOAD_BYTES` in `backend/.env` must be at least as large.

## Development (without Docker)

```bash
# Backend
cd backend
cp .env.example .env
npm install
npm run dev      # http://localhost:3000

# Frontend (second terminal)
cd frontend
npm install
npm run dev      # http://localhost:5173, /api -> 3000 via Vite proxy
```

## API overview

| Method | Path                                       | Auth          | Purpose                                 |
|--------|--------------------------------------------|---------------|-----------------------------------------|
| POST   | `/api/auth/login`                          | –             | Log in, receive a session token         |
| GET    | `/api/storage`                             | User          | Storage usage / quota (per-user or system) |
| GET    | `/api/me/profile`                          | User          | Current user incl. per-user limits      |
| GET    | `/api/me/shares`                           | User          | List your own shares                    |
| POST   | `/api/me/shares`                           | User          | Create a new share                      |
| GET    | `/api/me/shares/:id`                       | User (owner)  | Share details + file list               |
| DELETE | `/api/me/shares/:id`                       | User (owner)  | Delete share + all files                |
| PUT    | `/api/me/shares/:id/password`              | User (owner)  | Change the download password            |
| POST   | `/api/me/shares/:id/files`                 | User (owner)  | Upload one file                         |
| DELETE | `/api/me/shares/:id/files/:fileId`         | User (owner)  | Delete one file                         |
| GET    | `/api/admin/users`                         | Admin         | List users (incl. quotas + bytes used)  |
| POST   | `/api/admin/users`                         | Admin         | Create a user (with quotas)             |
| PUT    | `/api/admin/users/:id`                     | Admin         | Update a user's per-user quotas         |
| PUT    | `/api/admin/users/:id/password`            | Admin         | Reset a user's password                 |
| DELETE | `/api/admin/users/:id`                     | Admin         | Delete user + all their shares          |
| GET    | `/api/admin/shares`                        | Admin         | List every share in the system          |
| DELETE | `/api/admin/shares/:id`                    | Admin         | Delete any share                        |
| GET    | `/api/share/:token/info`                   | –             | Public link metadata (label, expiry, drop flag) |
| POST   | `/api/share/:token/auth`                   | Password      | Exchange password for download token    |
| GET    | `/api/share/:token/files`                  | Download tok. | List downloadable files                 |
| GET    | `/api/share/:token/files/:fileId/download` | Download tok. | Download one file                       |
| GET    | `/api/share/:token/zip`                    | Download tok. | Download everything as a ZIP            |
| POST   | `/api/share/:token/files`                  | Download tok. | Guest upload (drop-mode shares only)    |

## Security notes

- **Always change `JWT_SECRET`** to a long random string before exposing the
  service. Existing session and download tokens are invalidated when the
  secret changes.
- **Change `ADMIN_PASSWORD`** before the first start. The hash is written to
  the database on first boot and is **not** re-synced from `.env` afterwards
  — to reset, delete the user row in the DB or recreate the volume.
- **Run a TLS reverse proxy** in front of the stack (see
  `nginx/host-example.conf`).
- Login and share-password endpoints are rate-limited (per IP, and per
  IP+token for share auth) to slow down brute-force attempts.

## License

MIT — see [LICENSE](LICENSE).
