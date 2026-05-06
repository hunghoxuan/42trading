# Security Auth Upgrade

## Goal
- Stop relying on `api_key` in request body/query.
- Use path/header auth.
- Keep migration backward-compatible.

## Auth Modes
- TradingView:
  - `POST /signal/:tv_webhook_token`
- EA/UI/scripts:
  - `x-api-key: <token>`
  - or `Authorization: Bearer <token>`

## Key Store
- Store token hash only.
- Support multiple active keys.
- Support revoke.
- Support rotation overlap.
- Track `last_used_at`.

## Migration
1. Add auth middleware and key metadata.
2. Keep legacy payload key temporarily.
3. Log legacy key usage without leaking values.
4. Update EA/scripts/UI clients.
5. Disable payload/query key acceptance.

## Acceptance
- TV works with URL token.
- EA works with header key.
- Missing/invalid/revoked key is denied.
- Multiple active keys per account work.
- Rotation overlap works.

## Later
- Local email/password dashboard auth first.
- SSO only after local auth is stable.

