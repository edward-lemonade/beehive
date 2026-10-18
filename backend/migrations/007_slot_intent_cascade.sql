ALTER TABLE arrangement_slots DROP CONSTRAINT IF EXISTS arrangement_slots_intent_id_fkey;
ALTER TABLE arrangement_slots ADD CONSTRAINT arrangement_slots_intent_id_fkey
  FOREIGN KEY (intent_id) REFERENCES intents(id) ON DELETE CASCADE;
