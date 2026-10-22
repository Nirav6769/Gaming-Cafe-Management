-- 1. Enable the vector extension for semantic game search
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Strong Entities
CREATE TABLE customers (
    customer_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(15),
    join_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE staff (
    staff_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(50) CHECK (role IN ('admin', 'manager', 'attendant')),
    shift VARCHAR(50)
);

CREATE TABLE gaming_pcs (
    pc_id SERIAL PRIMARY KEY,
    pc_name VARCHAR(50) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'maintenance')),
    hourly_rate DECIMAL(5,2) NOT NULL
);

CREATE TABLE game_categories (
    category_id SERIAL PRIMARY KEY,
    category_name VARCHAR(50) UNIQUE NOT NULL
);

-- Note: The embedding column uses pgvector for semantic similarity matching
CREATE TABLE games (
    game_id SERIAL PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    category_id INT REFERENCES game_categories(category_id) ON DELETE SET NULL,
    description TEXT,
    search_embedding vector(384) 
);

CREATE TABLE tournaments (
    tournament_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    game_id INT REFERENCES games(game_id),
    prize_pool DECIMAL(10,2),
    start_date DATE NOT NULL
);

-- 3. Weak Entity (Dependent entirely on the Gaming PC)
-- It uses a composite primary key to demonstrate a strict identifying relationship
CREATE TABLE maintenance_records (
    pc_id INT REFERENCES gaming_pcs(pc_id) ON DELETE CASCADE,
    maintenance_date DATE NOT NULL,
    issue_description TEXT NOT NULL,
    resolved BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (pc_id, maintenance_date)
);

-- 4. 1:N and M:N Relationships (Associative Entities)
CREATE TABLE gaming_sessions (
    session_id SERIAL PRIMARY KEY,
    customer_id INT REFERENCES customers(customer_id) ON DELETE CASCADE,
    pc_id INT REFERENCES gaming_pcs(pc_id) ON DELETE CASCADE,
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    total_cost DECIMAL(7,2)
);

-- Associative entity resolving the M:N relationship between Sessions and Games
CREATE TABLE session_games (
    session_id INT REFERENCES gaming_sessions(session_id) ON DELETE CASCADE,
    game_id INT REFERENCES games(game_id) ON DELETE CASCADE,
    play_duration_minutes INT,
    PRIMARY KEY (session_id, game_id)
);

-- Associative entity resolving the M:N relationship between Customers and Tournaments
CREATE TABLE tournament_registrations (
    tournament_id INT REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
    customer_id INT REFERENCES customers(customer_id) ON DELETE CASCADE,
    registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tournament_id, customer_id)
);