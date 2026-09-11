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

// تهيئة وفحص وترقية جداول قاعدة البيانات
async function initDB() {
    try {
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

            CREATE TABLE IF NOT EXISTS product_boms (
                id SERIAL PRIMARY KEY,
                parent_product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                ingredient_product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                quantity_required NUMERIC(10, 4) NOT NULL DEFAULT 1.0000,
                rule VARCHAR(30) NOT NULL DEFAULT 'ALWAYS'
            );

            CREATE TABLE IF NOT EXISTS product_variants (
                id SERIAL PRIMARY KEY,
                product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                variant_name VARCHAR(100) NOT NULL,
                selling_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                cost_price NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
                stock_quantity NUMERIC(12, 4) NOT NULL DEFAULT 0.0000
            );

            CREATE TABLE IF NOT EXISTS product_serving_options (
                id SERIAL PRIMARY KEY,
                product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                option_name VARCHAR(100) NOT NULL,
                extra_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                material_id INT REFERENCES products(id) ON DELETE SET NULL,
                material_qty NUMERIC(10, 4) DEFAULT 1.0000,
                secondary_material_id INT REFERENCES products(id) ON DELETE SET NULL,
                secondary_material_qty NUMERIC(10, 4) DEFAULT 1.0000
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

            CREATE TABLE IF NOT EXISTS shift_inventory_counts (
                id SERIAL PRIMARY KEY,
                shift_id INT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
                product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                location_id INT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
                count_type VARCHAR(10) NOT NULL DEFAULT 'CLOSING',
                physical_count NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
                system_expected_count NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
                variance_qty NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (shift_id, product_id, location_id, count_type)
            );

            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                shift_id INT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
                cashier_id INT REFERENCES employees(id) ON DELETE SET NULL,
                order_mode VARCHAR(50) NOT NULL DEFAULT 'DIRECT',
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
                subtotal_cost NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
                packaging_name VARCHAR(100),
                packaging_cost NUMERIC(10, 4) DEFAULT 0
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
                phone VARCHAR(20),
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
        `);

        await pool.query(`
            -- إضافة أعمدة الأوعية لجدول عناصر الطلب
            ALTER TABLE order_items ADD COLUMN IF NOT EXISTS packaging_name VARCHAR(100);
            ALTER TABLE order_items ADD COLUMN IF NOT EXISTS packaging_cost NUMERIC(10, 4) DEFAULT 0;

            -- تعديلات الحسابات والموظفين
            ALTER TABLE customer_tabs ALTER COLUMN phone DROP NOT NULL;
            ALTER TABLE staff_consumptions ADD COLUMN IF NOT EXISTS beneficiary_name VARCHAR(150) DEFAULT 'موظف';
            ALTER TABLE staff_consumptions ALTER COLUMN employee_id DROP NOT NULL;
            ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS stock_quantity NUMERIC(12, 4) DEFAULT 0;

            UPDATE products SET unit_cost_price = cost_price WHERE (unit_cost_price = 0 OR unit_cost_price IS NULL) AND cost_price > 0;
            UPDATE products SET unit_selling_price = selling_price WHERE (unit_selling_price = 0 OR unit_selling_price IS NULL) AND selling_price > 0;
            UPDATE products SET sku = 'SKU-' || LPAD(id::text, 4, '0') WHERE sku IS NULL OR sku = '';
        `);

        await pool.query(`
            INSERT INTO inventory_locations (code, name, description) VALUES
            ('BACKROOM', 'المخزن الداخلي', 'مخزن الاحتياطي الرئيسي'),
            ('FRONT_DISPLAY', 'الواجهة والمعروض', 'بضاعة البيع الفوري')
            ON CONFLICT (code) DO NOTHING;

            INSERT INTO employees (username, pin_code, full_name, phone, role) VALUES
            ('admin', '1234', 'مدير النظام', '01000000000', 'admin'),
            ('omar',  '1111', 'عمر - وردية 1', '01100000001', 'cashier'),
            ('tareq', '2222', 'طارق - وردية 2', '01200000002', 'cashier'),
            ('antry', '3333', 'عنتري - وردية 3', '01500000003', 'cashier')
            ON CONFLICT (username) DO NOTHING;
        `);

        console.log('✅ تم إعداد وفحص وتحديث جداول النظام بنجاح.');
    } catch (err) {
        console.error('❌ خطأ في إعداد قاعدة البيانات:', err.message);
    }
}
initDB();

// ============================================================================
// تسجيل الدخول
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
// جلب المنتجات محملة مسبقاً بالأحجام والأوعية (سرعة استجابة فائقة 0ms)
// ============================================================================
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                p.id, 
                COALESCE(p.sku, 'SKU-' || LPAD(p.id::text, 4, '0')) AS sku, 
                p.name, 
                p.category_id,
                COALESCE(NULLIF(p.unit_cost_price, 0), p.cost_price, 0) AS unit_cost_price,
                COALESCE(NULLIF(p.cost_price, 0), p.unit_cost_price, 0) AS cost_price,
                COALESCE(NULLIF(p.unit_selling_price, 0), p.selling_price, 0) AS unit_selling_price,
                COALESCE(NULLIF(p.selling_price, 0), p.unit_selling_price, 0) AS selling_price,
                COALESCE(p.unit_type, 'قطعة') AS unit_type,
                COALESCE(p.product_type, 'DIRECT_UNIT') AS product_type,
                COALESCE(c.name, p.category, 'عام') AS category,
                COALESCE(li_front.quantity, 0) AS front_display_stock,
                COALESCE(li_front.quantity, 0) AS stock_quantity,
                COALESCE(li_back.quantity, 0) AS backroom_stock,
                CASE WHEN p.product_type = 'PREPARED_DRINK' THEN 1 ELSE 0 END AS is_drink,
                COALESCE((
                    SELECT json_agg(json_build_object(
                        'id', pv.id,
                        'variant_name', pv.variant_name,
                        'selling_price', pv.selling_price,
                        'cost_price', pv.cost_price,
                        'stock_quantity', pv.stock_quantity
                    ))
                    FROM product_variants pv WHERE pv.product_id = p.id
                ), '[]'::json) AS variants,
                COALESCE((
                    SELECT json_agg(json_build_object(
                        'id', so.id,
                        'option_name', so.option_name,
                        'extra_price', so.extra_price,
                        'material_id', so.material_id,
                        'material_qty', so.material_qty,
                        'material_name', p1.name,
                        'material_cost', COALESCE(NULLIF(p1.unit_cost_price, 0), p1.cost_price, 0),
                        'secondary_material_id', so.secondary_material_id,
                        'secondary_material_qty', so.secondary_material_qty,
                        'secondary_material_name', p2.name,
                        'secondary_material_cost', COALESCE(NULLIF(p2.unit_cost_price, 0), p2.cost_price, 0)
                    ))
                    FROM product_serving_options so
                    LEFT JOIN products p1 ON so.material_id = p1.id
                    LEFT JOIN products p2 ON so.secondary_material_id = p2.id
                    WHERE so.product_id = p.id
                ), '[]'::json) AS serving_options
            FROM products p
            LEFT JOIN product_categories c ON p.category_id = c.id
            LEFT JOIN location_inventory li_front ON p.id = li_front.product_id 
                 AND li_front.location_id = (SELECT id FROM inventory_locations WHERE code = 'FRONT_DISPLAY' LIMIT 1)
            LEFT JOIN location_inventory li_back ON p.id = li_back.product_id 
                 AND li_back.location_id = (SELECT id FROM inventory_locations WHERE code = 'BACKROOM' LIMIT 1)
            WHERE p.is_active = TRUE
            ORDER BY p.category ASC, p.name ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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

        const frontLoc = await client.query("SELECT id FROM inventory_locations WHERE code = 'FRONT_DISPLAY'");
        if (frontLoc.rows.length > 0) {
            await client.query(`
                INSERT INTO location_inventory (product_id, location_id, quantity) VALUES ($1, $2, $3)
                ON CONFLICT (product_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity
            `, [prodId, frontLoc.rows[0].id, stock_quantity || 0]);
        }

        const backLoc = await client.query("SELECT id FROM inventory_locations WHERE code = 'BACKROOM'");
        if (backLoc.rows.length > 0 && backroom_stock !== undefined) {
            await client.query(`
                INSERT INTO location_inventory (product_id, location_id, quantity) VALUES ($1, $2, $3)
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

// جلب حسابات الشكك مع تفاصيل الأصناف والتكلفة والربح
app.get('/api/admin/customer-tabs-detailed', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                ct.id as tab_id,
                ct.customer_name,
                ct.remaining_balance,
                COALESCE(SUM(o.total_cost), 0) as total_cogs_owed,
                (ct.remaining_balance - COALESCE(SUM(o.total_cost), 0)) as total_profit_owed,
                COALESCE(json_agg(json_build_object(
                    'product_name', p.name,
                    'qty', oi.quantity,
                    'packaging', oi.packaging_name,
                    'price', oi.subtotal_price,
                    'cost', oi.subtotal_cost,
                    'date', o.created_at
                )) FILTER (WHERE p.id IS NOT NULL), '[]'::json) as items
            FROM customer_tabs ct
            LEFT JOIN customer_tab_orders cto ON ct.id = cto.tab_id
            LEFT JOIN orders o ON cto.order_id = o.id
            LEFT JOIN order_items oi ON o.id = oi.order_id
            LEFT JOIN products p ON oi.product_id = p.id
            WHERE ct.status != 'SETTLED'
            GROUP BY ct.id, ct.customer_name, ct.remaining_balance
            ORDER BY ct.id DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/shifts-archive', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                s.id AS shift_id,
                s.shift_number,
                TO_CHAR(COALESCE(s.start_time, s.shift_date::timestamp), 'YYYY-MM-DD') AS formatted_date,
                TO_CHAR(s.start_time, 'HH:MI AM') AS start_time_str,
                TO_CHAR(s.end_time, 'HH:MI AM') AS end_time_str,
                s.status,
                COALESCE(s.starting_cash_float, 0)::float AS starting_cash_float,
                COALESCE(e1.full_name, 'غير محدد') AS outgoing_cashier_name,
                COALESCE(e2.full_name, 'غير محدد') AS incoming_cashier_name,
                COALESCE(sr.actual_physical_cash, 0)::float AS actual_physical_cash,
                COALESCE(ord.cash_sales, 0)::float AS cash_sales,
                COALESCE(ord.vf_sales, 0)::float AS vf_sales,
                COALESCE(ord.total_cogs, 0)::float AS total_cogs,
                COALESCE(ord.total_profit, 0)::float AS total_profit,
                -- الحسبة الدقيقة للعجز والزيادة
                (COALESCE(sr.actual_physical_cash, 0) - (COALESCE(s.starting_cash_float, 0) + COALESCE(ord.cash_sales, 0)))::float AS calculated_variance
            FROM shifts s
            LEFT JOIN employees e1 ON s.outgoing_cashier_id = e1.id
            LEFT JOIN employees e2 ON s.incoming_cashier_id = e2.id
            LEFT JOIN shift_reconciliations sr ON s.id = sr.shift_id
            LEFT JOIN (
                SELECT 
                    shift_id,
                    SUM(CASE WHEN payment_type = 'CASH' AND status = 'COMPLETED' THEN total_amount ELSE 0 END) AS cash_sales,
                    SUM(CASE WHEN payment_type = 'VODAFONE_CASH' AND status = 'COMPLETED' THEN total_amount ELSE 0 END) AS vf_sales,
                    SUM(CASE WHEN payment_type IN ('CASH', 'VODAFONE_CASH') AND status = 'COMPLETED' THEN total_cost ELSE 0 END) AS total_cogs,
                    SUM(CASE WHEN payment_type IN ('CASH', 'VODAFONE_CASH') AND status = 'COMPLETED' THEN (total_amount - total_cost) ELSE 0 END) AS total_profit
                FROM orders
                GROUP BY shift_id
            ) ord ON s.id = ord.shift_id
            ORDER BY s.id DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/shift-tabs-summary/:shift_id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                ct.customer_name,
                p.name as product_name,
                oi.quantity,
                oi.subtotal_price,
                TO_CHAR(o.created_at, 'HH:MI AM') as time_str
            FROM customer_tab_orders cto
            JOIN customer_tabs ct ON cto.tab_id = ct.id
            JOIN orders o ON cto.order_id = o.id
            JOIN order_items oi ON o.id = oi.order_id
            JOIN products p ON oi.product_id = p.id
            WHERE o.shift_id = $1
            ORDER BY o.created_at DESC
        `, [req.params.shift_id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 1. جلب فواتير الوردية الحالية القابلة للإرجاع
app.get('/api/shift-orders/:shift_id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                o.id,
                o.station_reference,
                o.payment_type,
                o.total_amount,
                TO_CHAR(o.created_at, 'HH:MI AM') AS time_str,
                COALESCE(json_agg(json_build_object(
                    'product_name', p.name,
                    'qty', oi.quantity,
                    'packaging', oi.packaging_name,
                    'subtotal', oi.subtotal_price
                )) FILTER (WHERE p.id IS NOT NULL), '[]'::json) AS items
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN products p ON oi.product_id = p.id
            WHERE o.shift_id = $1 AND o.status = 'COMPLETED'
            GROUP BY o.id
            ORDER BY o.id DESC
            LIMIT 40
        `, [req.params.shift_id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. تنفيذ الإرجاع (رد البضاعة للواجهة وإلغاء تأثير الفاتورة من مبيعات الوردية)
app.post('/api/refund-order', async (req, res) => {
    const { order_id } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // جلب بيانات الأوردر
        const orderRes = await client.query('SELECT * FROM orders WHERE id = $1 AND status = \'COMPLETED\' FOR UPDATE', [order_id]);
        if (orderRes.rows.length === 0) {
            throw new Error('الأوردر غير موجود أو تم إرجاعه مسبقاً');
        }
        const order = orderRes.rows[0];

        // تحديد مخزن الواجهة
        const frontLoc = await client.query("SELECT id FROM inventory_locations WHERE code = 'FRONT_DISPLAY' LIMIT 1");
        const frontLocationId = frontLoc.rows[0].id;

        // جلب كافة عناصر الأوردر وردها للمخزن
        const itemsRes = await client.query(`
            SELECT oi.*, p.product_type 
            FROM order_items oi 
            JOIN products p ON oi.product_id = p.id 
            WHERE oi.order_id = $1
        `, [order_id]);

        for (const item of itemsRes.rows) {
            if (item.product_type === 'DIRECT_UNIT' || item.product_type === 'PACKAGING_MATERIAL') {
                // رد الصنف المباشر إلى الواجهة
                await client.query(`
                    UPDATE location_inventory 
                    SET quantity = quantity + $1, updated_at = NOW()
                    WHERE product_id = $2 AND location_id = $3
                `, [item.quantity, item.product_id, frontLocationId]);
            } else if (item.product_type === 'PREPARED_DRINK') {
                // رد خامات المشروب (BOM)
                const boms = await client.query("SELECT * FROM product_boms WHERE parent_product_id = $1 AND rule = 'ALWAYS'", [item.product_id]);
                for (const bom of boms.rows) {
                    await client.query(`
                        UPDATE location_inventory 
                        SET quantity = quantity + $1, updated_at = NOW()
                        WHERE product_id = $2 AND location_id = $3
                    `, [(Number(bom.quantity_required) * Number(item.quantity)), bom.ingredient_product_id, frontLocationId]);
                }
            }
        }

        // إلغاء استهلاك الموظف إذا كان الأوردر للموظفين
        if (order.payment_type === 'STAFF_EXPENSE') {
            await client.query('DELETE FROM staff_consumptions WHERE order_id = $1', [order_id]);
        }

        // إلغاء وتخفيض الشكك إذا كان الأوردر شكك/آجل
        if (order.payment_type === 'CREDIT_TAB') {
            const tabOrderRes = await client.query('SELECT tab_id FROM customer_tab_orders WHERE order_id = $1', [order_id]);
            if (tabOrderRes.rows.length > 0) {
                const tabId = tabOrderRes.rows[0].tab_id;
                await client.query(`
                    UPDATE customer_tabs 
                    SET total_debt = GREATEST(0, total_debt - $1),
                        remaining_balance = GREATEST(0, remaining_balance - $1)
                    WHERE id = $2
                `, [order.total_amount, tabId]);
                await client.query('DELETE FROM customer_tab_orders WHERE order_id = $1', [order_id]);
            }
        }

        // تغيير حالة الأوردر إلى مرتجع (REFUNDED)
        await client.query("UPDATE orders SET status = 'REFUNDED' WHERE id = $1", [order_id]);

        await client.query('COMMIT');
        res.json({ success: true, message: `تم إرجاع الفاتورة #${order_id} واسترداد البضاعة بنجاح` });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// تسوية وتحصيل حساب الشكك
app.post('/api/admin/settle-tab', async (req, res) => {
    const { tab_id } = req.body;
    try {
        await pool.query("UPDATE customer_tabs SET status = 'SETTLED', remaining_balance = 0 WHERE id = $1", [tab_id]);
        res.json({ success: true, message: 'تم تسوية حساب العميل بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
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

// توريد شحنة جديدة
// مسار التوريد وحركة البضاعة الذكي
app.post('/api/admin/restock-inward', async (req, res) => {
    const { product_id, quantity, operation_type, destination } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const qty = Number(quantity);
        if (isNaN(qty) || qty <= 0) throw new Error('يرجى تحديد كمية صحيحة');

        const backLoc = await client.query("SELECT id FROM inventory_locations WHERE code = 'BACKROOM' LIMIT 1");
        const frontLoc = await client.query("SELECT id FROM inventory_locations WHERE code = 'FRONT_DISPLAY' LIMIT 1");
        const backId = backLoc.rows[0].id;
        const frontId = frontLoc.rows[0].id;

        const op = operation_type || destination;

        if (op === 'TRANSFER' || op === 'TRANSFER_TO_FRONT') {
            // 1. نقل من المخزن للواجهة: يخصم من المخزن ويزود الواجهة
            const backStockRes = await client.query(
                'SELECT quantity FROM location_inventory WHERE product_id = $1 AND location_id = $2 FOR UPDATE',
                [product_id, backId]
            );
            const currentBack = Number(backStockRes.rows[0]?.quantity || 0);

            if (currentBack < qty) {
                throw new Error(`الرصيد في المخزن (${currentBack}) لا يكفي لنقل (${qty}) قطعة!`);
            }

            // الخصم من المخزن الاحتياطي
            await client.query(
                'UPDATE location_inventory SET quantity = quantity - $1, updated_at = NOW() WHERE product_id = $2 AND location_id = $3',
                [qty, product_id, backId]
            );

            // الإضافة إلى الواجهة
            await client.query(`
                INSERT INTO location_inventory (product_id, location_id, quantity, updated_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (product_id, location_id)
                DO UPDATE SET quantity = location_inventory.quantity + EXCLUDED.quantity, updated_at = NOW()
            `, [product_id, frontId, qty]);

            await client.query('COMMIT');
            return res.json({ success: true, message: `تم خصم ${qty} من المخزن وإضافتها للواجهة بنجاح` });

        } else if (op === 'FRONT_DISPLAY' || op === 'BUY_FRONT') {
            // 2. شراء جديد من التاجر دخل الواجهة مباشرة (زيادة الواجهة فقط دون خصم)
            await client.query(`
                INSERT INTO location_inventory (product_id, location_id, quantity, updated_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (product_id, location_id)
                DO UPDATE SET quantity = location_inventory.quantity + EXCLUDED.quantity, updated_at = NOW()
            `, [product_id, frontId, qty]);

            await client.query('COMMIT');
            return res.json({ success: true, message: `تمت إضافة الشحنة للواجهة بنجاح` });

        } else {
            // 3. شراء جديد من التاجر دخل المخزن الاحتياطي (زيادة المخزن فقط دون خصم)
            await client.query(`
                INSERT INTO location_inventory (product_id, location_id, quantity, updated_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (product_id, location_id)
                DO UPDATE SET quantity = location_inventory.quantity + EXCLUDED.quantity, updated_at = NOW()
            `, [product_id, backId, qty]);

            await client.query('COMMIT');
            return res.json({ success: true, message: `تمت إضافة الشحنة للمخزن بنجاح` });
        }
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// تحويل داخلي (نقل بضاعة من المخزن الاحتياطي إلى واجهة الكاشير ورص الرفوف)
app.post('/api/admin/stock-transfer', async (req, res) => {
    const { product_id, quantity } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const qty = Number(quantity);
        if (isNaN(qty) || qty <= 0) throw new Error('يرجى تحديد كمية صحيحة للنقل');

        const backLoc = await client.query("SELECT id FROM inventory_locations WHERE code = 'BACKROOM' LIMIT 1");
        const frontLoc = await client.query("SELECT id FROM inventory_locations WHERE code = 'FRONT_DISPLAY' LIMIT 1");
        const backId = backLoc.rows[0].id;
        const frontId = frontLoc.rows[0].id;

        // 1. التحقق من وجود رصيد كافٍ بالمخزن الاحتياطي
        const backStockRes = await client.query(
            "SELECT quantity FROM location_inventory WHERE product_id = $1 AND location_id = $2 FOR UPDATE",
            [product_id, backId]
        );
        const availableBackroom = Number(backStockRes.rows[0]?.quantity || 0);

        if (availableBackroom < qty) {
            throw new Error(`الرصيد بالمخزن (${availableBackroom}) غير كافٍ لنقل ${qty} قطعة`);
        }

        // 2. الخصم من المخزن الاحتياطي
        await client.query(`
            UPDATE location_inventory 
            SET quantity = quantity - $1, updated_at = NOW()
            WHERE product_id = $2 AND location_id = $3
        `, [qty, product_id, backId]);

        // 3. الإضافة إلى رصيد الواجهة المعروضة للكاشير
        await client.query(`
            INSERT INTO location_inventory (product_id, location_id, quantity, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (product_id, location_id) 
            DO UPDATE SET quantity = location_inventory.quantity + EXCLUDED.quantity, updated_at = NOW()
        `, [product_id, frontId, qty]);

        await client.query('COMMIT');
        res.json({ success: true, message: `تم نقل ${qty} قطعة من المخزن إلى الواجهة بنجاح` });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// مسارات الأوعية والخامات والأحجام
app.get('/api/product-serving-options/:productId', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                so.*,
                p1.name as material_name,
                COALESCE(NULLIF(p1.unit_cost_price, 0), p1.cost_price, 0) as material_cost,
                p2.name as secondary_material_name,
                COALESCE(NULLIF(p2.unit_cost_price, 0), p2.cost_price, 0) as secondary_material_cost
            FROM product_serving_options so
            LEFT JOIN products p1 ON so.material_id = p1.id
            LEFT JOIN products p2 ON so.secondary_material_id = p2.id
            WHERE so.product_id = $1
            ORDER BY so.id ASC
        `, [req.params.productId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/product-serving-options/:productId', async (req, res) => {
    const productId = req.params.productId;
    const { options } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM product_serving_options WHERE product_id = $1', [productId]);

        if (Array.isArray(options)) {
            for (const opt of options) {
                if (opt.option_name && opt.option_name.trim() !== '') {
                    await client.query(`
                        INSERT INTO product_serving_options 
                        (product_id, option_name, extra_price, material_id, material_qty, secondary_material_id, secondary_material_qty)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                    `, [
                        productId,
                        opt.option_name.trim(),
                        parseFloat(opt.extra_price) || 0,
                        opt.material_id ? parseInt(opt.material_id) : null,
                        parseFloat(opt.material_qty) || 1,
                        opt.secondary_material_id ? parseInt(opt.secondary_material_id) : null,
                        parseFloat(opt.secondary_material_qty) || 1
                    ]);
                }
            }
        }
        await client.query('COMMIT');
        res.json({ success: true, message: 'تم حفظ أوعية التقديم بنجاح' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.get('/api/product-ingredients/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT b.id, b.ingredient_product_id, b.quantity_required, p.name as ingredient_name, 
                   COALESCE(NULLIF(p.unit_cost_price, 0), p.cost_price, 0) as unit_cost
            FROM product_boms b
            JOIN products p ON b.ingredient_product_id = p.id
            WHERE b.parent_product_id = $1
            ORDER BY b.id ASC
        `, [req.params.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/product-ingredients/:id', async (req, res) => {
    const parentId = req.params.id;
    const { ingredients } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM product_boms WHERE parent_product_id = $1', [parentId]);

        if (Array.isArray(ingredients)) {
            for (const item of ingredients) {
                if (item.ingredient_id) {
                    await client.query(`
                        INSERT INTO product_boms (parent_product_id, ingredient_product_id, quantity_required)
                        VALUES ($1, $2, $3)
                    `, [parentId, item.ingredient_id, parseFloat(item.quantity) || 1]);
                }
            }
        }
        await client.query('COMMIT');
        res.json({ success: true, message: 'تم حفظ تركيبة الخامات بنجاح' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.get('/api/product-variants/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, product_id, variant_name, selling_price, cost_price, stock_quantity
            FROM product_variants 
            WHERE product_id = $1 
            ORDER BY id ASC
        `, [req.params.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/product-variants/:id', async (req, res) => {
    const prodId = req.params.id;
    const { variants } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM product_variants WHERE product_id = $1', [prodId]);

        if (Array.isArray(variants)) {
            for (const v of variants) {
                if (v.variant_name && v.variant_name.trim() !== '') {
                    await client.query(`
                        INSERT INTO product_variants (product_id, variant_name, selling_price, cost_price, stock_quantity)
                        VALUES ($1, $2, $3, $4, $5)
                    `, [
                        prodId, 
                        v.variant_name.trim(), 
                        parseFloat(v.selling_price) || 0, 
                        parseFloat(v.cost_price) || 0, 
                        parseFloat(v.stock_quantity) || 0
                    ]);
                }
            }
        }
        await client.query('COMMIT');
        res.json({ success: true, message: 'تم حفظ الأحجام بنجاح' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// تنفيذ البيع
app.post('/api/checkout', async (req, res) => {
    const {
        shift_id,
        cashier_id,
        cart,
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

        const frontLoc = await client.query("SELECT id FROM inventory_locations WHERE code = 'FRONT_DISPLAY' LIMIT 1");
        const frontLocationId = frontLoc.rows[0].id;

        let totalOrderAmount = 0;
        let totalOrderCost = 0;

        for (const item of cart) {
            const pRes = await client.query('SELECT * FROM products WHERE id = $1', [item.id]);
            const prod = pRes.rows[0];

            const opt = item.serving_option || null;
            let optCost = 0;
            if (opt) {
                optCost = Number(opt.material_cost || 0) + Number(opt.secondary_material_cost || 0);
            }

            let unitCost = Number(prod.unit_cost_price || prod.cost_price || 0) + optCost;
            let unitPrice = (payment_type === 'STAFF_EXPENSE') ? unitCost : Number(item.price);

            totalOrderAmount += unitPrice * item.qty;
            totalOrderCost += unitCost * item.qty;

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

            if (opt) {
                if (opt.material_id) {
                    const mStock = await client.query('SELECT quantity FROM location_inventory WHERE product_id = $1 AND location_id = $2 FOR UPDATE', [opt.material_id, frontLocationId]);
                    if (Number(mStock.rows[0]?.quantity || 0) < (Number(opt.material_qty || 1) * item.qty)) {
                        throw new Error(`خامة التقديم الأساسية (${opt.material_name || 'الوعاء'}) غير كافية بالواجهة`);
                    }
                }
                if (opt.secondary_material_id) {
                    const sStock = await client.query('SELECT quantity FROM location_inventory WHERE product_id = $1 AND location_id = $2 FOR UPDATE', [opt.secondary_material_id, frontLocationId]);
                    if (Number(sStock.rows[0]?.quantity || 0) < (Number(opt.secondary_material_qty || 1) * item.qty)) {
                        throw new Error(`الخامة الإضافية (${opt.secondary_material_name || 'الملعقة/الشفاطة'}) غير كافية بالواجهة`);
                    }
                }
            }
        }

        const paid = Number(paid_amount) || totalOrderAmount;
        let calculatedTip = (paid > totalOrderAmount && totalOrderAmount > 0) ? (paid - totalOrderAmount) : 0;

        const orderInsert = await client.query(`
            INSERT INTO orders (shift_id, cashier_id, order_mode, payment_type, total_amount, total_cost, station_reference, status)
            VALUES ($1, $2, 'DIRECT', $3, $4, $5, $6, 'COMPLETED') RETURNING id
        `, [shift_id, cashier_id, payment_type || 'CASH', totalOrderAmount, totalOrderCost, station_reference || 'الكاشير المباشر']);
        const orderId = orderInsert.rows[0].id;

        for (const item of cart) {
            const pRes = await client.query('SELECT * FROM products WHERE id = $1', [item.id]);
            const prod = pRes.rows[0];

            const opt = item.serving_option || null;
            let optCost = 0;
            let optName = opt ? opt.option_name : 'عادي';
            if (opt) {
                optCost = Number(opt.material_cost || 0) + Number(opt.secondary_material_cost || 0);
            }

            let unitCost = Number(prod.unit_cost_price || prod.cost_price || 0) + optCost;
            let unitPrice = (payment_type === 'STAFF_EXPENSE') ? unitCost : Number(item.price);
            
            const subtotalPrice = Number(item.qty) * unitPrice;
            const subtotalCost = Number(item.qty) * unitCost;

            await client.query(`
                INSERT INTO order_items (order_id, product_id, quantity, unit_price, unit_cost, subtotal_price, subtotal_cost, packaging_name, packaging_cost)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [orderId, prod.id, item.qty, unitPrice, unitCost, subtotalPrice, subtotalCost, optName, optCost]);

            if (prod.product_type === 'DIRECT_UNIT') {
                await client.query(`
                    UPDATE location_inventory SET quantity = quantity - $1
                    WHERE product_id = $2 AND location_id = $3
                `, [item.qty, prod.id, frontLocationId]);
            } else if (prod.product_type === 'PREPARED_DRINK') {
                const boms = await client.query("SELECT * FROM product_boms WHERE parent_product_id = $1 AND rule = 'ALWAYS'", [prod.id]);
                for (const bom of boms.rows) {
                    await client.query(`
                        UPDATE location_inventory SET quantity = GREATEST(0, quantity - $1)
                        WHERE product_id = $2 AND location_id = $3
                    `, [bom.quantity_required * item.qty, bom.ingredient_product_id, frontLocationId]);
                }
            }

            if (opt) {
                if (opt.material_id) {
                    await client.query(`
                        UPDATE location_inventory SET quantity = GREATEST(0, quantity - $1)
                        WHERE product_id = $2 AND location_id = $3
                    `, [(Number(opt.material_qty) || 1) * item.qty, opt.material_id, frontLocationId]);
                }
                if (opt.secondary_material_id) {
                    await client.query(`
                        UPDATE location_inventory SET quantity = GREATEST(0, quantity - $1)
                        WHERE product_id = $2 AND location_id = $3
                    `, [(Number(opt.secondary_material_qty) || 1) * item.qty, opt.secondary_material_id, frontLocationId]);
                }
            }
        }

        if (payment_type === 'STAFF_EXPENSE') {
            const beneficiary = (staff_beneficiary_name && staff_beneficiary_name.trim()) ? staff_beneficiary_name.trim() : 'موظف';
            await client.query(`
                INSERT INTO staff_consumptions (order_id, shift_id, employee_id, beneficiary_name, total_cost_charged)
                VALUES ($1, $2, $3, $4, $5)
            `, [orderId, shift_id, staff_employee_id || null, beneficiary, totalOrderCost]);
        } else if (payment_type === 'CREDIT_TAB') {
            const custName = (tab_customer_name || '').trim();
            const custPhone = (tab_customer_phone || '').trim();
            let tabId;
            const existingTab = await client.query(
                "SELECT id FROM customer_tabs WHERE TRIM(LOWER(customer_name)) = TRIM(LOWER($1)) AND status != 'SETTLED' LIMIT 1",
                [custName]
            );

            if (existingTab.rows.length > 0) {
                tabId = existingTab.rows[0].id;
                await client.query('UPDATE customer_tabs SET total_debt = total_debt + $1, remaining_balance = remaining_balance + $1 WHERE id = $2', [totalOrderAmount, tabId]);
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

// الشيفتات وجرد التلاجة
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
                COALESCE(SUM(CASE WHEN payment_type = 'STAFF_EXPENSE' THEN total_cost ELSE 0 END), 0) as staff_costs
            FROM orders WHERE shift_id = $1 AND status = 'COMPLETED'
        `, [shiftId]);

        res.json({
            starting_float: startingFloat,
            cash_sales: Number(salesRes.rows[0].cash_sales),
            vf_sales: Number(salesRes.rows[0].vf_sales),
            tab_credit_sales: Number(salesRes.rows[0].tab_sales),
            staff_expense_sales: Number(salesRes.rows[0].staff_costs)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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

// لوحة الإدارة
app.get('/api/admin/dashboard', async (req, res) => {
    try {
        const valuationRes = await pool.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN l.code = 'FRONT_DISPLAY' AND p.product_type != 'PREPARED_DRINK' 
                    THEN li.quantity * COALESCE(NULLIF(p.unit_cost_price, 0), p.cost_price, 0) ELSE 0 END), 0) as front_cost,
                COALESCE(SUM(CASE WHEN l.code = 'BACKROOM' AND p.product_type != 'PREPARED_DRINK' 
                    THEN li.quantity * COALESCE(NULLIF(p.unit_cost_price, 0), p.cost_price, 0) ELSE 0 END), 0) as backroom_cost,
                COALESCE(SUM(CASE WHEN p.product_type != 'PREPARED_DRINK' 
                    THEN li.quantity * COALESCE(NULLIF(p.unit_cost_price, 0), p.cost_price, 0) ELSE 0 END), 0) as total_physical_inventory_cost
            FROM location_inventory li
            JOIN products p ON li.product_id = p.id
            JOIN inventory_locations l ON li.location_id = l.id
            WHERE p.is_active = TRUE
        `);

        const todayFinancials = await pool.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN o.payment_type = 'CASH' AND o.status = 'COMPLETED' THEN o.total_amount ELSE 0 END), 0) as today_cash_sales,
                COALESCE(SUM(CASE WHEN o.payment_type = 'VODAFONE_CASH' AND o.status = 'COMPLETED' THEN o.total_amount ELSE 0 END), 0) as today_vf_sales,
                COALESCE(SUM(CASE WHEN o.status = 'COMPLETED' AND o.payment_type IN ('CASH', 'VODAFONE_CASH') THEN o.total_amount ELSE 0 END), 0) as today_collected_sales,
                COALESCE(SUM(CASE WHEN o.status = 'COMPLETED' AND o.payment_type IN ('CASH', 'VODAFONE_CASH') THEN o.total_cost ELSE 0 END), 0) as today_cogs
            FROM orders o
            WHERE o.created_at >= CURRENT_DATE
        `);

        const fin = todayFinancials.rows[0];
        const todayCollectedSales = Number(fin.today_collected_sales);
        const todayCogs = Number(fin.today_cogs);
        const todayNetProfit = todayCollectedSales - todayCogs;

        const productsRes = await pool.query(`
            SELECT 
                p.id, 
                COALESCE(p.sku, 'SKU-' || LPAD(p.id::text, 4, '0')) as sku,
                p.name, 
                p.category_id,
                COALESCE(NULLIF(p.unit_cost_price, 0), p.cost_price, 0) AS unit_cost_price,
                COALESCE(NULLIF(p.cost_price, 0), p.unit_cost_price, 0) AS cost_price,
                COALESCE(NULLIF(p.unit_selling_price, 0), p.selling_price, 0) AS unit_selling_price,
                COALESCE(NULLIF(p.selling_price, 0), p.unit_selling_price, 0) AS selling_price,
                COALESCE(p.unit_type, 'قطعة') AS unit_type,
                COALESCE(p.product_type, 'DIRECT_UNIT') AS product_type,
                COALESCE(c.name, p.category, 'عام') AS category,
                COALESCE(li_front.quantity, 0) AS front_display_stock,
                COALESCE(li_back.quantity, 0) AS backroom_stock,
                CASE WHEN p.product_type = 'PREPARED_DRINK' THEN 1 ELSE 0 END as is_drink
            FROM products p
            LEFT JOIN product_categories c ON p.category_id = c.id
            LEFT JOIN location_inventory li_front ON p.id = li_front.product_id 
                 AND li_front.location_id = (SELECT id FROM inventory_locations WHERE code = 'FRONT_DISPLAY' LIMIT 1)
            LEFT JOIN location_inventory li_back ON p.id = li_back.product_id 
                 AND li_back.location_id = (SELECT id FROM inventory_locations WHERE code = 'BACKROOM' LIMIT 1)
            WHERE p.is_active = TRUE
            ORDER BY p.id ASC
        `);

        const shiftsRes = await pool.query(`
            SELECT 
                s.id, s.start_time, s.end_time, s.status, s.shift_date,
                COALESCE(s.starting_cash_float, 0) as starting_cash_float,
                COALESCE(sr.actual_physical_cash, 0) as closing_amount,
                s.notes, 
                COALESCE(e.username, 'كاشير') as username,
                COALESCE(SUM(CASE WHEN o.payment_type = 'CASH' AND o.status = 'COMPLETED' THEN o.total_amount ELSE 0 END), 0) as total_cash_sales,
                COALESCE(SUM(CASE WHEN o.payment_type = 'VODAFONE_CASH' AND o.status = 'COMPLETED' THEN o.total_amount ELSE 0 END), 0) as total_vodafone_sales,
                COALESCE(SUM(CASE WHEN o.payment_type = 'CREDIT_TAB' AND o.status = 'COMPLETED' THEN o.total_amount ELSE 0 END), 0) as total_tab_sales,
                COALESCE(sr.shortage_amount, 0) as shortage_amount
            FROM shifts s
            LEFT JOIN employees e ON s.outgoing_cashier_id = e.id
            LEFT JOIN orders o ON s.id = o.shift_id
            LEFT JOIN shift_reconciliations sr ON s.id = sr.shift_id
            GROUP BY s.id, s.start_time, s.end_time, s.status, s.shift_date, s.starting_cash_float, sr.actual_physical_cash, s.notes, e.username, sr.shortage_amount
            ORDER BY s.id DESC, s.start_time DESC
        `);

        const staffOrdersRes = await pool.query(`
                    SELECT 
                        sc.id, 
                        TO_CHAR(sc.created_at, 'YYYY-MM-DD HH:MI AM') as formatted_date, 
                        sc.beneficiary_name, 
                        sc.total_cost_charged,
                        sc.status,
                        s.shift_number, 
                        o.station_reference,
                        COALESCE(e.full_name, e.username, 'غير مقيد') as employee_profile,
                        COALESCE((
                            SELECT json_agg(json_build_object('product_name', p.name, 'qty', oi.quantity, 'cost', oi.subtotal_cost))
                            FROM order_items oi
                            JOIN products p ON oi.product_id = p.id
                            WHERE oi.order_id = sc.order_id
                        ), '[]'::json) as items
                    FROM staff_consumptions sc
                    JOIN orders o ON sc.order_id = o.id
                    JOIN shifts s ON sc.shift_id = s.id
                    LEFT JOIN employees e ON sc.employee_id = e.id
                    ORDER BY s.id DESC, s.start_time DESC
                `);

        res.json({
            products: productsRes.rows,
            shifts: shiftsRes.rows,
            staff_orders: staffOrdersRes.rows,
            today_financials: {
                today_cash_sales: Number(fin.today_cash_sales),
                today_vf_sales: Number(fin.today_vf_sales),
                today_cogs: todayCogs,
                today_net_profit: todayNetProfit
            },
            stats: {
                front_display_cost: Number(valuationRes.rows[0]?.front_cost || 0),
                backroom_cost: Number(valuationRes.rows[0]?.backroom_cost || 0),
                total_inventory_cost: Number(valuationRes.rows[0]?.total_physical_inventory_cost || 0)
            }
        });
    } catch (err) {
        console.error('Error in /api/admin/dashboard:', err.message);
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

// جلب إجمالي المديونيات المعلقة للموظفين وصاحب العمارة
// جلب مديونيات استهلاك الموظفين وصاحب العمارة مع تفاصيل كل صنف وتاريخه وتكلفته
// جلب مديونيات استهلاك الموظفين مع تفاصيل الأصناف المحسوبة بدقة تامة وبدون تكرار
app.get('/api/admin/staff-balances', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                sc.beneficiary_name,
                COUNT(DISTINCT sc.id) AS orders_count,
                COALESCE(SUM(oi.subtotal_cost), 0)::float AS total_cogs_owed,
                COALESCE(json_agg(json_build_object(
                    'product_name', p.name,
                    'qty', oi.quantity,
                    'cost', oi.subtotal_cost,
                    'shift_id', sc.shift_id,
                    'date', TO_CHAR(o.created_at, 'YYYY-MM-DD HH:MI AM')
                ) ORDER BY o.created_at ASC), '[]'::json) AS items
            FROM staff_consumptions sc
            JOIN orders o ON sc.order_id = o.id
            JOIN order_items oi ON o.id = oi.order_id
            JOIN products p ON oi.product_id = p.id
            WHERE sc.status = 'UNPAID'
            GROUP BY sc.beneficiary_name
            ORDER BY total_cogs_owed DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// تسوية حساب الموظف أو صاحب العمارة (عند خصمه من المرتب أو تحصيله)
app.post('/api/admin/settle-staff-debt', async (req, res) => {
    const { beneficiary_name } = req.body;
    try {
        await pool.query(`
            UPDATE staff_consumptions 
            SET status = 'SETTLED', settled_at = NOW() 
            WHERE beneficiary_name = $1 AND status = 'UNPAID'
        `, [beneficiary_name]);
        res.json({ success: true, message: `تم تسوية مديونية ${beneficiary_name}` });
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

app.listen(PORT, () => console.log(`🚀 النظام يعمل بنجاح فائق على المنفذ ${PORT} - حواسب كافيه`));
