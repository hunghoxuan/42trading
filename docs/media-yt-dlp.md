# Media: YT DLP

The Media > YT DLP module provides an authenticated web interface for downloading media with
[yt-dlp](https://github.com/yt-dlp/yt-dlp). Access is restricted by
`pages.media.yt_dlp`, `apis.media.yt_dlp.read`, and `apis.media.yt_dlp.write`; the default admin
role receives these through its existing wildcard permissions.

## Layout

- Admin module: `src/admin/modules/media/yt-dlp/`
- API module: `src/api/modules/media/ytDlp/`
- Local runtime: `data/modules/yt-dlp/runtime/bin/yt-dlp`
- Downloaded files: `data/modules/yt-dlp/downloads/{job_sid}/`
- SQLite database: `data/modules/yt-dlp/data.db`

The entire `data/` tree is ignored by git. Install or refresh the official standalone release:

```bash
pnpm media:yt-dlp:install
```

The installer selects the official release asset for the host platform, verifies it against the
release `SHA2-256SUMS`, and keeps it isolated from global Python packages. Set `YT_DLP_BIN` to use
another executable. FFmpeg must also be on `PATH` for audio conversion, metadata embedding, and
merging separate video/audio streams.

## Storage

The repository follows the active `MT5_STORAGE` backend:

- SQLite uses the module-local `data/modules/yt-dlp/data.db` file.
- PostgreSQL uses the current application pool and the same `media_yt_dlp_jobs` table schema.

Schema creation is idempotent. Jobs left queued or running across an API restart are marked failed,
because child processes cannot be reattached safely.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/media/yt-dlp/status` | Runtime and FFmpeg status |
| `GET` | `/api/media/yt-dlp/jobs` | Current user's job history |
| `POST` | `/api/media/yt-dlp/jobs` | Start a download |
| `GET` | `/api/media/yt-dlp/jobs/{sid}` | Read one job |
| `POST` | `/api/media/yt-dlp/jobs/{sid}/cancel` | Cancel an active job |
| `GET` | `/api/media/yt-dlp/jobs/{sid}/file?index=0` | Save a completed output file |

The backend constructs an allowlisted argument array and never accepts raw yt-dlp flags. Output
paths are generated server-side and file responses are constrained to the job's download folder.
Only HTTP(S) URLs are accepted; loopback and common private-network address literals are rejected.

Users are responsible for respecting site terms and downloading only media they are authorized to
access.
