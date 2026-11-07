import { pgTable, text, integer, timestamp, jsonb, bigserial, uniqueIndex, index } from "drizzle-orm/pg-core";

export const journeys = pgTable("tl_journeys", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  baselineId: text("baseline_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const runs = pgTable("tl_runs", {
  id: text("id").primaryKey(),
  journeyId: text("journey_id").notNull().references(() => journeys.id),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  variant: text("variant").notNull(),
  status: text("status").notNull().default("recording"),
  recorderError: text("recorder_error"),
  projectId: text("project_id"),
  expectedSteps: jsonb("expected_steps").notNull().default([]),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  dropped: integer("dropped").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, t => [index("tl_runs_project_created").on(t.projectId, t.createdAt), index("tl_runs_owner_created").on(t.owner, t.createdAt)]);
export const events = pgTable("tl_events", {
  sequence: bigserial("sequence", { mode: "number" }).primaryKey(),
  id: text("id").notNull(),
  runId: text("run_id").notNull().references(() => runs.id),
  source: text("source").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [uniqueIndex("tl_event_dedup").on(t.runId, t.id), index("tl_events_run_sequence").on(t.runId, t.sequence)]);
export const operations = pgTable("tl_operations", {
  runId: text("run_id").notNull().references(() => runs.id),
  step: text("step").notNull(),
  actionId: text("action_id").notNull(),
  attempts: integer("attempts").notNull(),
  status: integer("status").notNull(),
  result: jsonb("result").notNull(),
}, t => [uniqueIndex("tl_operation_dedup").on(t.runId, t.step)]);
