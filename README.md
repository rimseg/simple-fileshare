# Simple Fileshare

Self-hosted, password-protected file and folder sharing with one-click links and
configurable lifetime (up to 30 days). Multi-user with role-based access:
admins manage users and see all shares, regular users manage their own.

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
  assign `admin` or `user` role.
- **Create share links** with an optional label, a download password and a
  lifetime (1–30 days).
- **Upload files or whole folders** by drag-and-drop or file picker. Folder
  structure is preserved.
- **Public download page** at `/share/<token>`: enter the password, then
  download files individually or grab everything as a single ZIP.
- **Storage quota** with a usage bar and per-upload pre-check.
- **Automatic cleanup**: hourly cron job removes expired shares and their
  files.
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

| Variable             | Meaning                                                       |
|----------------------|---------------------------------------------------------------|
| `ADMIN_USERNAME`     | Admin username (only created on first start)                  |
| `ADMIN_PASSWORD`     | Admin plaintext password (hashed and written to the database) |
| `JWT_SECRET`         | Secret used to sign session and download tokens — must be set |
| `MAX_LIFETIME_DAYS`  | Upper bound for share lifetime in days (default 30)           |
| `MAX_UPLOAD_BYTES`   | Maximum size per file in bytes (default 2 GiB)                |
| `MAX_STORAGE_BYTES`  | Total storage budget across all shares (default 10 GiB)       |
| `PORT`               | Backend port inside the container (default 3000)              |

## Data & persistence

The backend stores everything under `/data` inside the container, mounted in
the `fileshare-data` volume:

- `/data/fileshare.db` – SQLite (users, shares, file metadata)
- `/data/uploads/<token>/...` – uploaded files, original folder structure preserved

When a share is deleted or expires, the database row and the corresponding
directory are removed together.

## nginx

Two configs are included:

- `nginx/proxy.conf` – used by the `proxy` container in Compose; also serves
  as a template for your own setups.
- `nginx/host-example.conf` – example for a host nginx instance with TLS
  termination, pointing at the Compose stack on `127.0.0.1:8080`.

Important when allowing large uploads:

```nginx
client_max_body_size 2g;
proxy_request_buffering off;
proxy_read_timeout 1h;
proxy_send_timeout 1h;
```

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

| Method | Path                                       | Auth          | Purpose                              |
|--------|--------------------------------------------|---------------|--------------------------------------|
| POST   | `/api/auth/login`                          | –             | Log in, receive a session token      |
| GET    | `/api/storage`                             | User          | Storage usage / quota                |
| GET    | `/api/me/shares`                           | User          | List your own shares                 |
| POST   | `/api/me/shares`                           | User          | Create a new share                   |
| GET    | `/api/me/shares/:id`                       | User (owner)  | Share details + file list            |
| DELETE | `/api/me/shares/:id`                       | User (owner)  | Delete share + all files             |
| PUT    | `/api/me/shares/:id/password`              | User (owner)  | Change the download password         |
| POST   | `/api/me/shares/:id/files`                 | User (owner)  | Upload one file                      |
| DELETE | `/api/me/shares/:id/files/:fileId`         | User (owner)  | Delete one file                      |
| GET    | `/api/admin/users`                         | Admin         | List users                           |
| POST   | `/api/admin/users`                         | Admin         | Create a user                        |
| PUT    | `/api/admin/users/:id/password`            | Admin         | Reset a user's password              |
| DELETE | `/api/admin/users/:id`                     | Admin         | Delete user + all their shares       |
| GET    | `/api/admin/shares`                        | Admin         | List every share in the system       |
| DELETE | `/api/admin/shares/:id`                    | Admin         | Delete any share                     |
| GET    | `/api/share/:token/info`                   | –             | Public link metadata (label, expiry) |
| POST   | `/api/share/:token/auth`                   | Password      | Exchange password for download token |
| GET    | `/api/share/:token/files`                  | Download tok. | List downloadable files              |
| GET    | `/api/share/:token/files/:fileId/download` | Download tok. | Download one file                    |
| GET    | `/api/share/:token/zip`                    | Download tok. | Download everything as a ZIP         |

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
