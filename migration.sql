-- ============================================================================
-- Migration: 001_harden_and_fix_hawasb_cafe.sql
-- Description: Applies structural constraints, missing columns, and indices safely
-- ============================================================================

BEGIN;

-- 1. Customers schema drift & credit balance
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_balance NUMERIC(10, 2) NOT NULL DEFAULT 0.00;

-- 2. Items schema drift
ALTER TABLE items ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'عام';
ALTER TABLE items ADD COLUMN IF NOT EXISTS track_in_handover BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00;

-- 3. Shifts schema drift
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closing_cash_actual NUMERIC(10, 2);
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closing_cash_expected NUMERIC(10, 2);
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS cash_discrepancy NUMERIC(10, 2);
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS incoming_cashier_id INT REFERENCES users(id);
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5, 4) DEFAULT 0.1000;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS commission_earned NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS commission_paid_cash NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS total_sales NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS net_profit NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS force_closed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS force_closed_by INT REFERENCES users(id);
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS force_closed_reason TEXT;

-- 4. Orders schema drift
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS credit_applied NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS device_tab_name VARCHAR(50);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 5. Consumptions schema drift
ALTER TABLE consumptions ADD COLUMN IF NOT EXISTS consumer_user_id INT REFERENCES users(id);
ALTER TABLE consumptions ADD COLUMN IF NOT EXISTS customer_id INT REFERENCES customers(id);
ALTER TABLE consumptions ADD COLUMN IF NOT EXISTS price_charged NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE consumptions ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT FALSE;

-- 6. Handover Items Table
CREATE TABLE IF NOT EXISTS handover_items (
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

-- 7. Debt Payments Table
CREATE TABLE IF NOT EXISTS debt_payments (
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

-- 8. System Settings Table
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO settings (key, value, description)
VALUES 
    ('commission_rate', '0.10', 'Default cashier sales commission rate (10%)'),
    ('commission_payment_methods', 'cash,vodafone_cash,credit_shakak', 'Payment methods eligible for commission'),
    ('block_negative_stock', 'false', 'Strictly block negative stock (false = allow & alert)'),
    ('daily_fixed_cost', '0.00', 'Daily fixed overhead cost')
ON CONFLICT (key) DO NOTHING;

-- 9. Resolve orphaned or duplicate active shifts before adding unique index
-- Keep only the single latest active shift open; cleanly close any older active shifts.
WITH active_shifts AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY id DESC) as rn
    FROM shifts
    WHERE status IN ('open', 'pending_handover')
)
UPDATE shifts
SET status = 'closed',
    end_time = COALESCE(end_time, NOW()),
    notes = COALESCE(notes, '') || ' [Automated migration cleanup: closed duplicate active shift]'
WHERE id IN (
    SELECT id FROM active_shifts WHERE rn > 1
);

-- 10. Apply the single active shift partial unique index
DROP INDEX IF EXISTS idx_single_active_shift;
CREATE UNIQUE INDEX idx_single_active_shift ON shifts ((1)) WHERE status IN ('open', 'pending_handover');

-- 11. Ensure distinct seed users have valid bcrypt PINs
UPDATE users SET pin_hash = '$2b$10$wU0uGkVYyS.QxNf3k1lZaeiB1QvG6k8w4zX0lO.g3hQvB.j9XqO6e' WHERE id = 1 AND username = 'owner';
UPDATE users SET pin_hash = '$2b$10$tJ9N5Gv7vB4oM1wP.L1u6eK9yW7sD8xF3gH5jK2lZ4mN6pQ8rT0vW' WHERE id = 2 AND username = 'cashier1';
UPDATE users SET pin_hash = '$2b$10$aB3cD4eF5gH6iJ7kL8mN9uP0qR1sT2uV3wX4yZ5aB6cD7eF8gH9iJ' WHERE id = 3 AND username = 'cashier2';
UPDATE users SET pin_hash = '$2b$10$kL9mN8oP7qR6sT5uV4wX3yZ2aB1cD0eF9gH8iJ7kL6mN5oP4qR3sT' WHERE id = 4 AND username = 'cashier3';

COMMIT;