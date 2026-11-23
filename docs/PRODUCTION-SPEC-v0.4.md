# Social Hub — Production Specification (v0.4)

This version supersedes the media-storage and upload assumptions in v0.2/v0.3. The confirmed product direction is **No Permanent Video Storage in Social Hub**.

## 1. Confirmed product rules
- One employee submission contains one source video and one caption.
- The same source content and caption are intended for TikTok, Instagram, Facebook, and Threads.
- One parent post creates four independent destination tasks.
- Daily minimum target: one parent post successfully published to all four platforms.
- 100 employees at the minimum target means 100 source submissions and 400 destination tasks per day.
- Social Hub must not maintain a permanent media library or long-term cloud archive of employee videos.
- Social Hub stores post metadata, destination statuses, provider post IDs, timestamps, and audit records—not a permanent copy of the video.

## 2. Important API constraint — no universal direct-upload path
“Direct from Android to all four platforms with absolutely no intermediary media location” cannot be promised. Official platform APIs have different upload models and eligibility requirements. Some offer upload sessions that can receive bytes from a client; others may require the platform to fetch the media from a URL that it can access. In URL-fetch workflows, the phone's private local file URI is not sufficient.

Therefore the implementation uses a capability-based upload strategy:
1. Prefer a platform's official upload-session / binary upload flow when the approved API supports it.
2. If a platform requires a fetchable media URL, use a short-lived, private-by-default temporary relay/object location only for that destination, with an unguessable signed URL, strict expiry, and deletion after the platform confirms it has ingested the media or after a short failure timeout.
3. If neither compliant route is available for an employee's account/app permission, mark that destination `blocked` and explain why. Never fall back to browser automation, scraping, password collection, or unofficial endpoints.
4. Do not silently claim “zero cloud transfer” where the provider's API requires a URL-fetch step. The product promise is no permanent Social Hub video storage; temporary transfer may be technically necessary and must be disclosed.

## 3. Proposed upload workflow
1. Employee chooses a video from the Android gallery using the system file picker and enters one caption.
2. App validates basic file metadata (size, duration, type) locally; backend validates again. Local validation is only a convenience, not a security boundary.
3. Backend checks employee ownership, connected-account status, granted OAuth scopes, platform eligibility, and supported media constraints before starting publication.
4. Backend creates one parent post and four destination task records with stable idempotency keys.
5. App streams/uploads the source bytes through the selected official upload-session path where supported. The app must not expose platform client secrets or long-lived OAuth refresh tokens.
6. A destination requiring URL fetch receives a temporary media relay URL or temporary object URL. It must be non-indexable, unguessable, short-lived, HTTPS-only, and scoped to that publication task. Do not create a public permanent bucket or reusable URL.
7. Platform workers initiate/finalize publication and poll/webhook for status as the API requires.
8. Once a platform confirms it has ingested the media, delete that destination's temporary copy as soon as safely possible. If the provider's asynchronous fetch window is not yet complete, retain only until its documented fetch window ends.
9. On transient failure, retry only if safe and while a valid source/temporary transfer is available. If source bytes are no longer available, ask the employee to select/upload the video again; do not claim an automatic retry is possible.
10. Clear temporary files and signed URLs on completion, cancellation, expiry, and terminal failure. Keep metadata/status only.

## 4. Same-content integrity
- Keep one canonical caption and source media reference for the parent post during the active submission.
- Four destination tasks refer to that same source and caption.
- Do not silently translate, rewrite, shorten, crop, or substitute content. Technical transcoding/packaging is allowed only when required by the platform and must preserve the message and essential visual content.
- If a platform has a caption or media constraint that the source cannot satisfy, show a validation error before publishing. Do not silently truncate captions.
- If platform-specific media processing produces a derivative, treat it as temporary and delete it after ingestion/completion.

## 5. Daily target accounting
- Reporting timezone: Asia/Jakarta by default, configurable by admin.
- A platform counts as successful only when the platform API confirms publication (or a documented status reliably confirms it).
- Employee reaches 1/1 only when all four destination tasks are successful.
- Partial status such as 3/4 is not complete.
- A disconnected, ineligible, or unauthorized destination is blocked/not published, not success.

## 6. Retry and duplicate prevention
- Unique idempotency key per `(parent_post_id, platform)`.
- Persist provider post ID and confirmed status before marking a destination complete.
- Retry transient errors (timeouts, 429, temporary 5xx) with bounded exponential backoff and jitter; honor `Retry-After` and provider limits.
- Do not retry permanent errors (invalid media, permission denied, ineligible account) until corrected.
- Before resubmitting an ambiguous request, reconcile provider status where possible. Never blindly create a second post.
- Since Social Hub does not retain permanent source media, retries that need the original bytes may require the employee to reselect the video. Clearly communicate this in the UI.

## 7. Data retention and privacy
- No permanent Social Hub video storage.
- Temporary media copies/relay objects exist only to satisfy a platform's upload protocol and are deleted as soon as the platform has ingested them or the provider's required fetch window has ended.
- Set a short hard expiry for temporary objects and run a cleanup worker. A suggested initial safety ceiling is 24 hours, subject to provider documentation; shorten it whenever safely possible.
- Never delete a temporary copy while a provider still needs to fetch it. Never keep it for the old seven-day retention period.
- Store only necessary metadata, publication outcomes, provider post IDs, and security/audit events under a separate retention policy.
- Do not log video bytes, signed media URLs, OAuth tokens, or secrets. Redact sensitive values from errors and telemetry.

## 8. Dashboard requirements
Employee:
- One daily target: 0/1 or 1/1.
- Four destination statuses: TikTok, Instagram, Facebook, Threads.
- Clear states: queued, uploading, processing, published, retrying, failed, blocked, reconnect required.
- Explain when a failed task needs the employee to reselect the video because no source copy is retained.
Admin:
- Completion by employee, date, and platform.
- Success, partial, failed, pending, and blocked totals.
- Connected-account eligibility, API permission state, and audit history.

## 9. Platform and approval caveats
- TikTok Content Posting API requires approved scopes and may require app review/audit; unaudited access may be restricted.
- Instagram publishing requires eligible account types and the appropriate Meta permissions. Some publishing flows require a media URL that Meta can fetch.
- Facebook publishing is generally for Pages and supported publishing surfaces, not ordinary personal profiles. Upload flow varies by content type.
- Threads has its own OAuth scopes, publishing constraints, and media ingestion flow; video publishing may require a fetchable media URL.
- Do not promise all four platforms for every personal account. Validate account eligibility and API permissions during connection and before each post.

## 10. Security requirements
- Use official OAuth authorization. Never collect or store employees' social passwords.
- Keep OAuth client secrets and refresh tokens on the backend; encrypt tokens at rest and restrict access by employee/account.
- Use short-lived signed URLs, TLS, strict upload size/type checks, rate limits, per-user ownership checks, and secure temporary-file handling.
- Do not put storage credentials, provider secrets, or privileged tokens in the APK.

## 11. Infrastructure implications
- Keep PostgreSQL for employees, social connections, parent posts, destination tasks, and audit metadata.
- Keep a worker/queue for independent platform tasks. A PostgreSQL-backed queue can be used in the zero-cost prototype; Redis/BullMQ can be added when load requires it.
- Remove permanent S3/R2 media-library as a required component. If a URL-fetch API requires it, configure a dedicated temporary-transfer bucket with strict lifecycle deletion and no permanent archive. If a provider supports direct upload sessions, bypass the bucket for that destination.
- A pure zero-cost prototype can simulate the workflow, but real multi-platform publishing depends on app approval, API scopes, platform account eligibility, and service quotas.

## 12. Implementation status
This is a specification update, not a completed implementation. The current starter archive still contains an S3-compatible storage helper and earlier media schema as scaffolding; they must be refactored so permanent media storage is not the default. Before production use, implement and test:
- Android/PWA upload-session client and backend orchestration.
- Per-platform capability adapters (direct upload vs temporary URL fetch) based on current official API documentation.
- Temporary media relay with strict expiry, cleanup, and provider-fetch-window handling.
- Parent post + four destination-task schema and daily target reports.
- OAuth, token encryption/key management, refresh/revocation handling.
- Provider-specific publishing, status polling/webhooks, idempotency and duplicate reconciliation.
- Worker bootstrap, observability, alerts, backups, security hardening, and load tests.
