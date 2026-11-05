-- Sample data for the Gaming Cafe Management System.
-- Run after schema.sql. Inserts are safe to re-run for the named records.

INSERT INTO staff (name, role, shift)
SELECT 'Cafe Admin', 'admin', 'Morning'
WHERE NOT EXISTS (SELECT 1 FROM staff WHERE name = 'Cafe Admin');

INSERT INTO gaming_pcs (pc_name, status, hourly_rate)
VALUES
  ('Alienware-01', 'available', 120.00),
  ('Alienware-02', 'available', 120.00),
  ('ROG-01', 'available', 100.00),
  ('ROG-02', 'available', 100.00),
  ('Predator-01', 'available', 90.00),
  ('Predator-02', 'available', 90.00)
ON CONFLICT (pc_name) DO NOTHING;

INSERT INTO game_categories (category_name)
VALUES ('FPS'), ('Racing'), ('Sports'), ('Adventure'), ('MOBA')
ON CONFLICT (category_name) DO NOTHING;

INSERT INTO games (title, category_id, description)
SELECT v.title, c.category_id, v.description
FROM (VALUES
  ('Counter-Strike 2', 'FPS', 'Competitive tactical first-person shooter'),
  ('Valorant', 'FPS', 'Tactical hero-based shooter'),
  ('Forza Horizon 5', 'Racing', 'Open-world racing game'),
  ('EA Sports FC', 'Sports', 'Football simulation game'),
  ('Dota 2', 'MOBA', 'Multiplayer online battle arena')
) AS v(title, category, description)
JOIN game_categories c ON c.category_name = v.category
WHERE NOT EXISTS (SELECT 1 FROM games g WHERE g.title = v.title);
