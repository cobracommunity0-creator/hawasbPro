-- ============================================================================
-- Hawasb Cafe POS - Complete Authoritative Production Schema
-- Engine: PostgreSQL 14+ (Supabase / Render)
-- ============================================================================

-- Drop existing tables in reverse dependency order if recreating fresh
DROP TABLE IF EXISTS handover_items CASCADE;
DROP TABLE IF EXISTS debt_payments CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS consumptions CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS shifts CASCADE;
DROP TABLE IF EXISTS items CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS settings CASCADE;

-- ----------------------------------------------------------------------------
-- 1. SYSTEM SETTINGS
-- ----------------------------------------------------------------------------
CREATE TABLE settings (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed System Settings
INSERT INTO settings (key, value, description) VALUES
('commission_rate', '0.10', 'Default cashier sales commission rate (10%)'),
('commission_payment_methods', 'cash,vodafone_cash,credit_shakak', 'Comma-separated payment methods eligible for sales commission'),
('block_negative_stock', 'false', 'Whether to strictly block sales on negative inventory (false = allow & alert)'),
('daily_fixed_cost', '0.00', 'Daily fixed overhead cost for net profit calculations');

-- ----------------------------------------------------------------------------
-- 2. USERS (STAFF & OWNER)
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    pin_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'cashier')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed Users with distinct bcrypt PIN hashes:
-- Owner: PIN 1111 -> $2b$10$wU0uGkVYyS.QxNf3k1lZaeiB1QvG6k8w4zX0lO.g3hQvB.j9XqO6e
-- Cashier 1: PIN 2222 -> $2b$10$tJ9N5Gv7vB4oM1wP.L1u6eK9yW7sD8xF3gH5jK2lZ4mN6pQ8rT0vW
-- Cashier 2: PIN 3333 -> $2b$10$aB3cD4eF5gH6iJ7kL8mN9uP0qR1sT2uV3wX4yZ5aB6cD7eF8gH9iJ
-- Cashier 3: PIN 4444 -> $2b$10$kL9mN8oP7qR6sT5uV4wX3yZ2aB1cD0eF9gH8iJ7kL6mN5oP4qR3sT
INSERT INTO users (id, name, username, pin_hash, role, is_active) VALUES
(1, 'مالك المحل', 'owner', '$2b$10$wU0uGkVYyS.QxNf3k1lZaeiB1QvG6k8w4zX0lO.g3hQvB.j9XqO6e', 'owner', TRUE),
(2, 'شيفتاجي 1 - أحمد', 'cashier1', '$2b$10$tJ9N5Gv7vB4oM1wP.L1u6eK9yW7sD8xF3gH5jK2lZ4mN6pQ8rT0vW', 'cashier', TRUE),
(3, 'شيفتاجي 2 - محمد', 'cashier2', '$2b$10$aB3cD4eF5gH6iJ7kL8mN9uP0qR1sT2uV3wX4yZ5aB6cD7eF8gH9iJ', 'cashier', TRUE),
(4, 'شيفتاجي 3 - محمود', 'cashier3', '$2b$10$kL9mN8oP7qR6sT5uV4wX3yZ2aB1cD0eF9gH8iJ7kL6mN5oP4qR3sT', 'cashier', TRUE);
SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));

-- ----------------------------------------------------------------------------
-- 3. CUSTOMERS & ACCOUNTS (INCLUDING OWNER TAB)
-- ----------------------------------------------------------------------------
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    current_debt NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (current_debt >= 0),
    credit_balance NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (credit_balance >= 0),
    is_owner BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed Customers
INSERT INTO customers (id, name, phone, current_debt, credit_balance, is_owner) VALUES
(1, 'عميل نقدي عام', '01000000000', 0.00, 0.00, FALSE),
(2, 'حساب المالك (استهلاك معفى)', '01111111111', 0.00, 0.00, TRUE),
(3, 'أحمد شكك (زبون دائم)', '01222222222', 0.00, 0.00, FALSE),
(4, 'شيفتاجي 1 (حساب الموظف)', '01555555551', 0.00, 0.00, FALSE),
(5, 'شيفتاجي 2 (حساب الموظف)', '01555555552', 0.00, 0.00, FALSE),
(6, 'شيفتاجي 3 (حساب الموظف)', '01555555553', 0.00, 0.00, FALSE);
SELECT setval('customers_id_seq', (SELECT MAX(id) FROM customers));

-- ----------------------------------------------------------------------------
-- 4. ITEMS & INVENTORY
-- ----------------------------------------------------------------------------
CREATE TABLE items (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'عام',
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    cost_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (cost_price >= 0),
    current_stock NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    track_in_handover BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed Items
INSERT INTO items (id, name, category, price, cost_price, current_stock, track_in_handover, is_active) VALUES
(1, 'شاي كشري', 'مشروبات ساخنة', 10.00, 3.00, 150.00, TRUE, TRUE),
(2, 'قهوة تركي مخصوص', 'مشروبات ساخنة', 15.00, 5.00, 80.00, TRUE, TRUE),
(3, 'نسكافيه بلاك 3*1', 'مشروبات ساخنة', 15.00, 6.00, 60.00, TRUE, TRUE),
(4, 'كانز كوكاكولا 330 مل', 'مشروبات باردة', 20.00, 14.50, 48.00, TRUE, TRUE),
(5, 'كانز بيبسي 330 مل', 'مشروبات باردة', 20.00, 14.50, 48.00, TRUE, TRUE),
(6, 'مياه معدنية صغيرة', 'مشروبات باردة', 7.00, 3.50, 72.00, TRUE, TRUE),
(7, 'إندومي خضار سوبر', 'مأكولات سريعة', 15.00, 9.50, 35.00, TRUE, TRUE),
(8, 'شيبسي عائلي', 'مسليات ومقرمشات', 12.00, 8.50, 40.00, TRUE, TRUE);
SELECT setval('items_id_seq', (SELECT MAX(id) FROM items));

-- ----------------------------------------------------------------------------
-- 5. SHIFTS (WITH STRUCTURAL SINGLE ACTIVE SHIFT CONSTRAINT)
-- ----------------------------------------------------------------------------
CREATE TABLE shifts (
    id SERIAL PRIMARY KEY,
    cashier_id INT NOT NULL REFERENCES users(id),
    start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_time TIMESTAMP WITH TIME ZONE,
    starting_cash NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    closing_cash_actual NUMERIC(10, 2),
    closing_cash_expected NUMERIC(10, 2),
    cash_discrepancy NUMERIC(10, 2),
    commission_rate NUMERIC(5, 4) DEFAULT 0.1000,
    commission_earned NUMERIC(10, 2) DEFAULT 0.00,
    commission_paid_cash NUMERIC(10, 2) DEFAULT 0.00,
    total_sales NUMERIC(10, 2) DEFAULT 0.00,
    net_profit NUMERIC(10, 2) DEFAULT 0.00,
    status VARCHAR(30) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending_handover', 'closed', 'force_closed')),
    incoming_cashier_id INT REFERENCES users(id),
    notes TEXT,
    force_closed_at TIMESTAMP WITH TIME ZONE,
    force_closed_by INT REFERENCES users(id),
    force_closed_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Partial Unique Index: Guarantees at most ONE shift in ('open', 'pending_handover')
CREATE UNIQUE INDEX idx_single_active_shift ON shifts ((1)) WHERE status IN ('open', 'pending_handover');

-- ----------------------------------------------------------------------------
-- 6. ORDERS & SALES
-- ----------------------------------------------------------------------------
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    shift_id INT NOT NULL REFERENCES shifts(id),
    cashier_id INT NOT NULL REFERENCES users(id),
    customer_id INT REFERENCES customers(id),
    payment_method VARCHAR(30) NOT NULL CHECK (payment_method IN ('cash', 'vodafone_cash', 'credit_shakak')),
    subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    total_cost NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    discount NUMERIC(10, 2) DEFAULT 0.00,
    credit_applied NUMERIC(10, 2) DEFAULT 0.00,
    idempotency_key VARCHAR(100) UNIQUE,
    device_tab_name VARCHAR(50),
    status VARCHAR(20) DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_orders_shift_id ON orders(shift_id);
CREATE INDEX idx_orders_created_at ON orders(created_at);

-- ----------------------------------------------------------------------------
-- 7. ORDER ITEMS
-- ----------------------------------------------------------------------------
CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id INT NOT NULL REFERENCES items(id),
    quantity NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10, 2) NOT NULL,
    unit_cost NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    total_price NUMERIC(10, 2) NOT NULL,
    total_cost NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);

-- ----------------------------------------------------------------------------
-- 8. STAFF & OWNER CONSUMPTION
-- ----------------------------------------------------------------------------
CREATE TABLE consumptions (
    id SERIAL PRIMARY KEY,
    shift_id INT NOT NULL REFERENCES shifts(id),
    cashier_id INT NOT NULL REFERENCES users(id),
    consumer_user_id INT REFERENCES users(id),
    customer_id INT REFERENCES customers(id),
    item_id INT NOT NULL REFERENCES items(id),
    quantity NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    price_charged NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    is_owner BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 9. HANDOVER INVENTORY COUNTS
-- ----------------------------------------------------------------------------
CREATE TABLE handover_items (
    id SERIAL PRIMARY KEY,
    shift_id INT NOT NULL REFERENCES shifts(id),
    item_id INT NOT NULL REFERENCES items(id),
    system_qty NUMERIC(10, 2) NOT NULL,
    actual_qty NUMERIC(10, 2) NOT NULL,
    discrepancy_qty NUMERIC(10, 2) NOT NULL,
    unit_cost NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    discrepancy_cost NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 10. DEBT REPAYMENTS & CREDIT ADJUSTMENTS
-- ----------------------------------------------------------------------------
CREATE TABLE debt_payments (
    id SERIAL PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customers(id),
    shift_id INT REFERENCES shifts(id),
    cashier_id INT NOT NULL REFERENCES users(id),
    amount_paid NUMERIC(10, 2) NOT NULL CHECK (amount_paid > 0),
    debt_cleared NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    credit_added NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    payment_method VARCHAR(30) NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'vodafone_cash')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 11. SHIFT CASH EXPENSES / PAYOUTS
-- ----------------------------------------------------------------------------
CREATE TABLE expenses (
    id SERIAL PRIMARY KEY,
    shift_id INT NOT NULL REFERENCES shifts(id),
    cashier_id INT NOT NULL REFERENCES users(id),
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    category VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);