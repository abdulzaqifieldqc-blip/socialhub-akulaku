# SocialHub Stage 6 — Phase 1 change log

Tanggal pengerjaan: 2026-11-24

## Implemented in this working copy

- Queue dispatch uses `next_attempt_at` as a durable due-time plus a five-minute dispatch lease. Failed Queue sends are scheduled again instead of silently losing the due job.
- Destination processing uses a conditional atomic update (`status=queued` → `processing`) so only one consumer claims a destination at a time.
- Retry backoff is stored in `next_attempt_at`; cron dispatches due retries.
- Worker-generated signed media URLs use configured HTTPS `PUBLIC_ORIGIN`; request Host is no longer trusted as the public origin.
- Media retention is capped at 24 hours, cleanup runs every 15 minutes, and the media endpoint rejects assets older than 24 hours.
- Inactive employees are checked again in the queue worker; queued destinations are cancelled on employee deactivation.
- Token refresh is attempted before expiry when the adapter supports it; failed refresh marks the destination `needs_reconnect`.
- OAuth connect/callback require integration status exactly `enabled`.
- Admin cannot enable an integration without Client ID and configured Client Secret.
- Password recovery now has a reset page and authenticated password-update endpoint.
- JSON API bodies must be JSON objects; request size is measured in UTF-8 bytes.
- Supabase count requests now fail explicitly on HTTP errors.
- `.dev.vars` and local secret variants are ignored by Git.
- Migration 007 rollback file is now a non-destructive guard; it no longer drops tables or restores broad grants.
- Post creation compensates by deleting the parent post if destination insertion fails.
- README and backend documentation were updated for the active Cloudflare Worker/Supabase architecture.
- Added tests for concurrent queue claims, JSON object validation, and password reset endpoint.

## Verification

- `node --check` across `src/`, `public/`, and `test/`: passed.
- `node --test test/*.test.js`: 26 tests passed, 0 failed.
- `package.json` JSON parse: passed.

All tests use mocks. No live Supabase SQL, Cloudflare Queue/R2, OAuth, social provider publishing, or Android APK build was executed.

## Remaining before production

1. Set `PUBLIC_ORIGIN` in `wrangler.jsonc` to the real HTTPS Worker/custom-domain origin (remove `.invalid`).
2. Configure `.dev.vars` locally and Cloudflare Worker secrets in production.
3. Add `/reset-password.html` to Supabase Auth allowed redirect URLs.
4. Test migration 007 and its verification script against a restored database copy; do not run the migration on production without approval.
5. A full SQL transaction/RPC is still needed for atomic parent-post + destination creation. Current behavior is compensating cleanup, not a true database transaction.
6. Provider-side idempotency and reconciliation are required to handle the ambiguous case where a provider accepts a post but the Worker loses the response.
7. Validate refresh-token behavior against real developer apps and run end-to-end tests against real Cloudflare/Supabase services.
8. Publishing adapters remain intentionally unimplemented.
