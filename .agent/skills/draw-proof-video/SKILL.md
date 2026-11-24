---
name: draw-proof-video
description: Upload a Smart Buy draw video from the POS and play it privately in the app (members of that scheme only, not shareable). Use for draw video storage, signed URLs, the POS upload UI or the app player.
---

# Draw proof video

Why not YouTube: a private YouTube video only plays for the uploader and invited Google accounts, so
app users can't watch it; an unlisted link can be shared by anyone. So videos are self-hosted. See
`docs/mobile-app/ARCHITECTURE.md` §9.

## Storage
- Private location only: S3-compatible bucket (private ACL), or a VPS path such as
  `/data/private-media/draw-videos/` that nginx does NOT serve. NEVER the public `UPLOAD_DIR` or
  `/api/files/*`.
- Table `draw_proof_videos` (synced metadata): id, draw_id, scheme_id, storage_key, mime, duration_sec,
  size_bytes, status (`processing`|`ready`|`failed`), error, uploaded_by, created_at, updated_at.
  Column `chit_draws.proof_video_id`, `chit_draws.proof_published_at`.

## POS upload (ERP repo)
1. Smart Buy → draw detail → "Upload draw video" (MP4/MOV, ≤ 300 MB). Show progress and status.
2. Electron main process uploads in chunks to `POST /api/app/v1/admin/draw-videos` with the company
   sync key + POS user id (desktop already authenticates this way). Resume on failure.
3. Backend: write the chunks, then transcode with ffmpeg:
   `ffmpeg -i in -vf scale=-2:720 -c:v libx264 -preset veryfast -crf 26 -c:a aac -b:a 96k -movflags +faststart out.mp4`
   then set status `ready`, set `chit_draws.proof_video_id`, notify scheme members
   ("Draw result + video ready").

## Playback (server)
- `GET /api/app/v1/smartbuy/draws/:drawId/video` → allowed if the user is a member of that scheme
  (`chit_members.customer_id = ctx.customerId`) or the scheme's agent (`chit_schemes.agent_id`).
  Returns `{ url, expiresAt }`, where the url is `/api/app/v1/media/draw-videos/:id?token=` and
  token = HMAC(video id + user id + expiry), expiry 10 minutes.
- Media route: verify token + expiry, stream with HTTP Range (206), `Cache-Control: no-store`,
  `Content-Disposition: inline`, no directory listing, rate limited.

## Playback (app, `mobile/app/(smartbuy)/draw-video/[id].tsx`)
- `expo-video` (`useVideoPlayer` + `VideoView`), `nativeControls` with no share/download, no
  picture-in-picture, do not save the file locally.
- `usePreventScreenCapture()` from `expo-screen-capture` while the screen is mounted (Android
  FLAG_SECURE: screenshots and screen recordings show black).
- Fetch the signed URL with TanStack Query (`staleTime` < token expiry, never persisted to MMKV);
  re-request a fresh URL if playback fails with 403 mid-watch.
- Watermark overlay: an absolutely positioned `Text` with the viewer's member number + date,
  semi-transparent, moving slowly (Reanimated).
- Winner card text for other members uses the masked name (`K. Ra… · Member #12`).

## Tests
- Non-member token → 403. Expired/forged token → 403. Range requests work (seek).
- Screenshot/screen recording on the player shows black.
- The public files route cannot reach the video.
