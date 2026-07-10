ALTER TABLE "rx_cases" ALTER COLUMN "payload_snapshot" SET DATA TYPE text USING "payload_snapshot"::text;
