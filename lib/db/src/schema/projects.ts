import { pgTable, text, integer, timestamp, jsonb, bigint, boolean, primaryKey, index } from "drizzle-orm/pg-core";
import { journeys } from "./tracelens";
export const projects = pgTable("tl_projects", {
  id: text("id").primaryKey(), publicId: text("public_id").notNull().unique(), owner: text("owner").notNull(),
  name: text("name").notNull(), url: text("url").notNull(), origins: jsonb("origins").notNull(),
  workflowName: text("workflow_name").notNull(), steps: jsonb("steps").notNull(),
  retentionDays: integer("retention_days").notNull().default(30), journeyId: text("journey_id").notNull().references(() => journeys.id),
  archivedAt: timestamp("archived_at", { withTimezone: true }), verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("tl_projects_owner_created").on(t.owner, t.createdAt)]);
export const recordingSessions = pgTable("tl_sessions", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id),
  runId: text("run_id"), tokenHash: text("token_hash").notNull().unique(), origin: text("origin").notNull(),
  purpose: text("purpose").notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("tl_sessions_project").on(t.projectId, t.expiresAt)]);
export const serverCredentials = pgTable("tl_credentials", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id),
  tokenHash: text("token_hash").notNull().unique(), name: text("name").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("tl_credentials_project").on(t.projectId)]);
export const rateLimits = pgTable("tl_rate_limits", {
  bucket: text("bucket").notNull(), window: bigint("window_id", { mode: "number" }).notNull(), count: integer("count").notNull().default(1),
}, t => [primaryKey({ columns: [t.bucket, t.window] })]);
export const sessionClients = pgTable("tl_session_clients", {
  id: text("id").notNull(), sessionId: text("session_id").notNull().references(() => recordingSessions.id),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  closed: boolean("closed").notNull().default(false),
}, t => [primaryKey({ columns: [t.id, t.sessionId] })]);
