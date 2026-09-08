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

// Auto-run schema.sql on start if tables are missing
async function initDB() {
    try {
        await pool.query(`
            -- 1. جدول الموظفين والمستخدمين
            CREATE TABLE IF NOT EXISTS employees (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                pin_code VARCHAR(12) NOT NULL,
                full_name VARCHAR(100) NOT NULL,
                phone VARCHAR(20),
                role VARCHAR(20) NOT NULL DEFAULT 'staff',
                current_shortage_debt NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            -- 2. مواقع المخزون (داخلي وخارجي)
            CREATE TABLE IF NOT EXISTS inventory_locations (
                id SERIAL PRIMARY KEY,
                code VARCHAR(30) UNIQUE NOT NULL,
                name VARCHAR(100) NOT NULL,
                description TEXT
            );

            -- 3. أقسام المنتجات
            CREATE TABLE IF NOT EXISTS product_categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) UNIQUE NOT NULL
            );

            -- 4. المنتجات
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

            -- 5. أرصدة المخزون بالمواقع
            CREATE TABLE IF NOT EXISTS location_inventory (
                product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                location_id INT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
                quantity NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (product_id, location_id)
            );

            -- 6. تركيبات الخامات (BOM)
            CREATE TABLE IF NOT EXISTS product_boms (
                id SERIAL PRIMARY KEY,
                parent_product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                ingredient_product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                quantity_required NUMERIC(10, 4) NOT NULL,
                rule VARCHAR(30) NOT NULL DEFAULT 'ALWAYS'
            );

            -- 7. الشيفتات وإقفالها
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

            CREATE TABLE IF NOT EXISTS glass_equipment_audits (
                id SERIAL PRIMARY KEY,
                shift_id INT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
                quota_total INT NOT NULL DEFAULT 15,
                clean_count INT NOT NULL DEFAULT 0,
                in_use_count INT NOT NULL DEFAULT 0,
                broken_count INT NOT NULL DEFAULT 0,
                verified_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            -- 8. الطلبات والمبيعات
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
                unit_cost NUMERIC(10, 4) NOT NULL
            );

            CREATE TABLE IF NOT EXISTS staff_consumptions (
                id SERIAL PRIMARY KEY,
                order_id INT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
                shift_id INT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
                employee_id INT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
                total_cost_charged NUMERIC(10, 2) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            -- 9. الحسابات الآجلة (الشكك)
            CREATE TABLE IF NOT EXISTS customer_tabs (
                id SERIAL PRIMARY KEY,
                customer_name VARCHAR(100) NOT NULL,
                phone VARCHAR(20) NOT NULL,
                total_debt NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                amount_paid NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
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
                reason VARCHAR(50) NOT NULL,
                logged_by_user_id INT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
                notes TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            -- 10. إدخال الموظفين الافتراضيين
            INSERT INTO employees (id, username, pin_code, full_name, phone, role) VALUES
            (1, 'admin',  '1234', 'مدير النظام',    '01000000000', 'admin'),
            (2, 'omar',   '1111', 'عمر - وردية 3',   '01100000001', 'cashier'),
            (3, 'tareq',  '2222', 'طارق - وردية 1',  '01200000002', 'cashier'),
            (4, 'antry',  '3333', 'عنتري - وردية 2', '01500000003', 'cashier')
            (5, 'test',  'test', 'test', '01500000003', 'cashier')
            ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, pin_code = EXCLUDED.pin_code;

            -- 11. إدخال المواقع الافتراضية
            INSERT INTO inventory_locations (id, code, name, description) VALUES
            (1, 'BACKROOM',      'المخزن الداخلي', 'مخزن الاحتياطي الرئيسي'),
            (2, 'FRONT_DISPLAY', 'الواجهة والمعروض', 'بضاعة البيع المباشر')
            ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code;

            -- 12. إدخال الأقسام الافتراضية
            INSERT INTO product_categories (id, name) VALUES
            (1, 'مشروبات ساخنة'), (2, 'مشروبات غازية وساقعة'), (3, 'شيبسيات وسناكس'), (4, 'خامات ومواد تغليف')
            ON CONFLICT (id) DO NOTHING;

            -- ضبط الترقيم التلقائي
            SELECT setval(pg_get_serial_sequence('employees', 'id'), COALESCE((SELECT MAX(id) FROM employees), 1));
            SELECT setval(pg_get_serial_sequence('inventory_locations', 'id'), COALESCE((SELECT MAX(id) FROM inventory_locations), 1));
            SELECT setval(pg_get_serial_sequence('product_categories', 'id'), COALESCE((SELECT MAX(id) FROM product_categories), 1));
        `);
        console.log('✅ تم إعداد وتحديث قاعدة البيانات بنجاح.');
    } catch (err) {
        console.error('❌ خطأ في إعداد قاعدة البيانات:', err.message);
    }
}
initDB();

// ============================================================================
// 1. AUTHENTICATION & EMPLOYEES
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
// 2. SHIFTS & DUAL-PIN HANDOVER
// ============================================================================
app.post('/api/start-shift', async (req, res) => {
    const { shift_number, cashier_id, starting_float } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if an open shift already exists
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

        // Auto-lock opening baseline: Duplicate the previous shift's closing counts as this shift's opening counts
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

// Shift Summary Metrics
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

// Dual-PIN Shift Handover & Reconciliation
app.post('/api/shift-reconciliation', async (req, res) => {
    const {
        shift_id,
        outgoing_cashier_id,
        outgoing_pin,
        incoming_cashier_id,
        incoming_pin,
        physical_cash,
        glass_audit, // { clean, in_use, broken }
        inventory_counts // Array of { product_id, location_id, physical_count }
    } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Dual-PIN Verification
        const outAuth = await client.query('SELECT id FROM employees WHERE id = $1 AND pin_code = $2', [outgoing_cashier_id, outgoing_pin]);
        if (outAuth.rows.length === 0) throw new Error('رمز PIN الخاص بالكاشير الحالي غير صحيح');

        const inAuth = await client.query('SELECT id FROM employees WHERE id = $1 AND pin_code = $2', [incoming_cashier_id, incoming_pin]);
        if (inAuth.rows.length === 0) throw new Error('رمز PIN الخاص بالكاشير المستلم غير صحيح');

        // 2. Fetch Expected Metrics
        const shiftRes = await client.query('SELECT starting_cash_float FROM shifts WHERE id = $1', [shift_id]);
        const startingFloat = Number(shiftRes.rows[0].starting_cash_float);

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

        // 3. Update Cashier Debt if shortage occurs
        if (isShortage && shortageAmount > 0) {
            await client.query(
                'UPDATE employees SET current_shortage_debt = current_shortage_debt + $1 WHERE id = $2',
                [shortageAmount, outgoing_cashier_id]
            );
        }

        // 4. Save Reconciliation Record
        await client.query(`
            INSERT INTO shift_reconciliations (
                shift_id, expected_cash, actual_physical_cash, petty_expenses_total,
                tab_settlements_total, cash_sales_total, cash_variance, is_shortage,
                shortage_amount, outgoing_pin_verified, incoming_pin_verified
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, TRUE)
        `, [shift_id, expectedCash, actualCash, pettyCash, tabIncome, cashSales, variance, isShortage, shortageAmount]);

        // 5. Equipment Audit (15 Glass Cups)
        if (glass_audit) {
            await client.query(`
                INSERT INTO glass_equipment_audits (shift_id, clean_count, in_use_count, broken_count)
                VALUES ($1, $2, $3, $4)
            `, [shift_id, glass_audit.clean || 0, glass_audit.in_use || 0, glass_audit.broken || 0]);
        }

        // 6. Lock in Closing Inventory Counts
        if (Array.isArray(inventory_counts)) {
            for (const item of inventory_counts) {
                const sysCount = await client.query(
                    'SELECT quantity FROM location_inventory WHERE product_id = $1 AND location_id = $2',
                    [item.product_id, item.location_id]
                );
                const currentSystem = Number(sysCount.rows[0]?.quantity || 0);

                await client.query(`
                    INSERT INTO shift_inventory_counts (shift_id, product_id, location_id, count_type, physical_count, system_expected_count)
                    VALUES ($1, $2, $3, 'CLOSING', $4, $5)
                `, [shift_id, item.product_id, item.location_id, item.physical_count, currentSystem]);
            }
        }

        // 7. Close Active Shift & Link Incoming Cashier
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
// 3. TWO-TIER INVENTORY & TRANSFERS
// ============================================================================
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                p.id, p.sku, p.name, p.unit_cost_price, p.unit_selling_price, 
                p.unit_type, p.product_type, c.name as category,
                COALESCE(li.quantity, 0) as front_display_stock
            FROM products p
            LEFT JOIN product_categories c ON p.category_id = c.id
            LEFT JOIN location_inventory li ON p.id = li.product_id 
                 AND li.location_id = (SELECT id FROM inventory_locations WHERE code = 'FRONT_DISPLAY')
            WHERE p.is_active = TRUE
            ORDER BY p.id ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Transfer from Backroom Storage to Front Display
app.post('/api/stock-transfer', async (req, res) => {
    const { user_id, items, notes } = req.body; // items: [{ product_id, quantity }]
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

            // Deduct Backroom
            await client.query(
                'UPDATE location_inventory SET quantity = quantity - $1 WHERE product_id = $2 AND location_id = $3',
                [item.quantity, item.product_id, backroom]
            );

            // Add to Front Display
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

// Two-Tier Financial Stock Valuation
app.get('/api/inventory/valuation', async (req, res) => {
    try {
        const query = `
            SELECT 
                l.code, l.name as location_name,
                COALESCE(SUM(li.quantity * p.unit_cost_price), 0) as total_cost_value,
                COALESCE(SUM(li.quantity * p.unit_selling_price), 0) as total_retail_value
            FROM inventory_locations l
            LEFT JOIN location_inventory li ON l.id = li.location_id
            LEFT JOIN products p ON li.product_id = p.id
            GROUP BY l.id, l.code, l.name
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// 4. POS CHECKOUT (BOM DINE-IN/TAKEAWAY & PAYMENT MODES)
// ============================================================================
app.post('/api/checkout', async (req, res) => {
    const {
        shift_id,
        cashier_id,
        cart,
        order_mode, // 'DINE_IN' or 'TAKEAWAY'
        payment_type, // 'CASH', 'CREDIT_TAB', 'STAFF_EXPENSE'
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

        // 1. Calculate and validate Front Display stock
        for (const item of cart) {
            const pRes = await client.query('SELECT * FROM products WHERE id = $1', [item.id]);
            const prod = pRes.rows[0];

            let unitCost = Number(prod.unit_cost_price);
            let unitPrice = (payment_type === 'STAFF_EXPENSE') ? unitCost : Number(prod.unit_selling_price);

            totalOrderAmount += unitPrice * item.qty;
            totalOrderCost += unitCost * item.qty;

            // Check stock if DIRECT_UNIT
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

            // Check paper cups if TAKEAWAY
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

        // 2. Create Order Record
        const orderInsert = await client.query(`
            INSERT INTO orders (shift_id, cashier_id, order_mode, payment_type, total_amount, total_cost, station_reference, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'COMPLETED') RETURNING id
        `, [shift_id, cashier_id, order_mode || 'TAKEAWAY', payment_type || 'CASH', totalOrderAmount, totalOrderCost, station_reference || 'الكاشير المباشر']);
        const orderId = orderInsert.rows[0].id;

        // 3. Deduct Inventory & Process BOM Recipes
        for (const item of cart) {
            const pRes = await client.query('SELECT * FROM products WHERE id = $1', [item.id]);
            const prod = pRes.rows[0];

            let unitCost = Number(prod.unit_cost_price);
            let unitPrice = (payment_type === 'STAFF_EXPENSE') ? unitCost : Number(prod.unit_selling_price);

            await client.query(`
                INSERT INTO order_items (order_id, product_id, quantity, unit_price, unit_cost)
                VALUES ($1, $2, $3, $4, $5)
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

        // 4. Branch Payment-Specific Handlers
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
                    'UPDATE customer_tabs SET total_debt = total_debt + $1 WHERE id = $2',
                    [totalOrderAmount, tabId]
                );
            } else {
                const newTab = await client.query(`
                    INSERT INTO customer_tabs (customer_name, phone, total_debt, status, origin_shift_id)
                    VALUES ($1, $2, $3, 'UNPAID', $4) RETURNING id
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

// ============================================================================
// 5. CUSTOMER TABS & SETTLEMENTS
// ============================================================================
app.get('/api/customer-tabs', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM customer_tabs WHERE status != 'SETTLED' ORDER BY id DESC");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/customer-tabs/settle', async (req, res) => {
    const { tab_id, shift_id, cashier_id, amount_paid } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(`
            INSERT INTO customer_tab_payments (tab_id, collected_in_shift_id, cashier_id, amount_paid)
            VALUES ($1, $2, $3, $4)
        `, [tab_id, shift_id, cashier_id, amount_paid]);

        const tabRes = await client.query('SELECT total_debt, amount_paid FROM customer_tabs WHERE id = $1 FOR UPDATE', [tab_id]);
        const tab = tabRes.rows[0];
        const newPaid = Number(tab.amount_paid) + Number(amount_paid);
        const newStatus = (newPaid >= Number(tab.total_debt)) ? 'SETTLED' : 'PARTIALLY_PAID';

        await client.query('UPDATE customer_tabs SET amount_paid = $1, status = $2 WHERE id = $3', [newPaid, newStatus, tab_id]);

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ============================================================================
// 6. PETTY CASH & WASTAGE
// ============================================================================
app.post('/api/petty-cash', async (req, res) => {
    const { shift_id, employee_id, amount, reason, receipt_reference } = req.body;
    try {
        await pool.query(
            'INSERT INTO petty_cash_expenses (shift_id, employee_id, amount, reason, receipt_reference) VALUES ($1, $2, $3, $4, $5)',
            [shift_id, employee_id, amount, reason, receipt_reference || null]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/wastage', async (req, res) => {
    const { shift_id, product_id, location_id, quantity, reason, user_id, notes } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const prod = await client.query('SELECT unit_cost_price FROM products WHERE id = $1', [product_id]);
        const unitCost = Number(prod.rows[0]?.unit_cost_price || 0);

        await client.query(`
            INSERT INTO wastage_logs (shift_id, product_id, location_id, quantity, unit_cost_price, reason, logged_by_user_id, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [shift_id, product_id, location_id, quantity, unitCost, reason, user_id, notes]);

        await client.query(`
            UPDATE location_inventory SET quantity = GREATEST(0, quantity - $1)
            WHERE product_id = $2 AND location_id = $3
        `, [quantity, product_id, location_id]);

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.get('*', (req, res) => {
    const indexPath = fs.existsSync(path.join(__dirname, 'public', 'index.html'))
        ? path.join(__dirname, 'public', 'index.html')
        : path.join(__dirname, 'index.html');
    res.sendFile(indexPath);
});

app.listen(PORT, () => console.log(`🚀 النظام يعمل بنجاح على المنفذ ${PORT} - حواسب كافيه`));
