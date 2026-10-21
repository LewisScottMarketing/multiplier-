# Using Multiplier with Clay

Multiplier plugs into Clay in two directions:

1. **Rows in, links out.** An HTTP API column asks Multiplier for each row's personalised page and PDF, and gets the links back.
2. **Engagement back.** Multiplier posts an event to a Clay table (or Slack, or your own endpoint) when a prospect opens their page, clicks, downloads the PDF or replies.

The Integrations screen in the dashboard has the same walkthrough with your real URL and key filled in. Clay's own reference for the column is the [HTTP API guide](https://university.clay.com/docs/http-api-integration-overview).

## Before you start

- A **published** campaign (Publish, top right). Links to an unpublished campaign say "not available".
- Decide what Clay must send. In **Campaign → Settings → What Clay has to send**, tick the fields a row can't go without (typically first name and company). Rows missing one get a clear error in the Clay cell instead of a link, so nobody receives a page that says "Hi ,".

## 1. Create an API key

**Integrations → Create API key.** Give it a name and, if you're sharing it with an agency or contractor, limit it to one campaign. The key (`mpl_live_…`) is shown once; only a fingerprint is stored. Lost it? Create a new one and revoke the old.

## 2. Add the HTTP API column

In your Clay table: **Add enrichment → HTTP API → Configure.**

| Clay setting | Value |
|---|---|
| **HTTP method** | `POST` |
| **Endpoint URL** | `https://<your-app>/api/v1/personalize` |
| **Select header account → + Add account** | one header under **API Request Headers**: `Authorization` = `Bearer mpl_live_…`. Saving it as an account keeps the key out of the column. Clay sets `Content-Type` itself. |
| **Body** | the JSON below |
| **Field paths to return** | `url` (add more columns for `pdf_url`, `cover_url`, `headline`…) |
| **Rate limiting** | 10 requests per 1000 ms is a good start (see [Rate limits](#rate-limits-and-concurrency)) |

Body (type `/` inside each pair of quotes and pick the column; keep the quotes):

```json
{
  "campaign": "outbound-playbook-q4",
  "first_name": "/First Name",
  "last_name": "/Last Name",
  "email": "/Work Email",
  "company": "/Company Name",
  "job_title": "/Job Title",
  "linkedin_url": "/LinkedIn Profile"
}
```

- `campaign` is the campaign's **URL name** (slug) or its **ID** (`cmp_…`), both shown in Campaign → Settings. If you have exactly one live campaign you can leave it out. A key limited to one campaign doesn't need it either.
- Send what you have. Every extra field becomes a merge field named after the column (`"industry": "/Industry"` → `{{industry}}`), and keys are forgiving about case and spaces.
- Optional: turn on Clay's **Remove empty fields**. (Multiplier ignores blanks anyway.)
- Add a **conditional run** formula such as "Work Email is not empty", so Clay doesn't call the API for rows it has nothing to say about.
- Click **Test** on one row before running the table.

### What comes back

```json
{
  "ok": true,
  "status": "created",
  "id": "prs_8d3kq2x0t1",
  "url": "https://go.yourbrand.com/p/k3x9Qm2aWdPz",
  "pdf_url": "https://go.yourbrand.com/p/k3x9Qm2aWdPz.pdf",
  "cover_url": "https://go.yourbrand.com/p/k3x9Qm2aWdPz/cover.png",
  "headline": "The 2026 Outbound Pipeline Playbook",
  "first_name": "Jane",
  "seniority": "vp",
  "department": "marketing",
  "campaign": { "id": "cmp_…", "name": "Outbound Playbook — Q4", "slug": "outbound-playbook-q4", "status": "live" },
  "warnings": []
}
```

| Path | Use it for |
|---|---|
| `url` | The personalised landing page link. This is the one for your email. |
| `pdf_url` | A link to their personalised PDF (campaigns with a PDF). |
| `cover_url` | A PNG of page 1 of their PDF. Embed it in the email, linked to `url`, for a preview that already has their name on it. |
| `headline` | The headline they'll see, handy in a subject line or opener. |
| `seniority`, `department` | What Multiplier understood from the job title. Useful for routing and for checking its reading of titles. |
| `status` | `created`, `updated` or `unchanged`. |
| `warnings` | Anything to double-check, as a list of `{ code, message, field? }`. See below. |

## 3. Use the link

Insert the `url` column wherever the link goes in your email or LinkedIn step. If the campaign has a PDF, either link `pdf_url` ("here's your copy") or let people reach it from the page's download button (that's tracked as a download too).

Re-running a row is safe: Multiplier recognises the person by `external_id`, then email, then LinkedIn URL, and returns the **same link** with `status: unchanged` (or `updated` if their data changed, in which case their PDF is rebuilt on the next request). It never creates a duplicate.

## Optional: AI-written lines

With AI on and an **AI field** set up (Campaign → Settings → AI-written fields), the API writes it as part of the same call and `{{ai_opening}}` is ready on the page. The call takes a second or two longer the first time for each person and is free to repeat afterwards. To supply your own copy instead (say, from a Clay AI column), send it as `"ai_opening": "/My Opening Line"`: copy sent from Clay always wins. Pass `"options": { "ai": false }` to skip AI for a request.

If AI is off, slow, or declines, the page uses the field's fallback text and `warnings` says so (`ai_unavailable`, `ai_failed`, `ai_declined`, `ai_empty`). The link is always issued.

## Errors and warnings

Errors arrive as `{ "error": { "code", "message" } }` with the matching HTTP status. Clay shows the message in the cell.

| Status | `code` | Meaning |
|---|---|---|
| `401` | `unauthorized` | Missing, wrong or revoked key. Send `Authorization: Bearer mpl_live_…`. |
| `403` | `forbidden` | This key is limited to a different campaign. |
| `404` | `campaign_not_found` | No campaign with that ID or URL name. |
| `422` | `missing_required_fields` | A field you marked as required is empty for this row. No link is issued. Fix the data or relax the setting. |
| `422` | `unprocessable` | Ambiguous campaign (several are live and none was named), or an invalid value. |
| `429` | `rate_limited` | Slow down; `Retry-After` says for how long. |

Warnings don't stop a link being issued:

| `code` | Meaning |
|---|---|
| `missing_field` | A merge field is empty for this person and has no fallback, so part of the page will be blank. `field` names it. Add a fallback like `{{first_name\|there}}`. |
| `campaign_not_live` | The campaign is a draft; the link won't open for the prospect until you publish. |
| `ai_*` | See above. |

## Rate limits and concurrency

- Each key is limited to **600 requests a minute**. Over that you get `429` with `Retry-After`; Clay's **Rate limiting** setting (10 per 1000 ms is under the limit) avoids ever seeing it. Rows that hit AI copy are slower, so lower the rate if cells time out.
- Invalid-key attempts are throttled per IP.
- Scripts and other tools can use `POST /api/v1/personalize/batch` with up to 500 `rows` per request. Rows are processed a few at a time and each succeeds or fails on its own. Once a request has used 60 seconds on AI copy, remaining rows still get links, with fallback text and an `ai_skipped` warning.

## Sending engagement back to Clay

Engagement is **pushed** to you, so Clay can react while the prospect is still on the page.

### Into a Clay table

1. In Clay, create a table with a **webhook** source (a table that imports data from a webhook). Copy its URL. If Clay shows an auth token for the webhook, copy that too.
2. In Multiplier: **Integrations → Add destination → Clay table.** Paste the URL, add the auth header name and token if Clay gave you them, choose which events to send (and optionally one campaign), then **Add destination**.
3. Use **Test** on the destination: it sends a sample event built from a real prospect, so Clay learns the columns. Delivery results are in the destination's **Recent deliveries**.

Each event is one row:

```json
{
  "event": "page.first_viewed",
  "occurred_at": "2026-10-21T09:14:03.000Z",
  "campaign_id": "cmp_…", "campaign_name": "Outbound Playbook — Q4",
  "prospect_id": "prs_…", "external_id": "clay_1021",
  "email": "jane@northwind.com", "first_name": "Jane", "last_name": "Doe",
  "company": "Northwind Traders", "job_title": "VP of Marketing",
  "page_url": "https://go.yourbrand.com/p/k3x9Qm2aWdPz", "pdf_url": "https://go.yourbrand.com/p/k3x9Qm2aWdPz.pdf",
  "stage": "opened", "views": 1, "clicks": 0, "downloads": 0, "submissions": 0,
  "engaged_seconds": 0, "score": 10, "seniority": "vp", "department": "marketing"
}
```

Click events add `label`, `block`, `slot` and `host` (where the link goes); form submissions add `form_<field>` for each answer. Keys are flat so each one maps straight to a Clay column.

| Event | When |
|---|---|
| `prospect.created` | A row was sent through the API or imported (off by default). |
| `page.first_viewed` | They opened their page for the first time. |
| `page.viewed` | Each later visit (can be chatty; off by default). |
| `link.clicked` | A button or link on the page was clicked. |
| `pdf.downloaded` | Their PDF was opened or downloaded. |
| `form.submitted` | They filled in the form. |
| `meeting.booked` | They booked time through the calendar block (Calendly). |

Only real people trigger events: link scanners, security gateways and previews are filtered out, so a `page.first_viewed` isn't an email security tool.

Deliveries are queued and sent within a few seconds. If your endpoint is down or returns an error, they're retried after 1 minute, 5 minutes, 30 minutes, 2 hours and 6 hours, then marked failed.

### Slack and your own endpoint

- **Slack:** paste an incoming-webhook URL. Messages read like “👀 Jane Doe (Northwind Traders) just opened your page ‘Outbound Playbook — Q4’”, with a link to their page.
- **Your own endpoint:** a JSON envelope `{ id, event, created_at, campaign, prospect, data }`, signed. Each request carries `x-multiplier-event`, `x-multiplier-delivery`, `x-multiplier-timestamp` and `x-multiplier-signature: sha256=<hex>`, where the signature is `HMAC-SHA256(secret, "<timestamp>.<raw body>")`. The secret is shown once when you create the destination. Verify the signature and reject stale timestamps.

### Workflows that work well

- **Hot-lead alert.** In the engagement table, filter `event is page.first_viewed` and `seniority is vp or c_level` (or `score` above 25), and send a Slack message or assign the row to a rep.
- **Stop the sequence on a reply.** On `form.submitted` or `meeting.booked`, flag the person in your sequencer so follow-ups stop.
- **Follow up on the PDF.** When `pdf.downloaded` arrives, trigger a different next step than for people who only opened the page.
- **Look up instead of listening.** Add a second HTTP API column that calls `GET /api/v1/prospects?email=/Work Email&campaign=…` to pull `engagement.stage`, `views` and `last_seen_at` for the row on demand.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Clay cell shows `401` | The header isn't `Authorization: Bearer mpl_live_…`, or the key was revoked. |
| `404 campaign_not_found` | Use the URL name or ID from Campaign → Settings. |
| `422 missing_required_fields` | The row lacks a field marked as required; the error names it. |
| Link opens "not available" | The campaign is a draft. Publish it. |
| Page says "Hi ," | A merge field is empty and has no fallback. The API's `warnings` tells you which; use `{{first_name\|there}}`. |
| Same person got two links | They were sent with different identifiers (no email, `external_id` or LinkedIn URL in common). Send a stable `external_id` such as Clay's row ID. |
| Webhook test fails | The destination must be reachable from the internet over https. Check **Recent deliveries** for the status code. |
| No events arrive | Check the destination is switched on, the campaign filter, and that the prospect opened the page in a normal browser (not a scanner). |
