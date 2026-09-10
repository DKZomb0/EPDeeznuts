-- ============================================================================
-- EPDeeznuts - milieudeclaratieplatform voor de betonsector
--
-- This file is the single source of truth for the schema. migrate.js
-- translates it for Postgres (REAL -> DOUBLE PRECISION, AUTOINCREMENT ->
-- BIGSERIAL); keep the DDL to the portable subset both dialects share.
--
-- Design notes the rest of the code depends on:
--
--  * Everything a verifier could ever be asked about is effective-dated.
--    Materials and recipes are never edited in place: a change closes the
--    running version and opens a new one. A verification that happens today
--    can therefore still reconstruct exactly which numbers were in force at
--    the moment of a delivery six weeks ago.
--
--  * Numeric environmental data is stored long/sparse (one row per
--    version x module x indicator) rather than as 15 columns. The indicator
--    set changes with every revision of EN 15804; columns would not survive it.
--
--  * No column has a SQL-side timestamp default. Every timestamp is an ISO
--    8601 string produced in JavaScript, so SQLite and Postgres store the
--    identical format - the effective-date logic compares these as strings and
--    a mixed format would break it silently.
--
--  * audit_log is append-only. Nothing in the application updates or deletes
--    from it.
-- ============================================================================

-- ---------------------------------------------------------------- settings --
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);

-- ----------------------------------------------------------- organisations --
CREATE TABLE IF NOT EXISTS organisations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  vat         TEXT,
  city        TEXT,
  country     TEXT NOT NULL DEFAULT 'BE',
  website     TEXT,
  -- A "listed" supplier appears in the producer-facing catalogue with its name
  -- and product categories only; the numbers stay hidden until an access
  -- request is granted.
  listed      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organisations(id),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'EDITOR',
  password_hash TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS sites (
  id       TEXT PRIMARY KEY,
  org_id   TEXT NOT NULL REFERENCES organisations(id),
  name     TEXT NOT NULL,
  address  TEXT,
  city     TEXT,
  country  TEXT NOT NULL DEFAULT 'BE',
  lat      REAL,
  lon      REAL,
  note     TEXT,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sites_org ON sites(org_id);

-- ------------------------------------------------------------ master data --
-- Owned by the federation / platform, versioned by valid_from so an old
-- calculation keeps referring to the factor that applied when it ran.

CREATE TABLE IF NOT EXISTS transport_profiles (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  mode         TEXT NOT NULL,          -- ROAD | INLAND_SHIP | RAIL | MIXER
  unit         TEXT NOT NULL DEFAULT 'tkm',
  payload_t    REAL,
  empty_return INTEGER NOT NULL DEFAULT 1,
  source       TEXT NOT NULL,
  valid_from   TEXT NOT NULL,
  note         TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_code ON transport_profiles(code, valid_from);

CREATE TABLE IF NOT EXISTS transport_profile_values (
  profile_id TEXT NOT NULL REFERENCES transport_profiles(id) ON DELETE CASCADE,
  indicator  TEXT NOT NULL,
  value      REAL NOT NULL,
  PRIMARY KEY (profile_id, indicator)
);

CREATE TABLE IF NOT EXISTS energy_factors (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  unit       TEXT NOT NULL,
  source     TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  note       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_energy_code ON energy_factors(code, valid_from);

CREATE TABLE IF NOT EXISTS energy_factor_values (
  factor_id TEXT NOT NULL REFERENCES energy_factors(id) ON DELETE CASCADE,
  indicator TEXT NOT NULL,
  value     REAL NOT NULL,
  PRIMARY KEY (factor_id, indicator)
);

CREATE TABLE IF NOT EXISTS process_defaults (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  value      REAL NOT NULL,
  unit       TEXT NOT NULL,
  source     TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  note       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_procdef_code ON process_defaults(code, valid_from);

-- Which life cycle modules European product rules make mandatory per material
-- category. Cement declares A1-A3 only: its A4/A5 is the concrete plant's A2,
-- and declaring it per delivery would be absurd.
CREATE TABLE IF NOT EXISTS category_rules (
  category         TEXT PRIMARY KEY,
  required_modules TEXT NOT NULL,
  optional_modules TEXT NOT NULL DEFAULT '',
  source           TEXT NOT NULL,
  note             TEXT
);

CREATE TABLE IF NOT EXISTS strength_classes (
  code     TEXT PRIMARY KEY,
  family   TEXT NOT NULL,
  fck_cyl  REAL,
  fck_cube REAL,
  sort     INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------- evidence ----
CREATE TABLE IF NOT EXISTS evidence (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organisations(id),
  type          TEXT NOT NULL,        -- BEPD | EPD_INTL | SECTOR_GENERIC | SELF_DECLARED
  number        TEXT,
  programme     TEXT,
  issuer        TEXT,
  valid_from    TEXT,
  valid_until   TEXT,
  document_url  TEXT,
  scope_modules TEXT NOT NULL DEFAULT 'A1,A2,A3',
  note          TEXT,
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_org ON evidence(org_id);

-- ------------------------------------------------------------- materials ---
CREATE TABLE IF NOT EXISTS materials (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organisations(id),
  site_id       TEXT REFERENCES sites(id),
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,
  declared_unit TEXT NOT NULL DEFAULT 'TONNE',
  density       REAL,
  description   TEXT,
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_materials_org ON materials(org_id);

CREATE TABLE IF NOT EXISTS material_versions (
  id             TEXT PRIMARY KEY,
  material_id    TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  version_no     INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'ACTIVE',
  effective_from TEXT NOT NULL,
  effective_to   TEXT,
  evidence_id    TEXT REFERENCES evidence(id),
  -- When true the supplier's declaration already contains the transport to the
  -- customer, so the platform must not add an A2 leg on top of it.
  includes_inbound_transport INTEGER NOT NULL DEFAULT 0,
  change_reason  TEXT,
  created_by     TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matver_material ON material_versions(material_id, effective_from);

CREATE TABLE IF NOT EXISTS material_version_values (
  version_id TEXT NOT NULL REFERENCES material_versions(id) ON DELETE CASCADE,
  module     TEXT NOT NULL,
  indicator  TEXT NOT NULL,
  value      REAL NOT NULL,
  PRIMARY KEY (version_id, module, indicator)
);

-- --------------------------------------------------------- data sharing ----
-- A cement producer does not want a competitor's customer reading its
-- declarations. Producers see the catalogue; the numbers need a grant.
CREATE TABLE IF NOT EXISTS access_requests (
  id               TEXT PRIMARY KEY,
  requester_org_id TEXT NOT NULL REFERENCES organisations(id),
  owner_org_id     TEXT NOT NULL REFERENCES organisations(id),
  material_id      TEXT REFERENCES materials(id),   -- NULL = all materials of the owner
  status           TEXT NOT NULL DEFAULT 'PENDING',
  reason           TEXT,
  decided_by       TEXT REFERENCES users(id),
  decided_at       TEXT,
  decision_note    TEXT,
  created_by       TEXT REFERENCES users(id),
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_owner ON access_requests(owner_org_id, status);
CREATE INDEX IF NOT EXISTS idx_access_requester ON access_requests(requester_org_id, status);

-- --------------------------------------------------------------- recipes ---
CREATE TABLE IF NOT EXISTS recipes (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL REFERENCES organisations(id),
  site_id          TEXT REFERENCES sites(id),
  code             TEXT NOT NULL,
  name             TEXT NOT NULL,
  strength_class   TEXT,
  exposure_classes TEXT,
  consistency      TEXT,
  dmax             REAL,
  density          REAL NOT NULL DEFAULT 2350,
  benor            INTEGER NOT NULL DEFAULT 0,
  archived         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recipes_org ON recipes(org_id);

CREATE TABLE IF NOT EXISTS recipe_versions (
  id                TEXT PRIMARY KEY,
  recipe_id         TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  version_no        INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'DRAFT',
  effective_from    TEXT NOT NULL,
  effective_to      TEXT,
  parent_version_id TEXT REFERENCES recipe_versions(id),
  change_reason     TEXT,
  created_by        TEXT REFERENCES users(id),
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recver_recipe ON recipe_versions(recipe_id, effective_from);

CREATE TABLE IF NOT EXISTS recipe_components (
  id                   TEXT PRIMARY KEY,
  recipe_version_id    TEXT NOT NULL REFERENCES recipe_versions(id) ON DELETE CASCADE,
  material_id          TEXT NOT NULL REFERENCES materials(id),
  -- Pinned so the dossier keeps pointing at the exact supplier declaration it
  -- was calculated with, even after the supplier publishes a new version.
  material_version_id  TEXT NOT NULL REFERENCES material_versions(id),
  quantity_kg          REAL NOT NULL,          -- per m3 of concrete
  transport_km         REAL NOT NULL DEFAULT 0,
  transport_profile_id TEXT REFERENCES transport_profiles(id),
  sort                 INTEGER NOT NULL DEFAULT 0,
  note                 TEXT
);
CREATE INDEX IF NOT EXISTS idx_comp_version ON recipe_components(recipe_version_id);

CREATE TABLE IF NOT EXISTS recipe_parameters (
  id                TEXT PRIMARY KEY,
  recipe_version_id TEXT NOT NULL REFERENCES recipe_versions(id) ON DELETE CASCADE,
  code              TEXT NOT NULL,
  value             REAL NOT NULL,
  unit              TEXT NOT NULL,
  -- SECTOR_DEFAULT when inherited, MEASURED when the producer overrode it.
  source            TEXT NOT NULL DEFAULT 'SECTOR_DEFAULT',
  overridden        INTEGER NOT NULL DEFAULT 0,
  justification     TEXT,
  attachment_url    TEXT,
  UNIQUE (recipe_version_id, code)
);

-- ---------------------------------------------------------- declarations ---
CREATE TABLE IF NOT EXISTS declarations (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organisations(id),
  recipe_version_id TEXT NOT NULL REFERENCES recipe_versions(id),
  scope             TEXT NOT NULL DEFAULT 'A1-A3',
  status            TEXT NOT NULL DEFAULT 'DRAFT',
  verdict           TEXT,
  verifier_org_id   TEXT REFERENCES organisations(id),
  certificate_no    TEXT,
  -- Snapshot of the full calculation at submission: what the verifier signs
  -- off on must never silently change because master data moved afterwards.
  result_json       TEXT,
  submitted_at      TEXT,
  submitted_by      TEXT REFERENCES users(id),
  verified_at       TEXT,
  verified_by       TEXT REFERENCES users(id),
  valid_until       TEXT,
  decision_note     TEXT,
  -- Set when the change-control rules let this version inherit the previous
  -- verification instead of going through the verifier again.
  bypass_of         TEXT REFERENCES declarations(id),
  bypass_deviation  REAL,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decl_org ON declarations(org_id, status);
CREATE INDEX IF NOT EXISTS idx_decl_version ON declarations(recipe_version_id);

-- ----------------------------------------------- projects & deliveries -----
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organisations(id),
  name       TEXT NOT NULL,
  reference  TEXT,
  address    TEXT,
  city       TEXT,
  architect  TEXT,
  note       TEXT,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Who carries which module on this project. Only the responsible organisation
-- may fill in that module's parameters, and the audit log records who did.
CREATE TABLE IF NOT EXISTS project_responsibilities (
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module      TEXT NOT NULL,
  org_id      TEXT NOT NULL REFERENCES organisations(id),
  assigned_by TEXT REFERENCES users(id),
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (project_id, module)
);

CREATE TABLE IF NOT EXISTS deliveries (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  recipe_version_id    TEXT NOT NULL REFERENCES recipe_versions(id),
  producer_org_id      TEXT NOT NULL REFERENCES organisations(id),
  contractor_org_id    TEXT NOT NULL REFERENCES organisations(id),
  delivery_note        TEXT,
  volume_m3            REAL NOT NULL,
  delivered_at         TEXT NOT NULL,
  distance_km          REAL NOT NULL DEFAULT 0,
  transport_profile_id TEXT REFERENCES transport_profiles(id),
  status               TEXT NOT NULL DEFAULT 'PLANNED',
  result_json          TEXT,
  created_by           TEXT REFERENCES users(id),
  created_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deliv_project ON deliveries(project_id);

CREATE TABLE IF NOT EXISTS delivery_parameters (
  id            TEXT PRIMARY KEY,
  delivery_id   TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  value         REAL NOT NULL,
  unit          TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'SECTOR_DEFAULT',
  overridden    INTEGER NOT NULL DEFAULT 0,
  justification TEXT,
  entered_by    TEXT REFERENCES users(id),
  entered_at    TEXT NOT NULL,
  UNIQUE (delivery_id, code)
);

-- ------------------------------------------------------------ gate checks --
-- The continuous go / no-go the sector wants instead of batch auditing.
CREATE TABLE IF NOT EXISTS gate_checks (
  id            TEXT PRIMARY KEY,
  subject_type  TEXT NOT NULL,          -- RECIPE_VERSION | DELIVERY
  subject_id    TEXT NOT NULL,
  decision      TEXT NOT NULL,          -- GO | GO_WITH_WARNING | NO_GO | MANUAL_OVERRIDE
  verdict       TEXT,
  deviation_pct REAL,
  threshold_pct REAL,
  reasons_json  TEXT,
  actor_user_id TEXT REFERENCES users(id),
  note          TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gate_subject ON gate_checks(subject_type, subject_id);

-- ------------------------------------------------------- sector averages ---
CREATE TABLE IF NOT EXISTS aggregations (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organisations(id),
  label          TEXT NOT NULL,
  strength_class TEXT,
  exposure_class TEXT,
  method         TEXT NOT NULL DEFAULT 'VOLUME_WEIGHTED',
  sample_size    INTEGER NOT NULL DEFAULT 0,
  payload_json   TEXT NOT NULL,
  published      INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL
);

-- ------------------------------------------------------------- audit log ---
CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL,
  actor_user_id TEXT,
  actor_org_id  TEXT,
  actor_label   TEXT,
  action        TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  summary       TEXT,
  detail_json   TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organisations(id),
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  seen       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_org ON notifications(org_id, seen);
