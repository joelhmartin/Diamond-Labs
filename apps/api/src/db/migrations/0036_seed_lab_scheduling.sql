-- Seed: the lab's business calendar and its eight turnaround workflows (piece 7, Scheduling).
-- Values come from the Labzona audit: 13 lead days, Saturday/Sunday closed, no
-- capacity limits, no holidays, eight named templates with editable default
-- stages. No product assignments, no rush links, no default workflow: staff set
-- those in Admin > Scheduling. Ids are fixed literals and every insert is
-- ON CONFLICT DO NOTHING, so a re-run never overwrites what staff have edited;
-- stages are only inserted for a seeded workflow that exists and has none yet.
INSERT INTO "calendars" ("key", "timezone", "lead_days", "closed_weekdays", "capacity_basis", "capacity_by_weekday")
VALUES ('default', 'America/Chicago', 13, '[0,6]'::jsonb, 'none', '{}'::jsonb)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "workflows" ("id", "key", "name", "total_days", "rush_workflow_key", "is_default", "active", "position")
VALUES
  ('seed-workflow-10d-2-device', '10d-2-device', '10-day 2-device PMT/Acrylic/Dual-Laminate', 10, NULL, false, true, 0),
  ('seed-workflow-10d-printed', '10d-printed', '10-day Printed', 10, NULL, false, true, 1),
  ('seed-workflow-10d-standard-rush', '10d-standard-rush', '10-day Standard Rush', 10, NULL, false, true, 2),
  ('seed-workflow-15d-printed', '15d-printed', '15-day Printed', 15, NULL, false, true, 3),
  ('seed-workflow-3d-max-rush', '3d-max-rush', '3-day Max Rush', 3, NULL, false, true, 4),
  ('seed-workflow-7d-1-device', '7d-1-device', '7-day 1-device', 7, NULL, false, true, 5),
  ('seed-workflow-7d-expedited', '7d-expedited', '7-day Expedited', 7, NULL, false, true, 6),
  ('seed-workflow-8d-printed-shipping', '8d-printed-shipping', '8-day Printed + Shipping', 8, NULL, false, true, 7)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "workflow_stages" ("id", "workflow_id", "position", "key", "label", "day_offset", "milestone")
SELECT v.id, v.workflow_id, v.position, v.key, v.label, v.day_offset, v.milestone
FROM (VALUES
  ('seed-stage-10d-2-device-check-in', 'seed-workflow-10d-2-device', 0, 'check-in', 'Check in', 0, 'received'),
  ('seed-stage-10d-2-device-production', 'seed-workflow-10d-2-device', 1, 'production', 'Production', 1, 'in_production'),
  ('seed-stage-10d-2-device-qc', 'seed-workflow-10d-2-device', 2, 'qc', 'Quality check', 8, 'quality_check'),
  ('seed-stage-10d-2-device-pack', 'seed-workflow-10d-2-device', 3, 'pack', 'Pack', 9, 'ready_to_ship'),
  ('seed-stage-10d-2-device-ship', 'seed-workflow-10d-2-device', 4, 'ship', 'Ship', 10, 'shipped'),
  ('seed-stage-10d-printed-check-in', 'seed-workflow-10d-printed', 0, 'check-in', 'Check in', 0, 'received'),
  ('seed-stage-10d-printed-production', 'seed-workflow-10d-printed', 1, 'production', 'Production', 1, 'in_production'),
  ('seed-stage-10d-printed-qc', 'seed-workflow-10d-printed', 2, 'qc', 'Quality check', 8, 'quality_check'),
  ('seed-stage-10d-printed-pack', 'seed-workflow-10d-printed', 3, 'pack', 'Pack', 9, 'ready_to_ship'),
  ('seed-stage-10d-printed-ship', 'seed-workflow-10d-printed', 4, 'ship', 'Ship', 10, 'shipped'),
  ('seed-stage-10d-standard-rush-check-in', 'seed-workflow-10d-standard-rush', 0, 'check-in', 'Check in', 0, 'received'),
  ('seed-stage-10d-standard-rush-production', 'seed-workflow-10d-standard-rush', 1, 'production', 'Production', 1, 'in_production'),
  ('seed-stage-10d-standard-rush-qc', 'seed-workflow-10d-standard-rush', 2, 'qc', 'Quality check', 8, 'quality_check'),
  ('seed-stage-10d-standard-rush-pack', 'seed-workflow-10d-standard-rush', 3, 'pack', 'Pack', 9, 'ready_to_ship'),
  ('seed-stage-10d-standard-rush-ship', 'seed-workflow-10d-standard-rush', 4, 'ship', 'Ship', 10, 'shipped'),
  ('seed-stage-15d-printed-check-in', 'seed-workflow-15d-printed', 0, 'check-in', 'Check in', 0, 'received'),
  ('seed-stage-15d-printed-production', 'seed-workflow-15d-printed', 1, 'production', 'Production', 1, 'in_production'),
  ('seed-stage-15d-printed-qc', 'seed-workflow-15d-printed', 2, 'qc', 'Quality check', 13, 'quality_check'),
  ('seed-stage-15d-printed-pack', 'seed-workflow-15d-printed', 3, 'pack', 'Pack', 14, 'ready_to_ship'),
  ('seed-stage-15d-printed-ship', 'seed-workflow-15d-printed', 4, 'ship', 'Ship', 15, 'shipped'),
  ('seed-stage-3d-max-rush-check-in', 'seed-workflow-3d-max-rush', 0, 'check-in', 'Check in', 0, 'received'),
  ('seed-stage-3d-max-rush-production', 'seed-workflow-3d-max-rush', 1, 'production', 'Production', 0, 'in_production'),
  ('seed-stage-3d-max-rush-qc', 'seed-workflow-3d-max-rush', 2, 'qc', 'Quality check', 1, 'quality_check'),
  ('seed-stage-3d-max-rush-pack', 'seed-workflow-3d-max-rush', 3, 'pack', 'Pack', 2, 'ready_to_ship'),
  ('seed-stage-3d-max-rush-ship', 'seed-workflow-3d-max-rush', 4, 'ship', 'Ship', 3, 'shipped'),
  ('seed-stage-7d-1-device-check-in', 'seed-workflow-7d-1-device', 0, 'check-in', 'Check in', 0, 'received'),
  ('seed-stage-7d-1-device-production', 'seed-workflow-7d-1-device', 1, 'production', 'Production', 1, 'in_production'),
  ('seed-stage-7d-1-device-qc', 'seed-workflow-7d-1-device', 2, 'qc', 'Quality check', 5, 'quality_check'),
  ('seed-stage-7d-1-device-pack', 'seed-workflow-7d-1-device', 3, 'pack', 'Pack', 6, 'ready_to_ship'),
  ('seed-stage-7d-1-device-ship', 'seed-workflow-7d-1-device', 4, 'ship', 'Ship', 7, 'shipped'),
  ('seed-stage-7d-expedited-check-in', 'seed-workflow-7d-expedited', 0, 'check-in', 'Check in', 0, 'received'),
  ('seed-stage-7d-expedited-production', 'seed-workflow-7d-expedited', 1, 'production', 'Production', 1, 'in_production'),
  ('seed-stage-7d-expedited-qc', 'seed-workflow-7d-expedited', 2, 'qc', 'Quality check', 5, 'quality_check'),
  ('seed-stage-7d-expedited-pack', 'seed-workflow-7d-expedited', 3, 'pack', 'Pack', 6, 'ready_to_ship'),
  ('seed-stage-7d-expedited-ship', 'seed-workflow-7d-expedited', 4, 'ship', 'Ship', 7, 'shipped'),
  ('seed-stage-8d-printed-shipping-check-in', 'seed-workflow-8d-printed-shipping', 0, 'check-in', 'Check in', 0, 'received'),
  ('seed-stage-8d-printed-shipping-production', 'seed-workflow-8d-printed-shipping', 1, 'production', 'Production', 1, 'in_production'),
  ('seed-stage-8d-printed-shipping-qc', 'seed-workflow-8d-printed-shipping', 2, 'qc', 'Quality check', 6, 'quality_check'),
  ('seed-stage-8d-printed-shipping-pack', 'seed-workflow-8d-printed-shipping', 3, 'pack', 'Pack', 7, 'ready_to_ship'),
  ('seed-stage-8d-printed-shipping-ship', 'seed-workflow-8d-printed-shipping', 4, 'ship', 'Ship', 8, 'shipped')
) AS v (id, workflow_id, position, key, label, day_offset, milestone)
WHERE EXISTS (SELECT 1 FROM "workflows" w WHERE w.id = v.workflow_id)
  AND NOT EXISTS (SELECT 1 FROM "workflow_stages" s WHERE s.workflow_id = v.workflow_id)
ON CONFLICT DO NOTHING;
