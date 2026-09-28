import { pgTable, text, integer, timestamp, jsonb, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  plan: text('plan').notNull().default('free'),
  stripeId: text('stripe_id'),
  aiCredits: integer('ai_credits').notNull().default(5),
  createdAt: timestamp('created_at').defaultNow(),
});

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  teamId: text('team_id'),
  name: text('name').notNull(),
  timeline: jsonb('timeline').notNull(),
  thumbUrl: text('thumb_url'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const assets = pgTable('assets', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  ownerId: text('owner_id').notNull(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  r2Key: text('r2_key').notNull(),
  proxyKey: text('proxy_key'),
  thumbKey: text('thumb_key'),
  duration: integer('duration').default(0),
  width: integer('width').default(0),
  height: integer('height').default(0),
  peaks: jsonb('peaks'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const renders = pgTable('renders', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  ownerId: text('owner_id').notNull(),
  res: text('res').notNull().default('720p'),
  fmt: text('fmt').notNull().default('webm'),
  status: text('status').notNull().default('queued'),
  progress: integer('progress').notNull().default(0),
  outKey: text('out_key'),
  size: integer('size').default(0),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const versions = pgTable('versions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  timeline: jsonb('timeline').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const teams = pgTable('teams', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  name: text('name').notNull(),
});

export const teamMembers = pgTable('team_members', {
  teamId: text('team_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role').notNull().default('editor'),
});

export const entitlements = pgTable('entitlements', {
  userId: text('user_id').primaryKey(),
  export4k: boolean('export_4k').notNull().default(false),
  premiumFx: boolean('premium_fx').notNull().default(false),
  aiCredits: integer('ai_credits').notNull().default(5),
});
