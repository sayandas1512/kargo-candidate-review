import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  customType,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const roleEnum = pgEnum("role", ["PM", "SPM"]);

export const candidateStatusEnum = pgEnum("candidate_status", [
  "uploaded",
  "extracted",
  "scored",
  "ready",
  "needs_identity_check",
  "needs_manual_review",
  "failed",
]);

export const draftKindEnum = pgEnum("draft_kind", ["invite", "rejection"]);

export const draftSourceEnum = pgEnum("draft_source", [
  "gemini",
  "fallback_template",
  "edited",
]);

export const draftStatusEnum = pgEnum("draft_status", [
  "draft",
  "sending",
  "sent",
  "failed",
  "blocked",
]);

export const decisionEnum = pgEnum("decision", ["advance", "hold", "decline"]);

export const emailModeEnum = pgEnum("email_mode", ["test", "live"]);

// The neon-http driver returns bytea over the wire as a Postgres hex-escape
// string ("\x48656c6c6f"), not a raw Buffer, so this type converts both ways.
const bytea = customType<{ data: Buffer; driverData: string }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Buffer): string {
    return "\\x" + value.toString("hex");
  },
  fromDriver(value: string): Buffer {
    if (value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
    return Buffer.from(value, "hex");
  },
});

export const rubrics = pgTable(
  "rubrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    role: roleEnum("role").notNull(),
    version: integer("version").notNull(),
    criteria: jsonb("criteria").notNull(),
    source: text("source").notNull().default("rubric.txt"),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("rubrics_role_version_idx").on(t.role, t.version)],
);

export const candidates = pgTable(
  "candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appliedRole: roleEnum("applied_role").notNull(),
    status: candidateStatusEnum("status").notNull().default("uploaded"),
    fileHash: text("file_hash").notNull(),
    cvTextRedacted: text("cv_text_redacted"),
    cvContent: jsonb("cv_content"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),
    isCalibration: boolean("is_calibration").notNull().default(false),
  },
  (t) => [uniqueIndex("candidates_file_hash_idx").on(t.fileHash)],
);

export const candidateFiles = pgTable("candidate_files", {
  candidateId: uuid("candidate_id")
    .primaryKey()
    .references(() => candidates.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  bytes: bytea("bytes").notNull(),
});

export const candidatePersonalDetails = pgTable("candidate_personal_details", {
  candidateId: uuid("candidate_id")
    .primaryKey()
    .references(() => candidates.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  links: jsonb("links").notNull().default([]),
  originalFilename: text("original_filename").notNull(),
});

export const scores = pgTable(
  "scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    rubricVersion: integer("rubric_version").notNull(),
    model: text("model").notNull(),
    criteria: jsonb("criteria").notNull(),
    weightedTotal: numeric("weighted_total", { precision: 5, scale: 1 }).notNull(),
    flags: jsonb("flags").notNull().default([]),
    lowConfidence: boolean("low_confidence").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("scores_candidate_role_version_idx").on(t.candidateId, t.role, t.rubricVersion),
    check("scores_weighted_total_range", sql`${t.weightedTotal} >= 0 AND ${t.weightedTotal} <= 100`),
    check("scores_criteria_valid", sql`jsonb_scores_valid(${t.criteria})`),
  ],
);

export const briefs = pgTable("briefs", {
  candidateId: uuid("candidate_id")
    .primaryKey()
    .references(() => candidates.id, { onDelete: "cascade" }),
  who: text("who").notNull(),
  why: text("why").notNull(),
  probe: text("probe").notNull(),
  probes: jsonb("probes").notNull().default([]),
  model: text("model").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailDrafts = pgTable(
  "email_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    kind: draftKindEnum("kind").notNull(),
    subject: text("subject").notNull(),
    bodyTemplate: text("body_template").notNull(),
    source: draftSourceEnum("source").notNull(),
    status: draftStatusEnum("status").notNull().default("draft"),
    resendId: text("resend_id"),
    sentTo: text("sent_to"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    mode: emailModeEnum("mode"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("email_drafts_sent_once_idx")
      .on(t.candidateId, t.kind)
      .where(sql`${t.status} = 'sent'`),
  ],
);

export const decisions = pgTable("decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id")
    .notNull()
    .references(() => candidates.id, { onDelete: "cascade" }),
  decision: decisionEnum("decision").notNull(),
  reason: text("reason"),
  decidedBy: text("decided_by").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  event: text("event").notNull(),
  candidateId: uuid("candidate_id").references(() => candidates.id, { onDelete: "cascade" }),
  actor: text("actor").notNull(),
  meta: jsonb("meta").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});
