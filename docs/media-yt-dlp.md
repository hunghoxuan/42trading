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

Configure one channel/account per user in **Settings > Providers**. Use **YouTube Publishing** for
the OAuth client ID, client secret, refresh token, and channel label. Use **TikTok Publishing** for
the client key, client secret, access token, refresh token, and account label. Use **Facebook
Publishing** for the Page ID, Page access token, Page label, and Graph API version. These records use
the existing user-scoped Providers object store and the same encrypted-at-rest/masked-secret handling
as the other provider settings. No publishing credential is read from `.env`.

The YouTube refresh token must be authorized for the `youtube.upload` OAuth scope. Uploads use the
YouTube Data API resumable-upload endpoint and can be created as private, unlisted, or public.

TikTok uses the Content Posting API `video.upload` permission and sends the video to the account's
TikTok inbox as a draft. The account owner completes review and posting in TikTok. This avoids
silently direct-posting without TikTok's required creator/privacy interaction and separate
`video.publish` approval. A static access token is enough for short-lived/manual use. For reliable
scheduling, configure the client key, client secret, and refresh token; rotated tokens are written
back to the encrypted TikTok provider database record. Unmasked tokens are never returned by normal
settings or publishing-status requests.

Facebook publishing targets a Facebook Page Reel through Meta's Reels Publishing API. The Page
access token needs `pages_manage_posts`, `pages_read_engagement`, and `pages_show_list`. The module
uploads at the locally scheduled time and then publishes the Reel; Meta currently expects a vertical
9:16 video with a minimum 540 × 960 resolution and a 4–60 second duration. The Graph API version is
configurable in Providers and defaults to `v26.0`.

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
