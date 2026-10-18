-- Repairs JSON stored as a JSON string by double encoding.
UPDATE intents SET "public" = ("public" #>> '{}')::jsonb WHERE jsonb_typeof("public") = 'string';
UPDATE intents SET "private" = ("private" #>> '{}')::jsonb WHERE jsonb_typeof("private") = 'string';
UPDATE intents SET parsed = (parsed #>> '{}')::jsonb WHERE jsonb_typeof(parsed) = 'string';
UPDATE intent_versions SET "public" = ("public" #>> '{}')::jsonb WHERE jsonb_typeof("public") = 'string';
UPDATE intent_versions SET "private" = ("private" #>> '{}')::jsonb WHERE jsonb_typeof("private") = 'string';
UPDATE intent_versions SET parsed = (parsed #>> '{}')::jsonb WHERE jsonb_typeof(parsed) = 'string';
UPDATE notices SET edge = (edge #>> '{}')::jsonb WHERE jsonb_typeof(edge) = 'string';
UPDATE arrangements SET excluded = (excluded #>> '{}')::jsonb WHERE jsonb_typeof(excluded) = 'string';
UPDATE arrangements SET declared_net = (declared_net #>> '{}')::jsonb WHERE jsonb_typeof(declared_net) = 'string';
UPDATE arrangement_slots SET checklist = (checklist #>> '{}')::jsonb WHERE jsonb_typeof(checklist) = 'string';
UPDATE arrangement_links SET flows = (flows #>> '{}')::jsonb WHERE jsonb_typeof(flows) = 'string'
