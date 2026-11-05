import { Pool } from "pg";

async function main() {
  try {
    process.loadEnvFile?.(".env.local");
  } catch {}

  const databaseUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    console.error("Missing DATABASE_URL");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log("Seeding membership plans...");
    await pool.query(`
      INSERT INTO public.membership_plans (name, description, duration_days, price, discount_percent, is_active)
      VALUES
        ('Bronze Gamer (Weekly)', '7-day starter pass with 5% discount on gaming PC sessions and cafe snacks.', 7, 299.00, 5.00, TRUE),
        ('Silver Gamer (Monthly)', '30-day regular membership with 10% discount and priority tournament entry.', 30, 999.00, 10.00, TRUE),
        ('Gold Pro (Quarterly)', '90-day elite pass with 15% discount on all sessions, snacks, and reservations.', 90, 2499.00, 15.00, TRUE),
        ('Platinum VIP (Annual)', '365-day all-access VIP pass with 25% discount and dedicated tournament slots.', 365, 7999.00, 25.00, TRUE)
      ON CONFLICT (name) DO NOTHING;
    `);

    console.log("Seeding snacks...");
    await pool.query(`
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
    `);

    console.log("Seeding sample customer membership...");
    const custs = await pool.query("SELECT customer_id FROM customers ORDER BY customer_id ASC LIMIT 1;");
    const plan = await pool.query("SELECT plan_id, price FROM membership_plans WHERE name LIKE 'Silver%' LIMIT 1;");
    if (custs.rows.length >= 1 && plan.rows.length >= 1) {
      const cId = custs.rows[0].customer_id;
      const pId = plan.rows[0].plan_id;
      const price = plan.rows[0].price;
      await pool.query(`
        INSERT INTO public.customer_memberships (customer_id, plan_id, status, price_paid, payment_method, start_at, end_at)
        VALUES ($1, $2, 'active', $3, 'upi_demo', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days')
        ON CONFLICT DO NOTHING;
      `, [cId, pId, price]);
    }

    const plansCount = await pool.query("SELECT COUNT(*)::int AS cnt FROM membership_plans;");
    const snacksCount = await pool.query("SELECT COUNT(*)::int AS cnt FROM snack_items;");
    const membsCount = await pool.query("SELECT COUNT(*)::int AS cnt FROM customer_memberships;");

    console.log(`Successfully seeded Commerce!`);
    console.log(` - Membership Plans: ${plansCount.rows[0].cnt}`);
    console.log(` - Snack Items: ${snacksCount.rows[0].cnt}`);
    console.log(` - Customer Memberships: ${membsCount.rows[0].cnt}`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error("Seeding error:", err);
  process.exit(1);
});
