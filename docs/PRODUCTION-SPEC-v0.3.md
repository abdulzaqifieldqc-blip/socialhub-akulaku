# Social Hub — Production Specification (v0.3)

## 1. Confirmed publishing rule
- Each employee's daily minimum target is **one content item published to all four platforms**.
- The same source video/media and the same caption are used for TikTok, Instagram, Facebook, and Threads.
- One employee submission creates one parent content/post record and four independent destination publication tasks.
- A successful submission to one platform does not imply success on the other three.
- Daily completion is achieved only when all four destination tasks have a confirmed successful publication result.
- If one or more destinations fail, the parent content remains partially complete and only failed/retryable destinations are retried. Do not republish destinations already confirmed successful.

## 2. Capacity baseline
For 100 employees at the minimum target:
- 100 source content submissions per day.
- 400 destination publication tasks per day (100 per platform).
- 7-day media retention applies to the original uploaded media, subject to the active-job hold described below.

This is a planning baseline, not a guaranteed API throughput. Platform permissions, account eligibility, review/audit status, rate limits, and provider availability can affect actual publishing.

## 3. Submission and publishing workflow
1. Employee logs in to Social Hub.
2. Employee uploads one source video and enters one caption.
3. Employee selects all four connected platforms (the default selection should be all four).
4. Backend validates account connection and known platform eligibility.
5. Backend creates a parent post and four destination tasks with unique idempotency keys.
6. The media is uploaded once to private object storage. The backend creates platform-specific delivery/processing steps as required by each API.
7. Independent platform workers process their own task, with bounded retries and exponential backoff.
8. Each platform result is recorded separately with provider post ID, status, timestamps, and a sanitized error code/message.
9. The employee dashboard shows four separate results and the daily target progress.

## 4. Same-content integrity
- Store one canonical source asset and one canonical caption on the parent post.
- Destination tasks reference the same parent post and canonical asset/caption.
- Do not silently rewrite, translate, shorten, or replace the employee's caption.
- Platform-specific technical transformations (for example, video container/codec/resolution packaging or required metadata mapping) may be performed only as required for compatibility; they must preserve the content and message.
- If a platform requires a feature or format the source cannot satisfy, report that destination as blocked/needs attention rather than silently substituting different content.
- If a platform has a different caption limit or unsupported feature, validate before queuing and show the employee a clear explanation. Do not silently truncate the caption.

## 5. Daily target accounting
- Use the company's configured timezone for daily reporting; default proposal: Asia/Jakarta.
- Count a destination as complete only after the platform API returns a confirmed publish result (or a provider status that reliably confirms publication).
- The employee reaches 1/1 daily target only when all four destinations are successful.
- Partial completion must be visible, e.g. 3/4, and must not be reported as fully complete.
- A platform account disconnected, ineligible, or lacking required permission must be marked clearly; it must not be counted as published.
- Admin reports should show employee, business date, parent post, and each of the four destination outcomes.

## 6. Idempotency and retry rules
- Use a stable unique key for each `(parent_post_id, platform)` destination task.
- Persist the provider's post ID and final success state before acknowledging completion.
- Retry transient failures (timeouts, 429, temporary 5xx) with exponential backoff and jitter, respecting `Retry-After` and platform limits.
- Do not retry permanent failures (invalid media, permission denied, account ineligible) until the underlying issue is fixed.
- A retry must never create a second publication when the provider has already accepted the original request. Where provider APIs do not offer idempotency, reconcile by querying provider status before resubmitting.

## 7. Seven-day media retention
- Keep original uploaded media for seven days from upload time.
- Never delete an asset while any destination task is queued, processing, or otherwise still needs the source.
- Retention cleanup checks database references and task states before deletion.
- After successful publication to all selected destinations and after the seven-day retention period, delete the original media and related temporary derivatives.
- Keep post metadata, publication results, and audit records according to their separate retention policy.
- Configure object-storage lifecycle expiry as a safety net later than the application retention window (e.g. 10 days), not earlier, so it cannot delete an asset held for an active job.

## 8. Dashboard requirements
Employee:
- Daily target: 0/1 or 1/1.
- Destination status: TikTok, Instagram, Facebook, Threads.
- Clear partial status, retry state, reconnect action, and actionable errors.
Admin:
- Daily completion by employee and platform.
- Success, partial, failed, pending, and blocked totals.
- Disconnected/ineligible accounts and audit history.

## 9. Platform/API caveats
- Instagram publishing generally requires eligible professional accounts and correct Meta permissions.
- Facebook publishing API is for Pages, not ordinary personal profiles.
- TikTok Content Posting API requires approved scopes and may require app review/audit; unaudited access can be restricted.
- Threads has its own OAuth scopes and publishing requirements.
- Do not promise automated publishing for every personal account. Validate eligibility during account connection and again before publishing.

## 10. Implementation status
This document defines the confirmed product rule. The current starter archive contains foundational authentication, database, S3-compatible storage helpers, BullMQ queue helpers, and retention cleanup logic. It is **not production complete**. Still required before real employee use:
- Complete upload endpoint with authentication, per-user ownership checks, file validation, malware scanning, and post-upload verification.
- Database migration for parent post plus four destination records and daily target reporting.
- Platform OAuth flows, token encryption/key management, refresh/revocation handling.
- Four platform-specific publishing adapters and webhook/status reconciliation.
- Worker process bootstrap, scheduled cleanup, monitoring, alerts, backups, and deployment hardening.
- Load, security, retry, duplicate-prevention, and retention tests.
