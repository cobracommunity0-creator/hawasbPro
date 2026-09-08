const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
}
app.use(express.static(__dirname));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/hawasb_db',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// إعداد الجداول والبيانات الأساسية تلقائياً بصيغة متوافقة بالكامل
async function initDB() {
    try {
        // 1. الموظفون والمستخدمون
        await pool.query(`
            CREATE TABLE IF NOT EXISTS employees (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                pin_code VARCHAR(50) NOT NULL,
                full_name VARCHAR(100) NOT NULL,
                phone VARCHAR(20),
                role VARCHAR(20) NOT NULL DEFAULT 'staff',
                current_shortage_debt NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. مواقع المخزون
        await pool.query(`
            CREATE TABLE IF NOT EXISTS inventory_locations (
                id SERIAL PRIMARY KEY,
                code VARCHAR(30) UNIQUE NOT NULL,
                name VARCHAR(100) NOT NULL,
                description TEXT
            );
        `);

        // 3. أقسام المنتجات
        await pool.query(`
            CREATE TABLE IF NOT EXISTS product_categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) UNIQUE NOT NULL
            );
        `);

        // 4. المنتجات
        await pool.query(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                sku VARCHAR(50) UNIQUE,
                name VARCHAR(150) NOT NULL,
                category_id INT REFERENCES product_categories(id) ON DELETE SET NULL,
                product_type VARCHAR(30) NOT NULL DEFAULT 'DIRECT_UNIT',
                unit_cost_price NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
                unit_selling_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                unit_type VARCHAR(20) NOT NULL DEFAULT 'قطعة',
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 5. أرصدة المخزون بالمواقع
        await pool.query(`
            CREATE TABLE IF NOT EXISTS location_inventory (
                product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                location_id INT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
                quantity NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (product_id, location_id)
            );
        `);

        // 6. تحويلات البضاعة بين المخازن
        await pool.query(`
            CREATE TABLE IF NOT EXISTS stock_transfers (
                id SERIAL PRIMARY KEY,
                source_location_id INT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
                destination_location_id INT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
                transferred_by_user_id INT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
                notes TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS stock_transfer_items (
                id SERIAL PRIMARY KEY,
                transfer_id INT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
                product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                quantity NUMERIC(12, 4) NOT NULL
            );
        `);

        // 7. تركيبات الخامات (BOM)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS product_boms (
                id SERIAL PRIMARY KEY,
                parent_product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                ingredient_product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                quantity_required NUMERIC(10, 4) NOT NULL,
                rule VARCHAR(30) NOT NULL DEFAULT 'ALWAYS'
            );
        `);

        // 8. الشيفتات والمطابقات
        await pool.query(`
            CREATE TABLE IF NOT EXISTS shifts (
                id SERIAL PRIMARY KEY,
                shift_number SMALLINT NOT NULL DEFAULT 1,
                shift_date DATE NOT NULL,
                outgoing_cashier_id INT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
                incoming_cashier_id INT REFERENCES employees(id) ON DELETE RESTRICT,
                start_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                end_time TIMESTAMP WITH TIME ZONE,
                starting_cash_float NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
                notes TEXT
            );

            CREATE TABLE IF NOT EXISTS shift_reconciliations (
                shift_id INT PRIMARY KEY REFERENCES shifts(id) ON DELETE CASCADE,
                expected_cash NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                actual_physical_cash NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                petty_expenses_total NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                tab_settlements_total NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                cash_sales_total NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                cash_variance NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                is_shortage BOOLEAN NOT NULL DEFAULT FALSE,
                shortage_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                outgoing_pin_verified BOOLEAN NOT NULL DEFAULT FALSE,
                incoming_pin_verified BOOLEAN NOT NULL DEFAULT FALSE,
                reconciled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS shift_inventory_counts (
                id SERIAL PRIMARY KEY,
                shift_id INT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
                product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                location_id INT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
                count_type VARCHAR(10) NOT NULL,
                physical_count NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
                system_expected_count NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
                variance_qty NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (shift_id, product_id, location_id, count_type)
            );

            CREATE TABLE IF NOT EXISTS glass_equipment_audits (
                id SERIAL PRIMARY KEY,
                shift_id INT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
                quota_total INT NOT NULL DEFAULT 15,
                clean_count INT NOT NULL DEFAULT 0,
                in_use_count INT NOT NULL DEFAULT 0,
                broken_count INT NOT NULL DEFAULT 0,
                variance INT NOT NULL DEFAULT 0,
                verified_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 9. الطلبات والمبيعات واستهلاك الموظفين
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                shift_id INT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
                cashier_id INT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
                order_mode VARCHAR(20) NOT NULL DEFAULT 'TAKEAWAY',
                payment_type VARCHAR(20) NOT NULL DEFAULT 'CASH',
                total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                total_cost NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
                status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
                station_reference VARCHAR(50) DEFAULT 'الكاشير المباشر',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS order_items (
                id SERIAL PRIMARY KEY,
                order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                quantity NUMERIC(10, 2) NOT NULL,
                unit_price NUMERIC(10, 2) NOT NULL,
                unit_cost NUMERIC(10, 4) NOT NULL,
                subtotal_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                subtotal_cost NUMERIC(10, 4) NOT NULL DEFAULT 0.0000
            );

            CREATE TABLE IF NOT EXISTS staff_consumptions (
                id SERIAL PRIMARY KEY,
                order_id INT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
                shift_id INT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
                employee_id INT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
                total_cost_charged NUMERIC(10, 2) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 10. الآجل والمصروفات والتوالف
        await pool.query(`
            CREATE TABLE IF NOT EXISTS customer_tabs (
                id SERIAL PRIMARY KEY,
                customer_name VARCHAR(100) NOT NULL,
                phone VARCHAR(20) NOT NULL,
                total_debt NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                amount_paid NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                remaining_balance NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                status VARCHAR(20) NOT NULL DEFAULT 'UNPAID',
                origin_shift_id INT REFERENCES shifts(id) ON DELETE SET NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS customer_tab_orders (
                tab_id INT NOT NULL REFERENCES customer_tabs(id) ON DELETE CASCADE,
                order_id INT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
                PRIMARY KEY (tab_id, order_id)
            );

            CREATE TABLE IF NOT EXISTS customer_tab_payments (
                id SERIAL PRIMARY KEY,
                tab_id INT NOT NULL REFERENCES customer_tabs(id) ON DELETE RESTRICT,
                collected_in_shift_id INT NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,
                cashier_id INT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
                amount_paid NUMERIC(10, 2) NOT NULL,
                payment_method VARCHAR(20) NOT NULL DEFAULT 'CASH',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS petty_cash_expenses (
                id SERIAL PRIMARY KEY,
                shift_id INT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
                employee_id INT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
                amount NUMERIC(10, 2) NOT NULL,
                reason TEXT NOT NULL,
                receipt_reference VARCHAR(100),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS wastage_logs (
                id SERIAL PRIMARY KEY,
                shift_id INT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
                product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                location_id INT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
                quantity NUMERIC(10, 4) NOT NULL,
                unit_cost_price NUMERIC(10, 4) NOT NULL,
                total_cost_loss NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
                reason VARCHAR(50) NOT NULL,
                logged_by_user_id INT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
                notes TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 11. البيانات الافتراضية
        await pool.query(`
            INSERT INTO employees (id, username, pin_code, full_name, phone, role) VALUES
            (1, 'admin',  '1234', 'مدير النظام',    '01000000000', 'admin'),
            (2, 'omar',   '1111', 'عمر - وردية 1',   '01100000001', 'cashier'),
            (3, 'tareq',  '2222', 'طارق - وردية 2',  '01200000002', 'cashier'),
            (4, 'antry',  '3333', 'عنتري - وردية 3', '01500000003', 'cashier')
            ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, pin_code = EXCLUDED.pin_code;

            INSERT INTO inventory_locations (id, code, name, description) VALUES
            (1, 'BACKROOM',      'المخزن الداخلي', 'مخزن الاحتياطي الرئيسي'),
            (2, 'FRONT_DISPLAY', 'الواجهة والمعروض', 'بضاعة البيع المباشر')
            ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code;

            INSERT INTO product_categories (id, name) VALUES
            (1, 'مشروبات ساخنة'), (2, 'مشروبات ساقعة'), (3, 'شيبسيات وسناكس'), (4, 'خامات ومواد تغليف')
            ON CONFLICT (id) DO NOTHING;
        `);

        // مزامنة أرقام الـ Sequences بأمان
        await pool.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'employees_id_seq') THEN
                    PERFORM setval('employees_id_seq', COALESCE((SELECT MAX(id) FROM employees), 1));
                END IF;
                IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'inventory_locations_id_seq') THEN
                    PERFORM setval('inventory_locations_id_seq', COALESCE((SELECT MAX(id) FROM inventory_locations), 1));
                END IF;
                IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'product_categories_id_seq') THEN
                    PERFORM setval('product_categories_id_seq', COALESCE((SELECT MAX(id) FROM product_categories), 1));
                END IF;
            END $$;
        `);

        console.log('✅ تم إعداد وتحديث قاعدة البيانات بنجاح.');
    } catch (err) {
        console.error('❌ خطأ في إعداد قاعدة البيانات:', err.message);
    }
}
initDB();

// ============================================================================
// مسارات المصادقة والموظفين
// ============================================================================
app.post('/api/login', async (req, res) => {
    const { username, pin } = req.body;
    try {
        const userRes = await pool.query(
            'SELECT id, username, full_name, role, current_shortage_debt FROM employees WHERE (username = $1 OR phone = $1) AND pin_code = $2 AND is_active = TRUE',
            [username, pin]
        );
        const user = userRes.rows[0];
        if (!user) return res.status(401).json({ error: 'اسم المستخدم أو رمز PIN غير صحيح' });

        const shiftRes = await pool.query(
            "SELECT * FROM shifts WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1"
        );

        res.json({ user, activeShift: shiftRes.rows[0] || null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/employees', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, full_name, role FROM employees WHERE is_active = TRUE ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// مسارات الشيفتات والتسليم
// ============================================================================
app.post('/api/start-shift', async (req, res) => {
    const { shift_number, cashier_id, starting_float } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const openCheck = await client.query("SELECT id FROM shifts WHERE status = 'OPEN' LIMIT 1");
        if (openCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.json({ shift_id: openCheck.rows[0].id });
        }

        const shiftDate = new Date().toISOString().split('T')[0];
        const newShift = await client.query(
            `INSERT INTO shifts (shift_number, shift_date, outgoing_cashier_id, starting_cash_float, status) 
             VALUES ($1, $2, $3, $4, 'OPEN') RETURNING id`,
            [shift_number || 1, shiftDate, cashier_id, starting_float || 0]
        );
        const shiftId = newShift.rows[0].id;

        const lastClosedShift = await client.query(
            "SELECT id FROM shifts WHERE status = 'CLOSED' ORDER BY id DESC LIMIT 1"
        );

        if (lastClosedShift.rows.length > 0) {
            await client.query(
                `INSERT INTO shift_inventory_counts (shift_id, product_id, location_id, count_type, physical_count, system_expected_count)
                 SELECT $1, product_id, location_id, 'OPENING', physical_count, physical_count
                 FROM shift_inventory_counts 
                 WHERE shift_id = $2 AND count_type = 'CLOSING'
                 ON CONFLICT DO NOTHING`,
                [shiftId, lastClosedShift.rows[0].id]
            );
        }

        await client.query('COMMIT');
        res.json({ shift_id: shiftId });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.get('/api/shift-summary/:shift_id', async (req, res) => {
    const shiftId = req.params.shift_id;
    try {
        const shiftData = await pool.query('SELECT starting_cash_float FROM shifts WHERE id = $1', [shiftId]);
        const startingFloat = Number(shiftData.rows[0]?.starting_cash_float || 0);

        const salesRes = await pool.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN payment_type = 'CASH' THEN total_amount ELSE 0 END), 0) as cash_sales,
                COALESCE(SUM(CASE WHEN payment_type = 'CREDIT_TAB' THEN total_amount ELSE 0 END), 0) as tab_sales,
                COALESCE(SUM(CASE WHEN payment_type = 'STAFF_EXPENSE' THEN total_cost ELSE 0 END), 0) as staff_costs,
                COALESCE(SUM(total_cost), 0) as total_cogs
            FROM orders WHERE shift_id = $1 AND status = 'COMPLETED'
        `, [shiftId]);

        const tabSettlements = await pool.query(
            'SELECT COALESCE(SUM(amount_paid), 0) as total_tab_cash FROM customer_tab_payments WHERE collected_in_shift_id = $1',
            [shiftId]
        );

        const pettyExpenses = await pool.query(
            'SELECT COALESCE(SUM(amount), 0) as total_petty FROM petty_cash_expenses WHERE shift_id = $1',
            [shiftId]
        );

        const cashSales = Number(salesRes.rows[0].cash_sales);
        const tabCollected = Number(tabSettlements.rows[0].total_tab_cash);
        const pettyTotal = Number(pettyExpenses.rows[0].total_petty);
        const expectedCash = startingFloat + cashSales + tabCollected - pettyTotal;

        res.json({
            starting_float: startingFloat,
            cash_sales: cashSales,
            tab_credit_sales: Number(salesRes.rows[0].tab_sales),
            staff_expense_sales: Number(salesRes.rows[0].staff_costs),
            tab_settlements_income: tabCollected,
            petty_expenses: pettyTotal,
            expected_cash: expectedCash
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/shift-reconciliation', async (req, res) => {
    const {
        shift_id,
        outgoing_cashier_id,
        outgoing_pin,
        incoming_cashier_id,
        incoming_pin,
        physical_cash,
        glass_audit,
        inventory_counts
    } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const outAuth = await client.query('SELECT id FROM employees WHERE id = $1 AND pin_code = $2', [outgoing_cashier_id, outgoing_pin]);
        if (outAuth.rows.length === 0) throw new Error('رمز PIN الخاص بالكاشير الحالي غير صحيح');

        const inAuth = await client.query('SELECT id FROM employees WHERE id = $1 AND pin_code = $2', [incoming_cashier_id, incoming_pin]);
        if (inAuth.rows.length === 0) throw new Error('رمز PIN الخاص بالكاشير المستلم غير صحيح');

        const shiftRes = await client.query('SELECT starting_cash_float FROM shifts WHERE id = $1', [shift_id]);
        const startingFloat = Number(shiftRes.rows[0]?.starting_cash_float || 0);

        const sales = await client.query("SELECT COALESCE(SUM(total_amount), 0) as cash_total FROM orders WHERE shift_id = $1 AND payment_type = 'CASH' AND status = 'COMPLETED'", [shift_id]);
        const tabs = await client.query('SELECT COALESCE(SUM(amount_paid), 0) as tab_total FROM customer_tab_payments WHERE collected_in_shift_id = $1', [shift_id]);
        const petty = await client.query('SELECT COALESCE(SUM(amount), 0) as petty_total FROM petty_cash_expenses WHERE shift_id = $1', [shift_id]);

        const cashSales = Number(sales.rows[0].cash_total);
        const tabIncome = Number(tabs.rows[0].tab_total);
        const pettyCash = Number(petty.rows[0].petty_total);
        const expectedCash = startingFloat + cashSales + tabIncome - pettyCash;

        const actualCash = Number(physical_cash) || 0;
        const variance = actualCash - expectedCash;
        const isShortage = variance < 0;
        const shortageAmount = isShortage ? Math.abs(variance) : 0;

        if (isShortage && shortageAmount > 0) {
            await client.query(
                'UPDATE employees SET current_shortage_debt = current_shortage_debt + $1 WHERE id = $2',
                [shortageAmount, outgoing_cashier_id]
            );
        }

        await client.query(`
            INSERT INTO shift_reconciliations (
                shift_id, expected_cash, actual_physical_cash, petty_expenses_total,
                tab_settlements_total, cash_sales_total, cash_variance, is_shortage,
                shortage_amount, outgoing_pin_verified, incoming_pin_verified
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, TRUE)
        `, [shift_id, expectedCash, actualCash, pettyCash, tabIncome, cashSales, variance, isShortage, shortageAmount]);

        if (glass_audit) {
            await client.query(`
                INSERT INTO glass_equipment_audits (shift_id, clean_count, in_use_count, broken_count)
                VALUES ($1, $2, $3, $4)
            `, [shift_id, glass_audit.clean || 0, glass_audit.in_use || 0, glass_audit.broken || 0]);
        }

        if (Array.isArray(inventory_counts)) {
            for (const item of inventory_counts) {
                const sysCount = await client.query(
                    'SELECT quantity FROM location_inventory WHERE product_id = $1 AND location_id = $2',
                    [item.product_id, item.location_id]
                );
                const currentSystem = Number(sysCount.rows[0]?.quantity || 0);

                await client.query(`
                    INSERT INTO shift_inventory_counts (shift_id, product_id, location_id, count_type, physical_count, system_expected_count, variance_qty)
                    VALUES ($1, $2, $3, 'CLOSING', $4, $5, $4 - $5)
                `, [shift_id, item.product_id, item.location_id, item.physical_count, currentSystem]);
            }
        }

        await client.query(`
            UPDATE shifts 
            SET status = 'CLOSED', end_time = NOW(), incoming_cashier_id = $1
            WHERE id = $2
        `, [incoming_cashier_id, shift_id]);

        await client.query('COMMIT');
        res.json({ success: true, variance, is_shortage: isShortage, shortage_amount: shortageAmount });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ============================================================================
// مسارات المنتجات والمخزون
// ============================================================================
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                p.id, p.sku, p.name, 
                p.unit_cost_price, p.unit_cost_price AS cost_price,
                p.unit_selling_price, p.unit_selling_price AS selling_price,
                p.unit_type, p.product_type,
                COALESCE(c.name, 'عام') AS category,
                COALESCE(li.quantity, 0) AS front_display_stock,
                COALESCE(li.quantity, 0) AS stock_quantity
            FROM products p
            LEFT JOIN product_categories c ON p.category_id = c.id
            LEFT JOIN location_inventory li ON p.id = li.product_id 
                 AND li.location_id = (SELECT id FROM inventory_locations WHERE code = 'FRONT_DISPLAY' LIMIT 1)
            WHERE p.is_active = TRUE
            ORDER BY p.id ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/product-variants/:id', (req, res) => {
    res.json([]);
});

app.post('/api/stock-transfer', async (req, res) => {
    const { user_id, items, notes } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const locs = await client.query("SELECT id, code FROM inventory_locations WHERE code IN ('BACKROOM', 'FRONT_DISPLAY')");
        const backroom = locs.rows.find(l => l.code === 'BACKROOM').id;
        const frontDisplay = locs.rows.find(l => l.code === 'FRONT_DISPLAY').id;

        const transfer = await client.query(
            'INSERT INTO stock_transfers (source_location_id, destination_location_id, transferred_by_user_id, notes) VALUES ($1, $2, $3, $4) RETURNING id',
            [backroom, frontDisplay, user_id, notes || 'تحويل بضاعة للواجهة']
        );
        const transferId = transfer.rows[0].id;

        for (const item of items) {
            const avail = await client.query(
                'SELECT quantity FROM location_inventory WHERE product_id = $1 AND location_id = $2 FOR UPDATE',
                [item.product_id, backroom]
            );
            const currentBackroom = Number(avail.rows[0]?.quantity || 0);

            if (currentBackroom < Number(item.quantity)) {
                throw new Error(`الرصيد في المخزن الداخلي غير كافٍ للصنف #${item.product_id}`);
            }

            await client.query(
                'UPDATE location_inventory SET quantity = quantity - $1 WHERE product_id = $2 AND location_id = $3',
                [item.quantity, item.product_id, backroom]
            );

            await client.query(`
                INSERT INTO location_inventory (product_id, location_id, quantity)
                VALUES ($1, $2, $3)
                ON CONFLICT (product_id, location_id) 
                DO UPDATE SET quantity = location_inventory.quantity + EXCLUDED.quantity
            `, [item.product_id, frontDisplay, item.quantity]);

            await client.query(
                'INSERT INTO stock_transfer_items (transfer_id, product_id, quantity) VALUES ($1, $2, $3)',
                [transferId, item.product_id, item.quantity]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, transfer_id: transferId });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ============================================================================
// إتمام البيع وخصم الخامات
// ============================================================================
app.post('/api/checkout', async (req, res) => {
    const {
        shift_id,
        cashier_id,
        cart,
        order_mode,
        payment_type,
        staff_employee_id,
        tab_customer_name,
        tab_customer_phone,
        station_reference
    } = req.body;

    if (!cart || cart.length === 0) return res.status(400).json({ error: 'السلة فارغة' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const frontLoc = await client.query("SELECT id FROM inventory_locations WHERE code = 'FRONT_DISPLAY'");
        const frontLocationId = frontLoc.rows[0].id;

        let totalOrderAmount = 0;
        let totalOrderCost = 0;

        for (const item of cart) {
            const pRes = await client.query('SELECT * FROM products WHERE id = $1', [item.id]);
            const prod = pRes.rows[0];

            let unitCost = Number(prod.unit_cost_price);
            let unitPrice = (payment_type === 'STAFF_EXPENSE') ? unitCost : Number(prod.unit_selling_price);

            totalOrderAmount += unitPrice * item.qty;
            totalOrderCost += unitCost * item.qty;

            if (prod.product_type === 'DIRECT_UNIT') {
                const stockRes = await client.query(
                    'SELECT quantity FROM location_inventory WHERE product_id = $1 AND location_id = $2 FOR UPDATE',
                    [prod.id, frontLocationId]
                );
                const currentQty = Number(stockRes.rows[0]?.quantity || 0);
                if (currentQty < item.qty) {
                    throw new Error(`الكمية المتاحة من "${prod.name}" على الواجهة غير كافية (المتاح: ${currentQty})`);
                }
            }

            if (prod.product_type === 'PREPARED_DRINK' && order_mode === 'TAKEAWAY') {
                const cupBom = await client.query(
                    "SELECT ingredient_product_id, quantity_required FROM product_boms WHERE parent_product_id = $1 AND rule = 'TAKEAWAY_ONLY'",
                    [prod.id]
                );
                for (const b of cupBom.rows) {
                    const cupStock = await client.query(
                        'SELECT quantity FROM location_inventory WHERE product_id = $1 AND location_id = $2 FOR UPDATE',
                        [b.ingredient_product_id, frontLocationId]
                    );
                    const cupsAvailable = Number(cupStock.rows[0]?.quantity || 0);
                    if (cupsAvailable < (b.quantity_required * item.qty)) {
                        throw new Error('الأكواب الورقية غير كافية لتنفيذ الطلب دليفري/تيك أواي');
                    }
                }
            }
        }

        const orderInsert = await client.query(`
            INSERT INTO orders (shift_id, cashier_id, order_mode, payment_type, total_amount, total_cost, station_reference, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'COMPLETED') RETURNING id
        `, [shift_id, cashier_id, order_mode || 'TAKEAWAY', payment_type || 'CASH', totalOrderAmount, totalOrderCost, station_reference || 'الكاشير المباشر']);
        const orderId = orderInsert.rows[0].id;

        for (const item of cart) {
            const pRes = await client.query('SELECT * FROM products WHERE id = $1', [item.id]);
            const prod = pRes.rows[0];

            let unitCost = Number(prod.unit_cost_price);
            let unitPrice = (payment_type === 'STAFF_EXPENSE') ? unitCost : Number(prod.unit_selling_price);

            await client.query(`
                INSERT INTO order_items (order_id, product_id, quantity, unit_price, unit_cost, subtotal_price, subtotal_cost)
                VALUES ($1, $2, $3, $4, $5, $3 * $4, $3 * $5)
            `, [orderId, prod.id, item.qty, unitPrice, unitCost]);

            if (prod.product_type === 'DIRECT_UNIT') {
                await client.query(`
                    UPDATE location_inventory SET quantity = quantity - $1
                    WHERE product_id = $2 AND location_id = $3
                `, [item.qty, prod.id, frontLocationId]);
            } else if (prod.product_type === 'PREPARED_DRINK') {
                const boms = await client.query('SELECT * FROM product_boms WHERE parent_product_id = $1', [prod.id]);
                for (const bom of boms.rows) {
                    const shouldDeduct = (bom.rule === 'ALWAYS') || (bom.rule === 'TAKEAWAY_ONLY' && order_mode === 'TAKEAWAY');
                    if (shouldDeduct) {
                        await client.query(`
                            UPDATE location_inventory SET quantity = GREATEST(0, quantity - $1)
                            WHERE product_id = $2 AND location_id = $3
                        `, [bom.quantity_required * item.qty, bom.ingredient_product_id, frontLocationId]);
                    }
                }
            }
        }

        if (payment_type === 'STAFF_EXPENSE') {
            await client.query(`
                INSERT INTO staff_consumptions (order_id, shift_id, employee_id, total_cost_charged)
                VALUES ($1, $2, $3, $4)
            `, [orderId, shift_id, staff_employee_id, totalOrderCost]);
        } else if (payment_type === 'CREDIT_TAB') {
            let tabId;
            const existingTab = await client.query(
                "SELECT id FROM customer_tabs WHERE phone = $1 AND status != 'SETTLED'",
                [tab_customer_phone]
            );

            if (existingTab.rows.length > 0) {
                tabId = existingTab.rows[0].id;
                await client.query(
                    'UPDATE customer_tabs SET total_debt = total_debt + $1, remaining_balance = remaining_balance + $1 WHERE id = $2',
                    [totalOrderAmount, tabId]
                );
            } else {
                const newTab = await client.query(`
                    INSERT INTO customer_tabs (customer_name, phone, total_debt, remaining_balance, status, origin_shift_id)
                    VALUES ($1, $2, $3, $3, 'UNPAID', $4) RETURNING id
                `, [tab_customer_name, tab_customer_phone, totalOrderAmount, shift_id]);
                tabId = newTab.rows[0].id;
            }

            await client.query('INSERT INTO customer_tab_orders (tab_id, order_id) VALUES ($1, $2)', [tabId, orderId]);
        }

        await client.query('COMMIT');
        res.json({ success: true, order_id: orderId, total: totalOrderAmount });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ملاحظات الشيفت
app.post('/api/shift-notes', async (req, res) => {
    const { shift_id, notes } = req.body;
    try {
        await pool.query('UPDATE shifts SET notes = $1 WHERE id = $2', [notes, shift_id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/shift-notes/:shift_id', async (req, res) => {
    try {
        const result = await pool.query('SELECT notes FROM shifts WHERE id = $1', [req.params.shift_id]);
        res.json({ notes: result.rows[0]?.notes || '' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('*', (req, res) => {
    const indexPath = fs.existsSync(path.join(__dirname, 'public', 'index.html'))
        ? path.join(__dirname, 'public', 'index.html')
        : path.join(__dirname, 'index.html');
    res.sendFile(indexPath);
});

app.listen(PORT, () => console.log(`🚀 النظام يعمل بنجاح على المنفذ ${PORT} - حواسب كافيه`));
