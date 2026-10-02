-- Reference data: the fixed set of roles. Idempotent so it is safe to re-run.
INSERT INTO "roles" ("key", "name", "description") VALUES
  ('reader', 'Reader', 'Default role for every account.'),
  ('translator', 'Translator', 'Can review and edit translation segments and glossaries.'),
  ('editor', 'Editor', 'Can manage series, chapters and the processing queue.'),
  ('admin', 'Administrator', 'Full access, including users, payments and settings.')
ON CONFLICT ("key") DO NOTHING;
