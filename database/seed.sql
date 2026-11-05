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

-- Optional commerce seed (applied when commerce schema exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'membership_plans') THEN
    INSERT INTO public.membership_plans (name, description, duration_days, price, discount_percent, is_active)
    VALUES
      ('Bronze Gamer (Weekly)', '7-day starter pass with 5% discount on gaming PC sessions and cafe snacks.', 7, 299.00, 5.00, TRUE),
      ('Silver Gamer (Monthly)', '30-day regular membership with 10% discount and priority tournament entry.', 30, 999.00, 10.00, TRUE),
      ('Gold Pro (Quarterly)', '90-day elite pass with 15% discount on all sessions, snacks, and reservations.', 90, 2499.00, 15.00, TRUE),
      ('Platinum VIP (Annual)', '365-day all-access VIP pass with 25% discount and dedicated tournament slots.', 365, 7999.00, 25.00, TRUE)
    ON CONFLICT (name) DO NOTHING;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'snack_items') THEN
    INSERT INTO public.snack_items (name, category, description, unit_price, stock_quantity, is_active)
    VALUES
      -- Beverages
      ('Red Bull Energy Drink (250ml)', 'Beverage', 'Vitalizes body and mind for intense gaming sessions.', 125.00, 50, TRUE),
      ('Monster Energy Ultra (350ml)', 'Beverage', 'Zero calorie, crisp refreshing energy blend.', 140.00, 40, TRUE),
      ('Mountain Dew Citrus Blast (500ml)', 'Beverage', 'High-caffeine thirst quencher.', 45.00, 60, TRUE),
      ('Coca-Cola Zero Sugar (330ml)', 'Beverage', 'Classic crisp cola taste without sugar.', 40.00, 75, TRUE),
      ('Iced Hazelnut Cold Coffee', 'Beverage', 'Chilled freshly brewed coffee with hazelnut syrup.', 95.00, 30, TRUE),
      ('Bottled Mineral Water (1L)', 'Beverage', 'Pure hydration.', 20.00, 100, TRUE),

      -- Chips & Snacks
      ('Doritos Nacho Cheese (100g)', 'Chips', 'Crunchy tortilla chips loaded with tangy nacho cheese.', 50.00, 45, TRUE),
      ('Lay''s Classic Salted (90g)', 'Chips', 'Thin crispy golden potato chips.', 30.00, 60, TRUE),
      ('Pringles Sour Cream & Onion (110g)', 'Chips', 'Stackable potato crisps with zesty sour cream.', 110.00, 35, TRUE),
      ('Peri Peri French Fries', 'Hot Food', 'Golden crispy fries tossed in fiery African peri-peri spices.', 80.00, 50, TRUE),
      ('Buttered Popcorn Tub', 'Snacks', 'Freshly popped warm buttery theatre popcorn.', 60.00, 40, TRUE),

      -- Hot Food & Meals
      ('Classic Grilled Cheese Sandwich', 'Hot Food', 'Toasted bread with melted cheddar and mozzarella.', 90.00, 25, TRUE),
      ('Crispy Chicken Burger', 'Hot Food', 'Golden fried chicken patty with mayo and lettuce in a brioche bun.', 140.00, 20, TRUE),
      ('Maggi 2-Minute Masala Noodles', 'Hot Food', 'Steaming bowl of spicy classic Indian noodles.', 45.00, 80, TRUE),
      ('Veg Steamed Momos (6 pcs)', 'Hot Food', 'Juicy vegetable dumplings served with spicy garlic dip.', 70.00, 30, TRUE),

      -- Confectionery
      ('Snickers Peanut Bar (50g)', 'Sweets', 'Milk chocolate, nougat, caramel, and roasted peanuts.', 50.00, 50, TRUE),
      ('KitKat 4-Finger (38g)', 'Sweets', 'Crisp wafer fingers covered in smooth milk chocolate.', 35.00, 60, TRUE)
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

