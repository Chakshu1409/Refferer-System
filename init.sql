-- Enable UUID generation extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    referrer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Purchases table
CREATE TABLE IF NOT EXISTS purchases (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Earnings table
CREATE TABLE IF NOT EXISTS earnings (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,       -- who earned
    from_user_id UUID REFERENCES users(id),                    -- who made the purchase
    level INT CHECK (level IN (1, 2)),
    amount NUMERIC NOT NULL,
    purchase_id INT REFERENCES purchases(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
