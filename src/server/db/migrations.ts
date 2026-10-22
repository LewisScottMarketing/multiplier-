import type { Db } from './database';

/**
 * Append-only list of migrations. `PRAGMA user_version` records how many have run.
 * Never edit a migration that has shipped; add a new one.
 */
const MIGRATIONS: string[] = [
  /* 1 — initial schema */ `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'owner',
    created_at    INTEGER NOT NULL,
    last_login_at INTEGER
  );

  CREATE TABLE sessions (
    id           TEXT PRIMARY KEY,                 -- sha256 of the cookie token
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    ip           TEXT,
    user_agent   TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE api_keys (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    key_hash     TEXT NOT NULL UNIQUE,
    prefix       TEXT NOT NULL,
    last4        TEXT NOT NULL,
    campaign_id  TEXT,                              -- optional: restrict the key to one campaign
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at   INTEGER
  );

  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE assets (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,                      -- pdf | image
    filename    TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    sha256      TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    meta        TEXT NOT NULL DEFAULT '{}',
    campaign_id TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX assets_campaign ON assets(campaign_id);

  CREATE TABLE campaigns (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    slug         TEXT NOT NULL UNIQUE,
    status       TEXT NOT NULL DEFAULT 'draft',     -- draft | live | archived
    page         TEXT NOT NULL,                     -- JSON: theme, seo, header, footer, blocks
    document     TEXT,                              -- JSON: source PDF + personalisation fields
    settings     TEXT NOT NULL,                     -- JSON: required fields, ai fields, ...
    source       TEXT,                              -- JSON: how it was created (pdf import report)
    version      INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    published_at INTEGER
  );

  CREATE TABLE prospects (
    id              TEXT PRIMARY KEY,
    campaign_id     TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    token           TEXT NOT NULL UNIQUE,
    external_id     TEXT,
    email           TEXT,
    linkedin_url    TEXT,
    first_name      TEXT,
    last_name       TEXT,
    company         TEXT,
    job_title       TEXT,
    data            TEXT NOT NULL DEFAULT '{}',     -- every other field Clay sends
    ai              TEXT NOT NULL DEFAULT '{}',     -- generated per-prospect copy
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    first_seen_at   INTEGER,
    last_seen_at    INTEGER,
    views           INTEGER NOT NULL DEFAULT 0,
    clicks          INTEGER NOT NULL DEFAULT 0,
    downloads       INTEGER NOT NULL DEFAULT 0,
    submissions     INTEGER NOT NULL DEFAULT 0,
    engaged_seconds INTEGER NOT NULL DEFAULT 0,
    score           INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX prospects_external ON prospects(campaign_id, external_id) WHERE external_id IS NOT NULL;
  CREATE UNIQUE INDEX prospects_email ON prospects(campaign_id, lower(email)) WHERE email IS NOT NULL;
  CREATE INDEX prospects_linkedin ON prospects(campaign_id, linkedin_url) WHERE linkedin_url IS NOT NULL;
  CREATE INDEX prospects_campaign ON prospects(campaign_id, created_at DESC);

  CREATE TABLE events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id TEXT NOT NULL,
    prospect_id TEXT,
    type        TEXT NOT NULL,                      -- hit | view | engaged | click | download | submit
    props       TEXT NOT NULL DEFAULT '{}',
    is_bot      INTEGER NOT NULL DEFAULT 0,
    session_id  TEXT,
    ip_hash     TEXT,
    ua          TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX events_prospect ON events(prospect_id, created_at);
  CREATE INDEX events_campaign ON events(campaign_id, created_at);

  CREATE TABLE submissions (
    id          TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    prospect_id TEXT,
    data        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX submissions_campaign ON submissions(campaign_id, created_at);

  CREATE TABLE webhooks (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL,                      -- clay | slack | generic
    url         TEXT NOT NULL,
    secret      TEXT,                               -- encrypted; signs generic payloads
    auth_header TEXT,                               -- header name (e.g. x-clay-webhook-auth)
    auth_value  TEXT,                               -- encrypted header value
    events      TEXT NOT NULL DEFAULT '[]',
    campaign_id TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE webhook_deliveries (
    id              TEXT PRIMARY KEY,
    webhook_id      TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event           TEXT NOT NULL,
    payload         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending', -- pending | delivered | failed
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    last_status     INTEGER,
    last_error      TEXT,
    created_at      INTEGER NOT NULL,
    delivered_at    INTEGER
  );
  CREATE INDEX deliveries_due ON webhook_deliveries(status, next_attempt_at);
  `,

  /* 2 — delivery rows remember whose data they carry, so erasing a person or a campaign erases the copies too */ `
  ALTER TABLE webhook_deliveries ADD COLUMN prospect_id TEXT;
  ALTER TABLE webhook_deliveries ADD COLUMN campaign_id TEXT;
  UPDATE webhook_deliveries SET
    prospect_id = COALESCE(json_extract(payload, '$.prospect_id'), json_extract(payload, '$.prospect.id')),
    campaign_id = COALESCE(json_extract(payload, '$.campaign_id'), json_extract(payload, '$.campaign.id'));
  CREATE INDEX deliveries_prospect ON webhook_deliveries(prospect_id);
  CREATE INDEX deliveries_campaign ON webhook_deliveries(campaign_id);
  CREATE INDEX deliveries_created ON webhook_deliveries(created_at);
  `,

  /* 3 — brand kits: a company's colours, typefaces, logo and voice, for pages and the AI to follow */ `
  CREATE TABLE brands (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    data       TEXT NOT NULL,                       -- JSON: the BrandKit
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
];

export function migrate(db: Db): void {
  const current = Number(db.get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0);
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
}
