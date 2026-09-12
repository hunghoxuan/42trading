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

## Publishing

Completed video files can be uploaded immediately or scheduled for a future date and time. Scheduled
uploads are persisted in the `media_publish_jobs` table and the API checks for due work every 15
seconds. An upload that was in progress when the API restarts is marked failed; scheduled work remains
queued.

Configure one channel/account per API instance in `src/api/.env`, then restart the API:

```dotenv
MEDIA_YOUTUBE_CLIENT_ID=
MEDIA_YOUTUBE_CLIENT_SECRET=
MEDIA_YOUTUBE_REFRESH_TOKEN=
MEDIA_YOUTUBE_CHANNEL_LABEL=My YouTube channel

MEDIA_TIKTOK_ACCESS_TOKEN=
MEDIA_TIKTOK_CLIENT_KEY=
MEDIA_TIKTOK_CLIENT_SECRET=
MEDIA_TIKTOK_REFRESH_TOKEN=
MEDIA_TIKTOK_ACCOUNT_LABEL=My TikTok account
```

The YouTube refresh token must be authorized for the `youtube.upload` OAuth scope. Uploads use the
YouTube Data API resumable-upload endpoint and can be created as private, unlisted, or public.

TikTok uses the Content Posting API `video.upload` permission and sends the video to the account's
TikTok inbox as a draft. The account owner completes review and posting in TikTok. This avoids
silently direct-posting without TikTok's required creator/privacy interaction and separate
`video.publish` approval. A static access token is enough for short-lived/manual use. For reliable
scheduling, configure the client key, client secret, and refresh token; rotated tokens are written to
the ignored `data/modules/yt-dlp/tiktok-token.json` file with owner-only permissions. Tokens are not
stored in the module database or returned to the admin UI.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/media/yt-dlp/status` | Runtime and FFmpeg status |
| `GET` | `/api/media/yt-dlp/jobs` | Current user's job history |
| `POST` | `/api/media/yt-dlp/jobs` | Start a download |
| `GET` | `/api/media/yt-dlp/jobs/{sid}` | Read one job |
| `POST` | `/api/media/yt-dlp/jobs/{sid}/cancel` | Cancel an active job |
| `GET` | `/api/media/yt-dlp/jobs/{sid}/file?index=0` | Save a completed output file |
| `GET` | `/api/media/yt-dlp/jobs/{sid}/preview?index=0` | Stream an inline audio/video preview |
| `DELETE` | `/api/media/yt-dlp/jobs/{sid}` | Delete history and the job output folder |
| `GET` | `/api/media/yt-dlp/publishing/status` | Configured publishing destinations |
| `GET` | `/api/media/yt-dlp/publishes` | Current user's publishing history and schedule |
| `POST` | `/api/media/yt-dlp/publishes` | Upload now or schedule an upload |
| `POST` | `/api/media/yt-dlp/publishes/{sid}/cancel` | Cancel a scheduled upload |

The backend constructs an allowlisted argument array and never accepts raw yt-dlp flags. Output
paths are generated server-side and file responses are constrained to the job's download folder.
Only HTTP(S) URLs are accepted; loopback and common private-network address literals are rejected.

Users are responsible for respecting site terms and downloading only media they are authorized to
access.
