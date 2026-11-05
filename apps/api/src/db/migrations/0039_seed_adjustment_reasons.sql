-- Custom migration (drizzle-kit generate --custom): the lab's starting remake/discount reasons.
-- Fixed literal ids and ON CONFLICT DO NOTHING keep it idempotent; when it is regenerated on a
-- rebase, recreate it with this same SQL (never drop it).
INSERT INTO "adjustment_reasons" ("id", "applies_to", "label", "discount_percent", "position") VALUES
	('reason_remake_lab_error', 'remake', 'Lab error', 100, 10),
	('reason_remake_change_of_occlusion', 'remake', 'Change of occlusion', 100, 20),
	('reason_remake_client_patient_error', 'remake', 'Client/patient error', 100, 30),
	('reason_discount_courtesy', 'discount', 'Courtesy', NULL, 40),
	('reason_discount_va_patient', 'discount', 'VA patient', NULL, 50),
	('reason_discount_model', 'discount', 'Model', NULL, 60),
	('reason_discount_family', 'discount', 'Family', NULL, 70),
	('reason_discount_employee', 'discount', 'Employee', NULL, 80),
	('reason_both_no_charge_for_remake', 'both', 'No charge for remake', 100, 90)
ON CONFLICT DO NOTHING;
