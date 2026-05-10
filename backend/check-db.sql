SELECT id, phone_number, name, created_at FROM users ORDER BY created_at DESC LIMIT 15;

SELECT u.phone_number, u.name,
  (SELECT COUNT(*) FROM personas p WHERE p.user_id = u.id) AS personas,
  (SELECT COUNT(*) FROM thoughts t WHERE t.user_id = u.id) AS thoughts,
  (SELECT COUNT(*) FROM relationship_persons r WHERE r.user_id = u.id) AS relations
FROM users u ORDER BY u.created_at DESC LIMIT 10;
