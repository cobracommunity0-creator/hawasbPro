const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve static assets from public, with root fallback
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
}
app.use(express.static(__dirname));

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/hawasb_db';

const pool = new Pool({
    connectionString: connectionString,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                pin VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL
            );

            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                category VARCHAR(255) DEFAULT 'عام',
                cost_price NUMERIC DEFAULT 0,
                selling_price NUMERIC DEFAULT 0,
                stock_quantity NUMERIC DEFAULT 0,
                unit_type VARCHAR(50) DEFAULT 'قطعة',
                is_drink INT DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS product_ingredients (
                id SERIAL PRIMARY KEY,
                parent_product_id INT REFERENCES products(id) ON DELETE CASCADE,
                ingredient_id INT REFERENCES products(id) ON DELETE CASCADE,
                quantity_required NUMERIC DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS product_variants (
                id SERIAL PRIMARY KEY,
                product_id INT REFERENCES products(id) ON DELETE CASCADE,
                variant_name VARCHAR(255) NOT NULL,
                selling_price NUMERIC DEFAULT 0,
                cost_price NUMERIC DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS shifts (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE SET NULL,
                start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                end_time TIMESTAMP,
                status VARCHAR(50) DEFAULT 'open',
                shift_date VARCHAR(50),
                closing_amount NUMERIC DEFAULT 0,
                notes TEXT
            );

            CREATE TABLE IF NOT EXISTS sales (
                id SERIAL PRIMARY KEY,
                shift_id INT REFERENCES shifts(id) ON DELETE CASCADE,
                product_id INT REFERENCES products(id) ON DELETE SET NULL,
                item_name VARCHAR(255),
                quantity NUMERIC DEFAULT 1,
                unit_price NUMERIC DEFAULT 0,
                unit_cost NUMERIC DEFAULT 0,
                is_staff_order INT DEFAULT 0,
                tip_amount NUMERIC DEFAULT 0,
                status VARCHAR(50) DEFAULT 'completed',
                pc_number VARCHAR(50) DEFAULT 'الكاشير المباشر',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            ALTER TABLE sales ADD COLUMN IF NOT EXISTS item_name VARCHAR(255);
            ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closing_amount NUMERIC DEFAULT 0;

            INSERT INTO users (id, username, pin, role) 
            VALUES (1, 'admin', '1234', 'admin'), (2, 'cashier', '1111', 'cashier')
            ON CONFLICT (username) DO NOTHING;
        `);
        console.log('✅ تم إعداد وتحديث قاعدة بيانات حواسب كافيه بنجاح.');
    } catch (err) {
        console.error('❌ خطأ في إعداد قاعدة البيانات:', err.message);
    }
}
initDB();

// 1. Authentication
app.post('/api/login', async (req, res) => {
    const { username, pin } = req.body;
    try {
        const userRes = await pool.query('SELECT id, username, role FROM users WHERE username = $1 AND pin = $2', [username, pin]);
        const user = userRes.rows[0];

        if (!user) return res.status(401).json({ error: 'اسم المستخدم أو رمز PIN غير صحيح' });

        if (user.role === 'cashier') {
            const shiftRes = await pool.query("SELECT * FROM shifts WHERE user_id = $1 AND status = 'open' ORDER BY id DESC LIMIT 1", [user.id]);
            res.json({ user, activeShift: shiftRes.rows[0] || null });
        } else {
            res.json({ user, activeShift: null });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. User Management (CRUD)
app.get('/api/admin/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, role FROM users ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/users', async (req, res) => {
    const { id, username, pin, role } = req.body;
    try {
        if (id) {
            if (pin && pin.trim() !== '') {
                await pool.query('UPDATE users SET username = $1, role = $2, pin = $3 WHERE id = $4', [username, role, pin, id]);
            } else {
                await pool.query('UPDATE users SET username = $1, role = $2 WHERE id = $3', [username, role, id]);
            }
            res.json({ message: 'تم تحديث بيانات المستخدم' });
        } else {
            const newUsr = await pool.query('INSERT INTO users (username, pin, role) VALUES ($1, $2, $3) RETURNING id', [username, pin, role]);
            res.json({ id: newUsr.rows[0].id });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/users/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
        res.json({ message: 'تم حذف المستخدم بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Shift Management
app.post('/api/start-shift', async (req, res) => {
    const { user_id } = req.body;
    const shiftDate = new Date().toISOString().split('T')[0];
    try {
        const activeCheck = await pool.query("SELECT id FROM shifts WHERE user_id = $1 AND status = 'open' LIMIT 1", [user_id]);
        if (activeCheck.rows.length > 0) {
            return res.json({ shift_id: activeCheck.rows[0].id });
        }
        const result = await pool.query(
            "INSERT INTO shifts (user_id, start_time, status, shift_date) VALUES ($1, NOW(), 'open', $2) RETURNING id",
            [user_id, shiftDate]
        );
        res.json({ shift_id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/shift-summary/:shift_id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                COALESCE(SUM(quantity * unit_price), 0) as total_sales,
                COALESCE(SUM(quantity * unit_cost), 0) as total_cost,
                COALESCE(SUM(quantity * (unit_price - unit_cost)), 0) as total_profit,
                COALESCE(SUM(tip_amount), 0) as total_tips
            FROM sales WHERE shift_id = $1 AND status = 'completed'
        `, [req.params.shift_id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/end-shift', async (req, res) => {
    const { shift_id, closing_amount, notes } = req.body;
    try {
        await pool.query(
            "UPDATE shifts SET end_time = NOW(), status = 'closed', closing_amount = $1, notes = $2 WHERE id = $3",
            [closing_amount || 0, notes || '', shift_id]
        );
        res.json({ message: 'تم إغلاق الشيفت بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Live Shift Notes Auto-save
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

// 4. Products & Recipes Management
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                p.*,
                COALESCE((
                    SELECT SUM(pi.quantity_required * ing.cost_price)
                    FROM product_ingredients pi
                    JOIN products ing ON pi.ingredient_id = ing.id
                    WHERE pi.parent_product_id = p.id
                ), 0) + COALESCE(p.cost_price, 0) as calculated_cost
            FROM products p 
            ORDER BY p.id ASC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/products', async (req, res) => {
    const { id, name, category, cost_price, selling_price, stock_quantity, unit_type, is_drink } = req.body;
    const unit = unit_type || 'قطعة';
    try {
        if (id) {
            await pool.query(
                'UPDATE products SET name=$1, category=$2, cost_price=$3, selling_price=$4, stock_quantity=$5, unit_type=$6, is_drink=$7 WHERE id=$8',
                [name, category, cost_price || 0, selling_price || 0, stock_quantity || 0, unit, is_drink ? 1 : 0, id]
            );
            res.json({ message: 'تم التحديث بنجاح' });
        } else {
            const result = await pool.query(
                'INSERT INTO products (name, category, cost_price, selling_price, stock_quantity, unit_type, is_drink) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
                [name, category, cost_price || 0, selling_price || 0, stock_quantity || 0, unit, is_drink ? 1 : 0]
            );
            res.json({ id: result.rows[0].id });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/products/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
        res.json({ message: 'تم حذف المنتج بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Product Ingredients
app.post('/api/product-ingredients', async (req, res) => {
    const { parent_product_id, ingredients } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM product_ingredients WHERE parent_product_id = $1', [parent_product_id]);
        for (const item of (ingredients || [])) {
            await client.query(
                'INSERT INTO product_ingredients (parent_product_id, ingredient_id, quantity_required) VALUES ($1, $2, $3)',
                [parent_product_id, item.ingredient_id, item.quantity_required]
            );
        }
        await client.query('COMMIT');
        res.json({ message: 'تم حفظ المكونات بنجاح' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.get('/api/product-ingredients/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT pi.*, p.name, p.unit_type, p.cost_price FROM product_ingredients pi JOIN products p ON pi.ingredient_id = p.id WHERE pi.parent_product_id = $1',
            [req.params.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Product Variants
app.post('/api/product-variants', async (req, res) => {
    const { product_id, variants } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM product_variants WHERE product_id = $1', [product_id]);
        for (const v of (variants || [])) {
            await client.query(
                'INSERT INTO product_variants (product_id, variant_name, selling_price, cost_price) VALUES ($1, $2, $3, $4)',
                [product_id, v.variant_name, v.selling_price || 0, v.cost_price || 0]
            );
        }
        await client.query('COMMIT');
        res.json({ message: 'تم حفظ الخيارات بنجاح' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.get('/api/product-variants/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM product_variants WHERE product_id = $1 ORDER BY id ASC', [req.params.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Checkout with Transactions & Precise Stock Deductions
app.post('/api/checkout', async (req, res) => {
    const { shift_id, cart, is_staff_order, paid_amount, pc_number } = req.body;
    if (!cart || cart.length === 0) return res.status(400).json({ error: 'السلة فارغة' });

    let orderTotal = cart.reduce((sum, item) => {
        const itemPrice = is_staff_order ? Number(item.cost) : Number(item.price);
        return sum + (itemPrice * item.qty);
    }, 0);

    const paid = Number(paid_amount) || 0;
    let calculatedTip = (paid > orderTotal && orderTotal > 0) ? (paid - orderTotal) : 0;
    const targetPc = pc_number || 'الكاشير المباشر';

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        for (let i = 0; i < cart.length; i++) {
            const item = cart[i];
            const finalPrice = is_staff_order ? Number(item.cost) : Number(item.price);
            const itemTip = (i === 0) ? calculatedTip : 0;

            await client.query(
                'INSERT INTO sales (shift_id, product_id, item_name, quantity, unit_price, unit_cost, is_staff_order, tip_amount, pc_number, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
                [shift_id, item.id, item.name, item.qty, finalPrice, item.cost, is_staff_order ? 1 : 0, itemTip, targetPc, 'completed']
            );

            // Deduct ingredients if configured; otherwise deduct product inventory
            const ingRes = await client.query('SELECT * FROM product_ingredients WHERE parent_product_id = $1', [item.id]);
            if (ingRes.rows.length > 0) {
                for (const ing of ingRes.rows) {
                    await client.query(
                        'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
                        [ing.quantity_required * item.qty, ing.ingredient_id]
                    );
                }
            } else {
                await client.query(
                    'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2 AND is_drink = 0',
                    [item.qty, item.id]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, tip: calculatedTip, total: orderTotal });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// 6. Refund Transaction
app.post('/api/sales/refund/:id', async (req, res) => {
    const saleId = req.params.id;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const saleRes = await client.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [saleId]);
        if (saleRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'الطلب غير موجود' });
        }

        const sale = saleRes.rows[0];
        if (sale.status === 'refunded') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'تم إرجاع هذا الطلب بالفعل' });
        }

        await client.query("UPDATE sales SET status = 'refunded' WHERE id = $1", [saleId]);

        if (sale.product_id) {
            const ingRes = await client.query('SELECT * FROM product_ingredients WHERE parent_product_id = $1', [sale.product_id]);
            if (ingRes.rows.length > 0) {
                for (const ing of ingRes.rows) {
                    await client.query(
                        'UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2',
                        [ing.quantity_required * sale.quantity, ing.ingredient_id]
                    );
                }
            } else {
                await client.query(
                    'UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2 AND is_drink = 0',
                    [sale.quantity, sale.product_id]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'تم إرجاع الصنف بنجاح وتحديث المخزون' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// 7. Live Shift & Sales Details
app.get('/api/admin/shift-live-details/:shift_id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                s.id as sale_id, 
                COALESCE(s.item_name, p.name, 'صنف محذوف') as name, 
                COALESCE(p.category, 'عام') as category, 
                s.quantity, 
                s.unit_price, 
                s.unit_cost, 
                (s.quantity * s.unit_price) as subtotal, 
                s.is_staff_order, 
                s.status, 
                s.pc_number, 
                s.created_at 
            FROM sales s 
            LEFT JOIN products p ON s.product_id = p.id 
            WHERE s.shift_id = $1 
            ORDER BY s.created_at DESC
        `, [req.params.shift_id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 8. Admin Dashboard Aggregation
app.get('/api/admin/dashboard', async (req, res) => {
    try {
       const shiftsRes = await pool.query(`
            SELECT 
                s.id, s.start_time, s.end_time, s.status, s.shift_date, s.closing_amount, s.notes, u.username,
                COALESCE(SUM(CASE WHEN sa.status = 'completed' THEN sa.quantity * sa.unit_price ELSE 0 END), 0) as total_sales,
                COALESCE(SUM(CASE WHEN sa.status = 'completed' THEN sa.quantity * sa.unit_cost ELSE 0 END), 0) as total_cost,
                COALESCE(SUM(CASE WHEN sa.status = 'completed' THEN sa.quantity * (sa.unit_price - sa.unit_cost) ELSE 0 END), 0) as total_profit,
                COALESCE(SUM(CASE WHEN sa.status = 'completed' THEN sa.tip_amount ELSE 0 END), 0) as total_tips
            FROM shifts s
            LEFT JOIN users u ON s.user_id = u.id
            LEFT JOIN sales sa ON s.id = sa.shift_id
            GROUP BY s.id, u.username 
            ORDER BY s.id DESC
        `);

        const collectedRes = await pool.query("SELECT COALESCE(SUM(quantity * unit_cost), 0) as collected_stock_cost FROM sales WHERE status = 'completed'");
        const remainingRes = await pool.query('SELECT COALESCE(SUM(stock_quantity * cost_price), 0) as remaining_stock_cost FROM products WHERE is_drink = 0');
        const productsRes = await pool.query(`
            SELECT 
                p.*,
                COALESCE((
                    SELECT SUM(pi.quantity_required * ing.cost_price)
                    FROM product_ingredients pi
                    JOIN products ing ON pi.ingredient_id = ing.id
                    WHERE pi.parent_product_id = p.id
                ), 0) + COALESCE(p.cost_price, 0) as calculated_cost
            FROM products p 
            ORDER BY p.id ASC
        `);

        res.json({
            shifts: shiftsRes.rows,
            stats: {
                collected_stock_cost: collectedRes.rows[0].collected_stock_cost,
                remaining_stock_cost: remainingRes.rows[0].remaining_stock_cost
            },
            products: productsRes.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/force-close-shift', async (req, res) => {
    try {
        await pool.query("UPDATE shifts SET end_time = NOW(), status = 'closed', notes = 'إغلاق إجباري بواسطة المسؤول' WHERE id = $1", [req.body.shift_id]);
        res.json({ message: 'تم الإغلاق بنجاح' });
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
