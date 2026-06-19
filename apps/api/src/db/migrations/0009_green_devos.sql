CREATE TABLE "app_theme" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"tokens" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
