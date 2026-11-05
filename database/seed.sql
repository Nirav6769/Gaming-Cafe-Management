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
VALUES
  ('FPS'),
  ('MOBA'),
  ('RPG'),
  ('Racing'),
  ('Sports'),
  ('Fighting'),
  ('Horror'),
  ('Strategy'),
  ('Adventure'),
  ('Sandbox')
ON CONFLICT (category_name) DO NOTHING;

INSERT INTO games (title, category_id, description)
SELECT v.title, c.category_id, v.description
FROM (VALUES
  -- FPS & Tactical Shooters
  ('Counter-Strike 2', 'FPS', 'Competitive 5v5 tactical first-person shooter with precision gunplay and bomb defusal.'),
  ('Valorant', 'FPS', 'Tactical 5v5 character-based hero shooter combining precise gunplay with unique agent abilities.'),
  ('Apex Legends', 'FPS', 'Fast-paced squad-based battle royale hero shooter featuring movement tech and special abilities.'),
  ('Overwatch 2', 'FPS', 'Team-based multiplayer first-person hero shooter with tank, damage, and support roles.'),
  ('Call of Duty: Warzone', 'FPS', 'Massive free-to-play military battle royale with weapon customization and tactical skirmishes.'),
  ('Rainbow Six Siege', 'FPS', 'Tactical close-quarters shooter focusing on team coordination, destruction, and unique operators.'),

  -- MOBA
  ('Dota 2', 'MOBA', 'Deep competitive multiplayer online battle arena featuring complex team strategy and over 120 heroes.'),
  ('League of Legends', 'MOBA', 'Dynamic team-based strategy game where two teams of five champions face off to destroy the enemy Nexus.'),
  ('Smite', 'MOBA', 'Action-packed third-person multiplayer online battle arena starring mythological gods and deities.'),

  -- RPG & Action RPG
  ('Cyberpunk 2077', 'RPG', 'Immersive open-world action-adventure RPG set in the dystopian megalopolis of Night City.'),
  ('Elden Ring', 'RPG', 'Epic dark fantasy action RPG across the vast Lands Between featuring challenging boss encounters.'),
  ('The Witcher 3: Wild Hunt', 'RPG', 'Story-driven open-world dark fantasy RPG following monster slayer Geralt of Rivia.'),
  ('Baldur''s Gate 3', 'RPG', 'Deep party-based tactical fantasy RPG with turn-based combat set in the Dungeons and Dragons universe.'),
  ('Genshin Impact', 'RPG', 'Open-world anime action RPG featuring elemental magic combat and an expansive fantasy realm.'),

  -- Racing & Driving
  ('Forza Horizon 5', 'Racing', 'Vibrant open-world automotive adventure racing festival set across diverse Mexican landscapes.'),
  ('F1 23', 'Racing', 'Official FIA Formula One World Championship precision motorsport simulator with high-speed racing.'),
  ('Need for Speed Unbound', 'Racing', 'Stylized street racing game with deep car customization, drifting, and high-stakes police chases.'),

  -- Sports & Competitive
  ('EA Sports FC 24', 'Sports', 'Premier association football simulation game featuring authentic clubs, players, and Ultimate Team.'),
  ('NBA 2K24', 'Sports', 'Authentic basketball simulation experience with realistic court physics, player creation, and multiplayer.'),
  ('Rocket League', 'Sports', 'High-powered hybrid of arcade-style soccer and vehicular mayhem with physics-driven rocket cars.'),

  -- Fighting
  ('Tekken 8', 'Fighting', 'Visceral 3D martial arts fighting game showcasing cinematic battles and the aggressive Heat system.'),
  ('Street Fighter 6', 'Fighting', 'Iconic 2D fighting game featuring innovative Drive Gauge mechanics and competitive ranked battles.'),
  ('Mortal Kombat 1', 'Fighting', 'Gory fighting game featuring bone-crushing combat, Kameo assist fighters, and cinematic fatalities.'),

  -- Horror & Survival
  ('Resident Evil 4 Remake', 'Horror', 'Modernized survival horror action classic featuring tense third-person shooting and bioweapon terrors.'),
  ('Dead by Daylight', 'Horror', 'Asymmetrical 4v1 multiplayer survival horror where four survivors attempt to escape one savage killer.'),
  ('Phasmophobia', 'Horror', '4-player cooperative psychological horror ghost-hunting investigation across haunted locations.'),

  -- Strategy & Simulation
  ('Civilization VI', 'Strategy', 'Turn-based 4X grand strategy game guiding a civilization from the Stone Age to the Information Age.'),
  ('Age of Empires IV', 'Strategy', 'Real-time historical strategy directing medieval civilizations, economic gathering, and siege warfare.'),
  ('Cities: Skylines II', 'Strategy', 'Comprehensive urban planning and city-building simulation managing infrastructure, transit, and economy.'),

  -- Adventure & Sandbox
  ('Minecraft', 'Sandbox', 'Infinite voxel sandbox block-building game of exploration, resource mining, crafting, and survival.'),
  ('Grand Theft Auto V', 'Adventure', 'Vast open-world action-adventure crime drama set across Los Santos and Blaine County.'),
  ('Among Us', 'Adventure', 'Multiplayer social deduction party game where crewmates complete tasks while identifying alien impostors.')
) AS v(title, category, description)
JOIN game_categories c ON c.category_name = v.category
WHERE NOT EXISTS (SELECT 1 FROM games g WHERE g.title = v.title);
