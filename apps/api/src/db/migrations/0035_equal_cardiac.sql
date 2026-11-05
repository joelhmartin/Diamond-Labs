CREATE TABLE "message_participants" (
	"thread_id" varchar(128) NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"side" varchar(10) NOT NULL,
	"last_read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_participants_thread_id_user_id_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"record_type" varchar(40),
	"record_id" varchar(128),
	"party_key" varchar(160) NOT NULL,
	"subject" text,
	"created_by_user_id" varchar(128) NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"last_message_side" varchar(10) NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"thread_id" varchar(128) NOT NULL,
	"author_user_id" varchar(128) NOT NULL,
	"author_side" varchar(10) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "message_threads_party_last_idx" ON "message_threads" USING btree ("party_key","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "message_threads_record_idx" ON "message_threads" USING btree ("record_type","record_id");--> statement-breakpoint
CREATE INDEX "message_threads_completed_last_idx" ON "message_threads" USING btree ("completed_at","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_thread_created_idx" ON "messages" USING btree ("thread_id","created_at");