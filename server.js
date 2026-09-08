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
        // 1. التأكد من الجداول
        await pool.query(`
            CREATE TABLE IF NOT EXISTS product_variants (
                id SERIAL PRIMARY KEY,
                product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                variant_name VARCHAR(100) NOT NULL,
                selling_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                cost_price NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
                stock_quantity NUMERIC(12, 4) NOT NULL DEFAULT 0.0000
            );

            CREATE TABLE IF NOT EXISTS product_boms (
                id SERIAL PRIMARY KEY,
                parent_product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                ingredient_product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                quantity_required NUMERIC(10, 4) NOT NULL DEFAULT 1.0000,
                rule VARCHAR(30) NOT NULL DEFAULT 'ALWAYS'
            );

            ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS stock_quantity NUMERIC(12, 4) DEFAULT 0;
        `);

        // 2. إصلاح الأسعار وتوليد الـ SKU وربط الأقسام
        await pool.query(`
            -- تعويض التكلفة الحقيقية في unit_cost_price بدلاً من 0
            UPDATE products 
            SET unit_cost_price = cost_price 
            WHERE (unit_cost_price = 0 OR unit_cost_price IS NULL) AND cost_price > 0;

            UPDATE products 
            SET unit_selling_price = selling_price 
            WHERE (unit_selling_price = 0 OR unit_selling_price IS NULL) AND selling_price > 0;

            -- توليد أكواد SKU تلقائية للأصناف التي لا تملك كوداً
            UPDATE products 
            SET sku = 'SKU-' || LPAD(id::text, 4, '0') 
            WHERE sku IS NULL OR sku = '';

            -- ربط category_id بجدول الأقسام تلقائياً
            UPDATE products p
            SET category_id = c.id
            FROM product_categories c
            WHERE p.category_id IS NULL AND (
                p.category = c.name 
                OR (p.category = '1' AND c.name = 'خامات ومواد تغليف')
                OR (p.category = 'مشروبات ساقعه' AND c.name = 'مشروبات ساقعة')
                OR (p.category = 'مشروبات سخنه' AND c.name = 'مشروبات ساخنة')
                OR (p.category = 'شيبسيات و اندومي' AND c.name = 'شيبسيات وسناكس')
            );
        `);
        await pool.query(`
            ALTER TABLE order_items ADD COLUMN IF NOT EXISTS packaging_name VARCHAR(100);
            ALTER TABLE order_items ADD COLUMN IF NOT EXISTS packaging_cost NUMERIC(10, 4) DEFAULT 0;
        `);
        console.log('✅ تم تصحيح الأسعار وربط الأقسام وتوليد الـ SKU بنجاح.');
    } catch (err) {
        console.error('❌ خطأ في فحص قاعدة البيانات:', err.message);
    }
}
initDB();

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
    const { ingredients } = req.body; // مصفوفة [{ ingredient_id, quantity }]
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

// ============================================================================
// مسارات الأحجام والخيارات والأرصدة (Variants & Options)
// ============================================================================
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
    const { variants } = req.body; // مصفوفة [{ variant_name, selling_price, cost_price, stock_quantity }]
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
        res.json({ success: true, message: 'تم حفظ الأحجام والأرصدة بنجاح' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.get('/api/admin/dashboard', async (req, res) => {
    try {
        // تقييم المخزون باستخدام NULLIF لتخطي الصفر واستعمال السعر الحقيقي
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

        // حساب مبيعات وأرباح اليوم
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

        // استعلام المنتجات مع إرجاع الـ SKU و category_id
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

        res.json({
            products: productsRes.rows,
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
// تنفيذ البيع واحتساب تكلفة وخصم خامات وعاء التقديم (كوب / طبق / كروانة)
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

        // 1. التحقق من توافر بضاعة الواجهة وخامات الأوعية المطلوبة
        for (const item of cart) {
            const pRes = await client.query('SELECT * FROM products WHERE id = $1', [item.id]);
            const prod = pRes.rows[0];

            const packaging = item.packaging || { name: 'عادي', cost: 0, items: [] };
            const packagingCost = Number(packaging.cost || 0);

            let unitCost = Number(prod.unit_cost_price || prod.cost_price || 0) + packagingCost;
            let unitPrice = (payment_type === 'STAFF_EXPENSE') ? unitCost : Number(prod.unit_selling_price || prod.selling_price || 0);

            totalOrderAmount += unitPrice * item.qty;
            totalOrderCost += unitCost * item.qty;

            // التحقق من الصنف المباشر
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

            // التحقق من خامات الوعاء (أكواب / أطباق / شوك) إن وجدت
            if (packaging.items && Array.isArray(packaging.items)) {
                for (const packItem of packaging.items) {
                    const packStock = await client.query(
                        'SELECT quantity FROM location_inventory WHERE product_id = $1 AND location_id = $2 FOR UPDATE',
                        [packItem.product_id, frontLocationId]
                    );
                    const availablePack = Number(packStock.rows[0]?.quantity || 0);
                    const needed = Number(packItem.qty || 1) * item.qty;
                    if (availablePack < needed) {
                        const packInfo = await client.query('SELECT name FROM products WHERE id = $1', [packItem.product_id]);
                        throw new Error(`رصيد "${packInfo.rows[0]?.name || 'خامة التقديم'}" بالواجهة غير كافٍ (المتاح: ${availablePack})`);
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

        // 2. تسجيل العناصر وخصم خامات المنتجات والأوعية
        for (const item of cart) {
            const pRes = await client.query('SELECT * FROM products WHERE id = $1', [item.id]);
            const prod = pRes.rows[0];

            const packaging = item.packaging || { name: 'عادي', cost: 0, items: [] };
            const packagingCost = Number(packaging.cost || 0);

            let unitCost = Number(prod.unit_cost_price || prod.cost_price || 0) + packagingCost;
            let unitPrice = (payment_type === 'STAFF_EXPENSE') ? unitCost : Number(prod.unit_selling_price || prod.selling_price || 0);
            
            const subtotalPrice = Number(item.qty) * unitPrice;
            const subtotalCost = Number(item.qty) * unitCost;

            await client.query(`
                INSERT INTO order_items (order_id, product_id, quantity, unit_price, unit_cost, subtotal_price, subtotal_cost, packaging_name, packaging_cost)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [orderId, prod.id, item.qty, unitPrice, unitCost, subtotalPrice, subtotalCost, packaging.name, packagingCost]);

            // خصم الصنف المباشر
            if (prod.product_type === 'DIRECT_UNIT') {
                await client.query(`
                    UPDATE location_inventory SET quantity = quantity - $1
                    WHERE product_id = $2 AND location_id = $3
                `, [item.qty, prod.id, frontLocationId]);
            } 
            // خصم خامات التحضير الدائمة (مثل البن/الشاي)
            else if (prod.product_type === 'PREPARED_DRINK') {
                const boms = await client.query("SELECT * FROM product_boms WHERE parent_product_id = $1 AND rule = 'ALWAYS'", [prod.id]);
                for (const bom of boms.rows) {
                    await client.query(`
                        UPDATE location_inventory SET quantity = GREATEST(0, quantity - $1)
                        WHERE product_id = $2 AND location_id = $3
                    `, [bom.quantity_required * item.qty, bom.ingredient_product_id, frontLocationId]);
                }
            }

            // خصم خامات وعاء التقديم المختار (العلبة / الكوب / الطبق / الشوكة)
            if (packaging.items && Array.isArray(packaging.items)) {
                for (const packItem of packaging.items) {
                    await client.query(`
                        UPDATE location_inventory SET quantity = GREATEST(0, quantity - $1)
                        WHERE product_id = $2 AND location_id = $3
                    `, [Number(packItem.qty || 1) * item.qty, packItem.product_id, frontLocationId]);
                }
            }
        }

        // استهلاك موظف أو حساب آجل
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

// توريد شحنة بضاعة جديدة بأمان تام أثناء فتح الشيفتات (+ Restock)
app.post('/api/admin/restock-inward', async (req, res) => {
    const { product_id, quantity, destination } = req.body; // destination: 'FRONT_DISPLAY' or 'BACKROOM'
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const qty = Number(quantity);
        if (qty <= 0) throw new Error('الكمية الموردة غير صحيحة');

        const locRes = await client.query('SELECT id FROM inventory_locations WHERE code = $1 LIMIT 1', [destination || 'BACKROOM']);
        const locationId = locRes.rows[0].id;

        // زيادة تراكمية آمنة (Atomic Increment)
        await client.query(`
            INSERT INTO location_inventory (product_id, location_id, quantity)
            VALUES ($1, $2, $3)
            ON CONFLICT (product_id, location_id) 
            DO UPDATE SET quantity = location_inventory.quantity + EXCLUDED.quantity
        `, [product_id, locationId, qty]);

        await client.query('COMMIT');
        res.json({ success: true, message: 'تمت إضافة الشحنة بنجاح' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.listen(PORT, () => console.log(`🚀 النظام يعمل بنجاح على المنفذ ${PORT} - حواسب كافيه`));
