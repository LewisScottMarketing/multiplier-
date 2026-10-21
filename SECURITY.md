# Security

Multiplier handles personal data about people who didn't sign up for it (prospect lists) and sends strangers links to pages built from it. It is designed on the assumption that prospect data, uploaded files and anything that arrives over the public internet are hostile.

## Reporting a vulnerability

Please don't open a public issue for a security problem. Email the maintainers (or use the repository's private vulnerability reporting, if enabled) with what you found, how to reproduce it and the impact. You'll get an acknowledgement and a fix or a plan; please allow time to release a fix before disclosing.

## Protections at a glance

| Area | What's in place |
|---|---|
| Injection into pages | Merge values are HTML-escaped at render; the author's markup is parsed before data is merged; custom HTML is merged then sanitised; URLs use a scheme allow-list; CSS values are validated by strict patterns |
| Public pages | Per-response CSP nonce (`script-src 'nonce-…'`), `frame-ancestors 'none'`, `noindex`, no cookies, unguessable tokens, per-token and per-IP rate limits, tiny request bodies |
| Dashboard auth | scrypt password hashes; server-side sessions stored as hashes in an `HttpOnly`, `SameSite=Lax` (`Secure` on https) cookie; same-origin checks on state-changing requests; login throttling per IP and per account; other sessions are ended on password change |
| Host separation | The dashboard and APIs answer only on `APP_URL`'s host. Link domains serve personalised pages and nothing else |
| API keys | Stored as SHA-256 hashes, shown once, revocable, optionally limited to one campaign; failed attempts are throttled |
| Secrets at rest | Webhook signing secrets and auth header values are encrypted (AES-GCM) with a key derived from `APP_SECRET` |
| Outbound requests | Webhooks and logo images go through an SSRF-safe client: private, loopback and link-local addresses refused (checked after DNS resolution and on each redirect), https required in production, size and time limits |
| Uploads | Type checked by content, size limited, PDFs processed in gated, time-boxed jobs with a page cap; images re-encoded (metadata stripped) |
| Data exports | CSV cells that could run as spreadsheet formulas are neutralised |
| Tracking | No cookies; IPs stored only as a salted daily hash; scanners and headless browsers ignored |
| AI | Optional. Contact details never leave the server; prospect data is escaped, delimited and treated as untrusted; replies are stripped of markup, links and merge tokens |

## Deployment checklist

- Set a strong `APP_SECRET` (or let it be generated and **back up `DATA_DIR`**, which holds the key).
- Serve over HTTPS and set `APP_URL`/`PUBLIC_URL` to https URLs so cookies are `Secure`.
- Put the app behind a reverse proxy only with `TRUST_PROXY` set to the number of proxies, so client IPs (used for rate limits) can't be forged with `X-Forwarded-For`.
- Use a separate domain for personalised links (`PUBLIC_URL`) from the dashboard (`APP_URL`).
- Leave `ALLOW_PRIVATE_FETCH` off.
- Keep Node and dependencies up to date; pin the Node version (`node:sqlite` is still experimental).

## What Multiplier does not do

It does not send email, so consent, opt-out and data-protection obligations for outreach (GDPR, PECR, CAN-SPAM and local equivalents) stay with whoever runs it. Prospect records can be deleted from the dashboard; deleting a campaign removes its pages, PDFs, prospects and activity.
