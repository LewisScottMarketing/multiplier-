# Security

Multiplier handles personal data about people who didn't sign up for it (prospect lists) and sends strangers links to pages built from it. It is designed on the assumption that prospect data, uploaded files and anything that arrives over the public internet are hostile.

## Reporting a vulnerability

Please don't open a public issue for a security problem. Email the maintainers (or use the repository's private vulnerability reporting, if enabled) with what you found, how to reproduce it and the impact. You'll get an acknowledgement and a fix or a plan; please allow time to release a fix before disclosing.

## Protections at a glance

| Area | What's in place |
|---|---|
| Injection into pages | Merge values are HTML-escaped at render; the author's markup is parsed before data is merged; custom HTML is merged then sanitised; URLs use a scheme allow-list that also refuses `//host` and `/\host`; CSS values are validated by strict patterns; merge fields read only the prospect's own data (`{{constructor}}` is just an empty field) |
| Public pages | Per-response CSP nonce (`script-src 'nonce-…'`), `frame-ancestors 'none'`, `noindex`, no cookies, unguessable 12-character tokens (about 69 bits), failed lookups throttled per IP, per-token rate limits, tiny request bodies |
| Dashboard | Strict CSP (`script-src 'self'`: no inline script and no `eval`; `connect-src`, `frame-src` and `form-action` limited to the app itself), `frame-ancestors 'self'`, `Strict-Transport-Security` once `APP_URL` is https |
| Dashboard auth | scrypt password hashes; server-side sessions stored as hashes in an `HttpOnly`, `SameSite=Lax` (`Secure` on https) cookie; same-origin checks on state-changing requests; login throttling per IP and per account; other sessions are ended on password change |
| Host separation | The dashboard and APIs answer only on `APP_URL`'s host. Link domains serve personalised pages and nothing else. `X-Forwarded-Host` is only believed when `TRUST_PROXY` says a proxy set it |
| API keys | Stored as SHA-256 hashes, shown once, revocable, optionally limited to one campaign; failed attempts are throttled |
| Secrets at rest | Webhook signing secrets and auth header values are encrypted (AES-GCM) with a key derived from `APP_SECRET` |
| Outbound requests | Webhooks, logo images and brand websites go through an SSRF-safe client: private, loopback and link-local addresses refused (checked after DNS resolution and on each redirect), https required in production, size limits, an idle timeout and a hard overall deadline |
| Uploads and PDFs | Type checked by content and size limited. Image dimensions are read from the file header and capped at 40 megapixels *before* decoding, so a tiny file can't ask for gigabytes; images are re-encoded (metadata stripped). PDFs are processed two at a time through a bounded queue (a busy server answers 503 rather than piling up), time-boxed, page-capped, with oversized pages drawn at a reduced scale and embedded images over 40 megapixels skipped |
| Public PDFs and covers built from URL parameters | Rate limited per IP; results are held in a small in-memory cache and never written to disk |
| Targeting rules | `matches pattern` rules run under a short watchdog. A pattern that backtracks catastrophically is treated as "no match", logged, and ignored until restart, instead of freezing the server |
| Outbound messages | Slack text is escaped, so a prospect named `<!channel>` can't ping a channel or plant a link; custom auth header names can't override headers that frame the request |
| Data exports | CSV cells that could run as spreadsheet formulas are neutralised |
| Tracking | No cookies; IPs stored only as a salted daily hash; scanners, `HEAD` probes and headless browsers ignored |
| Logs | Prospect tokens are truncated in logged paths; request bodies are not logged; errors are logged with their message and stack |
| AI | Optional. Contact details never leave the server; prospect data is escaped, delimited and treated as untrusted; replies are stripped of markup, links and merge tokens |

## Deployment checklist

- **Finish first-run setup straight away.** The first person to open a fresh instance creates the owner account. Either complete setup yourself right after starting it, or set `ADMIN_EMAIL` and `ADMIN_PASSWORD` so the account exists from the first start.
- Set a strong `APP_SECRET` (or let it be generated and **back up `DATA_DIR`**, which holds the key, the database with your prospect data, and generated PDFs).
- Serve over HTTPS and set `APP_URL`/`PUBLIC_URL` to https URLs so cookies are `Secure` and HSTS is sent.
- Put the app behind a reverse proxy only with `TRUST_PROXY` set to the number of proxies, so client IPs (used for rate limits) and the forwarded host can't be forged by visitors.
- Use a separate domain for personalised links (`PUBLIC_URL`) from the dashboard (`APP_URL`).
- Leave `ALLOW_PRIVATE_FETCH` off.
- Keep Node and dependencies up to date (`npm audit`); pin the Node version (`node:sqlite` is still experimental).

## Things to know

- **A personalised link is a password for that page.** Anyone who has it can open it, forward it and download the PDF. Don't put anything in personalised content that you wouldn't be willing to have forwarded.
- **Editing a PDF paints over the original text; it doesn't remove it.** The replaced text is still in the file underneath, so don't use personalisation to hide anything confidential.
- **What you author is trusted.** Custom CSS, custom HTML (sanitised, but yours), and the workspace's tracking scripts run on every public page and can see everything on it. Only paste scripts you trust.
- **A button whose link is just a merge field goes wherever that field says.** `{{website}}` as a button link is how you send each person to their own destination, and it means the destination is whatever your data (Clay, a CSV) holds. Links are still limited to http(s), mailto and tel, but only map fields you trust to links.
- **One owner account.** There are no roles: anyone with the password has full access.
- **Rate limits are per IP, in memory and per process.** They stop casual abuse, not a distributed flood; put a CDN or WAF in front of the links domain if you expect hostile traffic.

## What Multiplier does not do

It does not send email, so consent, opt-out and data-protection obligations for outreach (GDPR, PECR, CAN-SPAM and local equivalents) stay with whoever runs it. Prospect records can be deleted from the dashboard, which also removes their activity, generated PDFs and any webhook payloads still queued or logged for them; deleting a campaign removes its pages, PDFs, prospects, activity and logs. Delivery logs are pruned automatically (14 days after delivery, 30 days for ones that never got through). Copies already delivered to Clay, Slack or your own endpoints live there, and have to be removed there.
