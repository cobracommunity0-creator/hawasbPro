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

// Database Architecture & Schema Migrations
async function initDB() {
    try {
        // Core entities
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

            CREATE TABLE IF NOT EXISTS inventory_locations (
                id SERIAL PRIMARY KEY,
                code VARCHAR(30) UNIQUE NOT NULL,
                name VARCHAR(100) NOT NULL,
                description TEXT
            );

            CREATE TABLE IF NOT EXISTS product_categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) UNIQUE NOT NULL
            );

            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                sku VARCHAR(50) UNIQUE,
                name VARCHAR(150) NOT NULL,
                category VARCHAR(255) DEFAULT 'عام',
                category_id INT REFERENCES product_categories(id) ON DELETE SET NULL,
                unit_cost_price NUMERIC(10, 4) DEFAULT 0,
                cost_price NUMERIC DEFAULT 0,
                unit_selling_price NUMERIC(10, 2) DEFAULT 0,
                selling_price NUMERIC DEFAULT 0,
                stock_quantity NUMERIC DEFAULT 0,
                unit_type VARCHAR(50) DEFAULT 'قطعة',
                is_drink INT DEFAULT 0,
                product_type VARCHAR(30) DEFAULT 'DIRECT_UNIT',
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS location_inventory (
                product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                location_id INT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
                quantity NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (product_id, location_id)
            );

            CREATE TABLE IF NOT EXISTS stock_transfers (
                id SERIAL PRIMARY KEY,
                source_location_id INT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
                destination_location_id INT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
                transferred_by_user_id INT REFERENCES employees(id) ON DELETE SET NULL,
                notes TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS stock_transfer_items (
                id SERIAL PRIMARY KEY,
                transfer_id INT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
                product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                quantity NUMERIC(12, 4) NOT NULL
            );

            CREATE TABLE IF NOT EXISTS product_boms (
                id SERIAL PRIMARY KEY,
                parent_product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                ingredient_product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                quantity_required NUMERIC(10, 4) NOT NULL,
                rule VARCHAR(30) NOT NULL DEFAULT 'ALWAYS'
            );

            CREATE TABLE IF NOT EXISTS shifts (
                id SERIAL PRIMARY KEY,
                shift_number SMALLINT NOT NULL DEFAULT 1,
                shift_date DATE NOT NULL DEFAULT CURRENT_DATE,
                outgoing_cashier_id INT REFERENCES employees(id) ON DELETE SET NULL,
                incoming_cashier_id INT REFERENCES employees(id) ON DELETE SET NULL,
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

            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                shift_id INT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
                cashier_id INT REFERENCES employees(id) ON DELETE SET NULL,
                order_mode VARCHAR(20) NOT NULL DEFAULT 'TAKEAWAY',
                payment_type VARCHAR(20) NOT NULL DEFAULT 'CASH',
                total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                total_cost NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
                status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
                station_reference VARCHAR(150) DEFAULT 'الكاشير المباشر',
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
                employee_id INT REFERENCES employees(id) ON DELETE SET NULL,
                beneficiary_name VARCHAR(150) NOT NULL DEFAULT 'موظف',
                total_cost_charged NUMERIC(10, 2) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

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
                cashier_id INT REFERENCES employees(id) ON DELETE SET NULL,
                amount_paid NUMERIC(10, 2) NOT NULL,
                payment_method VARCHAR(20) NOT NULL DEFAULT 'CASH',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Migration safety checks
        await pool.query(`
            ALTER TABLE staff_consumptions ADD COLUMN IF NOT EXISTS beneficiary_name VARCHAR(150) DEFAULT 'موظف';
            ALTER TABLE staff_consumptions ALTER COLUMN employee_id DROP NOT NULL;
            ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
            UPDATE products SET is_active = TRUE WHERE is_active IS NULL;
        `);

        // Seed default locations
        await pool.query(`
            INSERT INTO inventory_locations (code, name, description) VALUES
            ('BACKROOM', 'المخزن الداخلي', 'مخزن الاحتياطي والتوريدات الرئيسي'),
            ('FRONT_DISPLAY', 'الواجهة والمعروض', 'بضاعة البيع الفوري بالكاشير')
            ON CONFLICT (code) DO NOTHING;

            INSERT INTO employees (username, pin_code, full_name, phone, role) VALUES
            ('admin', '1234', 'مدير النظام', '01000000000', 'admin'),
            ('omar', '1111', 'عمر - وردية 1', '01100000001', 'cashier'),
            ('tareq', '2222', 'طارق - وردية 2', '01200000002', 'cashier'),
            ('antry', '3333', 'عنتري - وردية 3', '01500000003', 'cashier')
            ON CONFLICT (username) DO NOTHING;
        `);
        await pool.query('ALTER TABLE customer_tabs ALTER COLUMN phone DROP NOT NULL;');
        console.log('✅ تم إعداد وفحص هيكل قاعدة البيانات بنجاح.');
    } catch (err) {
        console.error('❌ خطأ في إعداد قاعدة البيانات:', err.message);
    }
}
initDB();

// ============================================================================
// AUTH & EMPLOYEES
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

        const shiftRes = await pool.query("SELECT * FROM shifts WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1");
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
// PRODUCTS & ACCURATE INVENTORY VALUATION
// ============================================================================
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                p.id, 
                COALESCE(p.sku, '') AS sku, 
                p.name, 
                COALESCE(p.unit_cost_price, p.cost_price, 0) AS unit_cost_price,
                COALESCE(p.cost_price, p.unit_cost_price, 0) AS cost_price,
                COALESCE(p.unit_selling_price, p.selling_price, 0) AS unit_selling_price,
                COALESCE(p.selling_price, p.unit_selling_price, 0) AS selling_price,
                COALESCE(p.unit_type, 'قطعة') AS unit_type,
                COALESCE(p.product_type, CASE WHEN p.is_drink = 1 THEN 'PREPARED_DRINK' ELSE 'DIRECT_UNIT' END, 'DIRECT_UNIT') AS product_type,
                COALESCE(c.name, p.category, 'عام') AS category,
                COALESCE(li_front.quantity, 0) AS front_display_stock,
                COALESCE(li_front.quantity, 0) AS stock_quantity,
                COALESCE(li_back.quantity, 0) AS backroom_stock,
                COALESCE(p.is_drink, CASE WHEN p.product_type = 'PREPARED_DRINK' THEN 1 ELSE 0 END, 0) AS is_drink
            FROM products p
            LEFT JOIN product_categories c ON p.category_id = c.id
            LEFT JOIN location_inventory li_front ON p.id = li_front.product_id 
                 AND li_front.location_id = (SELECT id FROM inventory_locations WHERE code = 'FRONT_DISPLAY' LIMIT 1)
            LEFT JOIN location_inventory li_back ON p.id = li_back.product_id 
                 AND li_back.location_id = (SELECT id FROM inventory_locations WHERE code = 'BACKROOM' LIMIT 1)
            WHERE p.is_active = TRUE
            ORDER BY p.id ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/product-variants/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM product_variants WHERE product_id = $1 ORDER BY id ASC', [req.params.id]);
        res.json(result.rows);
    } catch (err) {
        res.json([]);
    }
});

// Admin Dashboard Aggregation: Accurate Physical Restock Cost Excludes Virtual Prepared Drinks
// لوحة الإدارة مع احتساب أرباح اليوم وتكلفة البضاعة بدقة تامة
// جلب الأصناف الحرجة المطلوب جردها سريعاً عند كل تسليم (التلاجة والإندومي)
app.get('/api/critical-handover-items', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                p.id, p.name, p.unit_type,
                COALESCE(c.name, p.category, 'عام') as category,
                COALESCE(li.quantity, 0) as expected_stock
            FROM products p
            LEFT JOIN product_categories c ON p.category_id = c.id
            LEFT JOIN location_inventory li ON p.id = li.product_id 
                 AND li.location_id = (SELECT id FROM inventory_locations WHERE code = 'FRONT_DISPLAY' LIMIT 1)
            WHERE p.is_active = TRUE 
              AND (
                  c.name LIKE '%ساقعة%' OR p.category LIKE '%ساقعة%' 
                  OR p.name LIKE '%اندومي%' OR p.name LIKE '%إندومي%'
                  OR p.name LIKE '%كولا%' OR p.name LIKE '%مياه%'
              )
            ORDER BY p.id ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// تسليم الوردية السريع (بدون PIN نهائياً + تسجيل جرد التلاجة والإندومي)
app.post('/api/shift-reconciliation', async (req, res) => {
    const { shift_id, outgoing_cashier_id, incoming_cashier_id, physical_cash, counts, notes } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const shiftRes = await client.query('SELECT starting_cash_float FROM shifts WHERE id = $1', [shift_id]);
        const startingFloat = Number(shiftRes.rows[0]?.starting_cash_float || 0);

        const sales = await client.query("SELECT COALESCE(SUM(total_amount), 0) as cash_total FROM orders WHERE shift_id = $1 AND payment_type = 'CASH' AND status = 'COMPLETED'", [shift_id]);
        const cashSales = Number(sales.rows[0].cash_total);
        const expectedCash = startingFloat + cashSales;

        const actualCash = Number(physical_cash) || 0;
        const variance = actualCash - expectedCash;
        const isShortage = variance < 0;
        const shortageAmount = isShortage ? Math.abs(variance) : 0;

        // تسجيل المطابقة المالية
        await client.query(`
            INSERT INTO shift_reconciliations (
                shift_id, expected_cash, actual_physical_cash, cash_sales_total,
                cash_variance, is_shortage, shortage_amount, outgoing_pin_verified, incoming_pin_verified
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, TRUE)
            ON CONFLICT (shift_id) DO UPDATE SET
                expected_cash = EXCLUDED.expected_cash,
                actual_physical_cash = EXCLUDED.actual_physical_cash,
                cash_sales_total = EXCLUDED.cash_sales_total,
                cash_variance = EXCLUDED.cash_variance,
                is_shortage = EXCLUDED.is_shortage,
                shortage_amount = EXCLUDED.shortage_amount
        `, [shift_id, expectedCash, actualCash, cashSales, variance, isShortage, shortageAmount]);

        // تسجيل جرد أصناف التلاجة والإندومي ومعرفة الفروقات
        if (Array.isArray(counts)) {
            const frontLoc = await client.query("SELECT id FROM inventory_locations WHERE code = 'FRONT_DISPLAY' LIMIT 1");
            const frontLocId = frontLoc.rows[0].id;

            for (const item of counts) {
                const physicalQty = Number(item.physical_count) || 0;
                const expectedQty = Number(item.expected_count) || 0;
                const diff = physicalQty - expectedQty;

                await client.query(`
                    INSERT INTO shift_inventory_counts (shift_id, product_id, location_id, count_type, physical_count, system_expected_count, variance_qty)
                    VALUES ($1, $2, $3, 'CLOSING', $4, $5, $6)
                    ON CONFLICT (shift_id, product_id, location_id, count_type) 
                    DO UPDATE SET physical_count = EXCLUDED.physical_count, variance_qty = EXCLUDED.variance_qty
                `, [shift_id, item.product_id, frontLocId, physicalQty, expectedQty, diff]);
            }
        }

        // إغلاق الوردية وتحديث الكاشير المستلم
        await client.query(`
            UPDATE shifts 
            SET status = 'CLOSED', end_time = NOW(), incoming_cashier_id = $1, notes = COALESCE($2, notes)
            WHERE id = $3
        `, [incoming_cashier_id || null, notes || null, shift_id]);

        await client.query('COMMIT');
        res.json({ success: true, variance, is_shortage: isShortage, shortage_amount: shortageAmount });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Admin Product Save / Edit
app.post('/api/products', async (req, res) => {
    const { id, name, category, cost_price, selling_price, stock_quantity, backroom_stock, unit_type, is_drink } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let catId = null;
        if (category) {
            const catRes = await client.query(
                'INSERT INTO product_categories (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id',
                [category.trim()]
            );
            catId = catRes.rows[0].id;
        }

        const pType = is_drink ? 'PREPARED_DRINK' : 'DIRECT_UNIT';
        let prodId = id;

        if (id) {
            await client.query(`
                UPDATE products 
                SET name=$1, category_id=COALESCE($2, category_id), category=COALESCE($3, category),
                    unit_cost_price=$4, cost_price=$4, 
                    unit_selling_price=$5, selling_price=$5, 
                    unit_type=$6, product_type=$7, is_drink=$8
                WHERE id=$9
            `, [name.trim(), catId, category, cost_price || 0, selling_price || 0, unit_type || 'قطعة', pType, is_drink ? 1 : 0, id]);
        } else {
            const pRes = await client.query(`
                INSERT INTO products (name, category_id, category, unit_cost_price, cost_price, unit_selling_price, selling_price, unit_type, product_type, is_drink)
                VALUES ($1, $2, $3, $4, $4, $5, $5, $6, $7, $8) RETURNING id
            `, [name.trim(), catId, category, cost_price || 0, selling_price || 0, unit_type || 'قطعة', pType, is_drink ? 1 : 0]);
            prodId = pRes.rows[0].id;
        }

        // Set Front Display inventory
        const frontLoc = await client.query("SELECT id FROM inventory_locations WHERE code = 'FRONT_DISPLAY'");
        if (frontLoc.rows.length > 0) {
            await client.query(`
                INSERT INTO location_inventory (product_id, location_id, quantity)
                VALUES ($1, $2, $3)
                ON CONFLICT (product_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity
            `, [prodId, frontLoc.rows[0].id, stock_quantity || 0]);
        }

        // Set Backroom inventory if provided
        const backLoc = await client.query("SELECT id FROM inventory_locations WHERE code = 'BACKROOM'");
        if (backLoc.rows.length > 0 && backroom_stock !== undefined) {
            await client.query(`
                INSERT INTO location_inventory (product_id, location_id, quantity)
                VALUES ($1, $2, $3)
                ON CONFLICT (product_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity
            `, [prodId, backLoc.rows[0].id, backroom_stock || 0]);
        }

        await client.query('COMMIT');
        res.json({ success: true, id: prodId });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.delete('/api/products/:id', async (req, res) => {
    try {
        await pool.query('UPDATE products SET is_active = FALSE WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Replenish / Transfer Stock: Move items from Backroom to Front Display
app.post('/api/stock-transfer', async (req, res) => {
    const { product_id, quantity, user_id, notes } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const locs = await client.query("SELECT id, code FROM inventory_locations WHERE code IN ('BACKROOM', 'FRONT_DISPLAY')");
        const backroom = locs.rows.find(l => l.code === 'BACKROOM').id;
        const frontDisplay = locs.rows.find(l => l.code === 'FRONT_DISPLAY').id;

        const qty = Number(quantity);
        if (qty <= 0) throw new Error('الكمية المحولة غير صحيحة');

        const avail = await client.query('SELECT quantity FROM location_inventory WHERE product_id = $1 AND location_id = $2 FOR UPDATE', [product_id, backroom]);
        const currentBackroom = Number(avail.rows[0]?.quantity || 0);

        if (currentBackroom < qty) {
            throw new Error(`الكمية بالمخزن الاحتياطي غير كافية (المتاح بالمخزن: ${currentBackroom})`);
        }

        await client.query('UPDATE location_inventory SET quantity = quantity - $1 WHERE product_id = $2 AND location_id = $3', [qty, product_id, backroom]);
        await client.query(`
            INSERT INTO location_inventory (product_id, location_id, quantity) VALUES ($1, $2, $3)
            ON CONFLICT (product_id, location_id) DO UPDATE SET quantity = location_inventory.quantity + EXCLUDED.quantity
        `, [product_id, frontDisplay, qty]);

        const transfer = await client.query(
            'INSERT INTO stock_transfers (source_location_id, destination_location_id, transferred_by_user_id, notes) VALUES ($1, $2, $3, $4) RETURNING id',
            [backroom, frontDisplay, user_id || null, notes || 'تغذية الواجهة من المخزن']
        );
        await client.query('INSERT INTO stock_transfer_items (transfer_id, product_id, quantity) VALUES ($1, $2, $3)', [transfer.rows[0].id, product_id, qty]);

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
// POS CHECKOUT & STAFF BENEFICIARIES
// ============================================================================
app.post('/api/checkout', async (req, res) => {
    const {
        shift_id,
        cashier_id,
        cart,
        order_mode,
        payment_type,
        staff_employee_id,
        staff_beneficiary_name,
        tab_customer_name,
        tab_customer_phone,
        station_reference,
        paid_amount
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

            let unitCost = Number(prod.unit_cost_price || prod.cost_price || 0);
            let unitPrice = (payment_type === 'STAFF_EXPENSE') ? unitCost : Number(prod.unit_selling_price || prod.selling_price || 0);

            totalOrderAmount += unitPrice * item.qty;
            totalOrderCost += unitCost * item.qty;

            // التحقق من رصيد بضاعة الواجهة
            if (prod.product_type === 'DIRECT_UNIT') {
                const stockRes = await client.query(
                    'SELECT quantity FROM location_inventory WHERE product_id = $1 AND location_id = $2 FOR UPDATE',
                    [prod.id, frontLocationId]
                );
                const currentQty = Number(stockRes.rows[0]?.quantity || 0);
                if (currentQty < item.qty) {
                    throw new Error(`الكمية المتاحة من "${prod.name}" بالواجهة غير كافية (المتاح: ${currentQty})`);
                }
            }

            // التحقق من الأكواب الورقية في حالة التيك أواي
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
                        throw new Error('الأكواب الورقية غير كافية بالواجهة لتنفيذ طلب التيك أواي');
                    }
                }
            }
        }

        const paid = Number(paid_amount) || totalOrderAmount;
        let calculatedTip = (paid > totalOrderAmount && totalOrderAmount > 0) ? (paid - totalOrderAmount) : 0;

        const orderInsert = await client.query(`
            INSERT INTO orders (shift_id, cashier_id, order_mode, payment_type, total_amount, total_cost, station_reference, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'COMPLETED') RETURNING id
        `, [shift_id, cashier_id, order_mode || 'TAKEAWAY', payment_type || 'CASH', totalOrderAmount, totalOrderCost, station_reference || 'الكاشير المباشر']);
        const orderId = orderInsert.rows[0].id;

        for (const item of cart) {
            const pRes = await client.query('SELECT * FROM products WHERE id = $1', [item.id]);
            const prod = pRes.rows[0];

            let unitCost = Number(prod.unit_cost_price || prod.cost_price || 0);
            let unitPrice = (payment_type === 'STAFF_EXPENSE') ? unitCost : Number(prod.unit_selling_price || prod.selling_price || 0);
            
            const subtotalPrice = Number(item.qty) * unitPrice;
            const subtotalCost = Number(item.qty) * unitCost;

            await client.query(`
                INSERT INTO order_items (order_id, product_id, quantity, unit_price, unit_cost, subtotal_price, subtotal_cost)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [orderId, prod.id, item.qty, unitPrice, unitCost, subtotalPrice, subtotalCost]);

            // خصم المخزون من الواجهة
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

        // استهلاك موظف أو مستفيد مخصص (مثل صاحب العمارة)
        if (payment_type === 'STAFF_EXPENSE') {
            const beneficiary = (staff_beneficiary_name && staff_beneficiary_name.trim()) 
                ? staff_beneficiary_name.trim() 
                : 'موظف';

            await client.query(`
                INSERT INTO staff_consumptions (order_id, shift_id, employee_id, beneficiary_name, total_cost_charged)
                VALUES ($1, $2, $3, $4, $5)
            `, [orderId, shift_id, staff_employee_id || null, beneficiary, totalOrderCost]);
        } else if (payment_type === 'CREDIT_TAB') {
            const custName = (tab_customer_name || '').trim();
            const custPhone = (tab_customer_phone || '').trim();

            let tabId;
            // البحث عن حساب العميل المفتوح بالاسم بدلاً من رقم الهاتف
            const existingTab = await client.query(
                "SELECT id FROM customer_tabs WHERE TRIM(LOWER(customer_name)) = TRIM(LOWER($1)) AND status != 'SETTLED' LIMIT 1",
                [custName]
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
                `, [custName, custPhone, totalOrderAmount, shift_id]);
                tabId = newTab.rows[0].id;
            }

            await client.query('INSERT INTO customer_tab_orders (tab_id, order_id) VALUES ($1, $2)', [tabId, orderId]);
        }

        await client.query('COMMIT');
        res.json({ success: true, order_id: orderId, total: totalOrderAmount, tip: calculatedTip });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Shifts & Reconciliations
app.post('/api/start-shift', async (req, res) => {
    const { shift_number, cashier_id, starting_float } = req.body;
    try {
        const openCheck = await pool.query("SELECT id FROM shifts WHERE status = 'OPEN' LIMIT 1");
        if (openCheck.rows.length > 0) return res.json({ shift_id: openCheck.rows[0].id });

        const newShift = await pool.query(
            `INSERT INTO shifts (shift_number, shift_date, outgoing_cashier_id, starting_cash_float, status) 
             VALUES ($1, CURRENT_DATE, $2, $3, 'OPEN') RETURNING id`,
            [shift_number || 1, cashier_id, starting_float || 0]
        );
        res.json({ shift_id: newShift.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
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
                COALESCE(SUM(CASE WHEN payment_type = 'VODAFONE_CASH' THEN total_amount ELSE 0 END), 0) as vf_sales,
                COALESCE(SUM(CASE WHEN payment_type = 'CREDIT_TAB' THEN total_amount ELSE 0 END), 0) as tab_sales,
                COALESCE(SUM(CASE WHEN payment_type = 'STAFF_EXPENSE' THEN total_cost ELSE 0 END), 0) as staff_costs,
                COALESCE(SUM(total_cost), 0) as total_cogs
            FROM orders WHERE shift_id = $1 AND status = 'COMPLETED'
        `, [shiftId]);

        res.json({
            starting_float: startingFloat,
            cash_sales: Number(salesRes.rows[0].cash_sales),
            vf_sales: Number(salesRes.rows[0].vf_sales),
            tab_credit_sales: Number(salesRes.rows[0].tab_sales),
            staff_expense_sales: Number(salesRes.rows[0].staff_costs),
            total_tips: 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// Cashier Shift Scratchpad
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

app.get('/api/admin/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, full_name, role, current_shortage_debt FROM employees WHERE is_active = TRUE ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/users', async (req, res) => {
    const { id, username, pin, role, full_name } = req.body;
    try {
        if (id) {
            if (pin && pin.trim() !== '') {
                await pool.query('UPDATE employees SET username=$1, pin_code=$2, role=$3, full_name=COALESCE($4, full_name) WHERE id=$5', [username, pin, role, full_name, id]);
            } else {
                await pool.query('UPDATE employees SET username=$1, role=$2, full_name=COALESCE($3, full_name) WHERE id=$4', [username, role, full_name, id]);
            }
            res.json({ message: 'تم تحديث بيانات المستخدم' });
        } else {
            const newEmp = await pool.query('INSERT INTO employees (username, pin_code, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id', [username, pin || '1234', full_name || username, role]);
            res.json({ id: newEmp.rows[0].id });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/users/:id', async (req, res) => {
    try {
        await pool.query('UPDATE employees SET is_active = FALSE WHERE id = $1', [req.params.id]);
        res.json({ message: 'تم تعطيل المستخدم' });
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
