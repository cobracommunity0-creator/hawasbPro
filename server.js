const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// الاتصال بقاعدة البيانات (يمكن تعديل الرابط بحسب إعدادات المحلية أو السيرفر)
const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/hawasb_db';

const pool = new Pool({
    connectionString: connectionString,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// إنشاء وتحديث الجداول تلقائياً عند التشغيل
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
                user_id INT REFERENCES users(id),
                start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                end_time TIMESTAMP,
                status VARCHAR(50) DEFAULT 'open',
                shift_date VARCHAR(50),
                notes TEXT
            );

            CREATE TABLE IF NOT EXISTS sales (
                id SERIAL PRIMARY KEY,
                shift_id INT REFERENCES shifts(id),
                product_id INT REFERENCES products(id),
                quantity NUMERIC DEFAULT 1,
                unit_price NUMERIC DEFAULT 0,
                unit_cost NUMERIC DEFAULT 0,
                is_staff_order INT DEFAULT 0,
                tip_amount NUMERIC DEFAULT 0,
                status VARCHAR(50) DEFAULT 'completed',
                pc_number VARCHAR(50) DEFAULT 'الكاشير المباشر',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            INSERT INTO users (id, username, pin, role) 
            VALUES (1, 'admin', '1234', 'admin'), (2, 'cashier', '1111', 'cashier')
            ON CONFLICT (username) DO NOTHING;
        `);
        console.log('✅ تم إعداد قاعدة بيانات حواسب كافيه بنجاح.');
    } catch (err) {
        console.error('❌ خطأ في الاتصال بقاعدة البيانات PostgreSQL:', err.message);
    }
}
initDB();

// 1. تسجيل الدخول
app.post('/api/login', async (req, res) => {
    const { username, pin } = req.body;
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE username = $1 AND pin = $2', [username, pin]);
        const user = userRes.rows[0];

        if (!user) return res.status(401).json({ message: 'اسم المستخدم أو رمز PIN غير صحيح' });

        if (user.role === 'cashier') {
            const shiftRes = await pool.query("SELECT * FROM shifts WHERE user_id = $1 AND status = 'open'", [user.id]);
            res.json({ user, activeShift: shiftRes.rows[0] || null });
        } else {
            res.json({ user, activeShift: null });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. إدارة المستخدمين (Users CRUD)
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

// 3. بدء شيفت جديد
app.post('/api/start-shift', async (req, res) => {
    const { user_id } = req.body;
    const now = new Date();
    const shiftDate = now.toISOString().split('T')[0];
    try {
        const result = await pool.query(
            "INSERT INTO shifts (user_id, start_time, status, shift_date) VALUES ($1, NOW(), 'open', $2) RETURNING id",
            [user_id, shiftDate]
        );
        res.json({ shift_id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. جلب الأصناف مع التكلفة المجمعة للمكونات
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

// 5. حفظ أو تعديل صنف
app.post('/api/products', async (req, res) => {
    const { id, name, category, cost_price, selling_price, stock_quantity, unit_type, is_drink } = req.body;
    const unit = unit_type || 'قطعة';
    try {
        if (id) {
            await pool.query(
                'UPDATE products SET name=$1, category=$2, cost_price=$3, selling_price=$4, stock_quantity=$5, unit_type=$6, is_drink=$7 WHERE id=$8',
                [name, category, cost_price, selling_price, stock_quantity, unit, is_drink ? 1 : 0, id]
            );
            res.json({ message: 'تم التحديث بنجاح' });
        } else {
            const result = await pool.query(
                'INSERT INTO products (name, category, cost_price, selling_price, stock_quantity, unit_type, is_drink) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
                [name, category, cost_price, selling_price, stock_quantity, unit, is_drink ? 1 : 0]
            );
            res.json({ id: result.rows[0].id });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. حذف صنف
app.delete('/api/products/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
        res.json({ message: 'تم حذف المنتج بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. إدارة المكونات والخامات
app.post('/api/product-ingredients', async (req, res) => {
    const { parent_product_id, ingredients } = req.body;
    try {
        await pool.query('DELETE FROM product_ingredients WHERE parent_product_id = $1', [parent_product_id]);
        for (const item of ingredients) {
            await pool.query(
                'INSERT INTO product_ingredients (parent_product_id, ingredient_id, quantity_required) VALUES ($1, $2, $3)',
                [parent_product_id, item.ingredient_id, item.quantity_required]
            );
        }
        res.json({ message: 'تم حفظ المكونات بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
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

// 8. الأحجام والخيارات (Variants)
app.post('/api/product-variants', async (req, res) => {
    const { product_id, variants } = req.body;
    try {
        await pool.query('DELETE FROM product_variants WHERE product_id = $1', [product_id]);
        for (const v of variants) {
            await pool.query(
                'INSERT INTO product_variants (product_id, variant_name, selling_price, cost_price) VALUES ($1, $2, $3, $4)',
                [product_id, v.variant_name, v.selling_price, v.cost_price]
            );
        }
        res.json({ message: 'تم حفظ الخيارات بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
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

// 9. إتمام عملية البيع
app.post('/api/checkout', async (req, res) => {
    const { shift_id, cart, is_staff_order, paid_amount, pc_number } = req.body;
    let totalCartPrice = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    let calculatedTip = (paid_amount > totalCartPrice && totalCartPrice > 0) ? (paid_amount - totalCartPrice) : 0;
    const targetPc = pc_number || 'الكاشير المباشر';

    try {
        for (let i = 0; i < cart.length; i++) {
            const item = cart[i];
            let finalPrice = is_staff_order ? item.cost : item.price;
            let itemTip = (i === 0) ? calculatedTip : 0;

            await pool.query(
                'INSERT INTO sales (shift_id, product_id, quantity, unit_price, unit_cost, is_staff_order, tip_amount, pc_number, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                [shift_id, item.id, item.qty, finalPrice, item.cost, is_staff_order ? 1 : 0, itemTip, targetPc, 'completed']
            );

            // خصم المكونات والخامات من المخزون
            const ingRes = await pool.query('SELECT * FROM product_ingredients WHERE parent_product_id = $1', [item.id]);
            if (ingRes.rows.length > 0) {
                for (const ing of ingRes.rows) {
                    await pool.query('UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2 AND is_drink = 0', [ing.quantity_required * item.qty, ing.ingredient_id]);
                }
            }
            await pool.query('UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2 AND is_drink = 0', [item.qty, item.id]);
        }
        res.json({ success: true, tip: calculatedTip });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 10. إلغاء وإرجاع طلب (Refund System)
app.post('/api/sales/refund/:id', async (req, res) => {
    const saleId = req.params.id;
    try {
        const saleRes = await pool.query('SELECT * FROM sales WHERE id = $1', [saleId]);
        if (saleRes.rows.length === 0) return res.status(404).json({ error: 'الطلب غير موجود' });
        
        const sale = saleRes.rows[0];
        if (sale.status === 'refunded') return res.status(400).json({ error: 'تم إرجاع هذا الطلب بالفعل' });

        await pool.query("UPDATE sales SET status = 'refunded' WHERE id = $1", [saleId]);

        // إعادة الكمية المرتجعة إلى المخزون تلقائياً
        const ingRes = await pool.query('SELECT * FROM product_ingredients WHERE parent_product_id = $1', [sale.product_id]);
        if (ingRes.rows.length > 0) {
            for (const ing of ingRes.rows) {
                await pool.query('UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2 AND is_drink = 0', [ing.quantity_required * sale.quantity, ing.ingredient_id]);
            }
        }
        await pool.query('UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2 AND is_drink = 0', [sale.quantity, sale.product_id]);

        res.json({ success: true, message: 'تم إرجاع الصنف بنجاح وتمت إعادة الكمية للمخزون' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 11. ملخص الشيفت المباشر
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

// 12. إغلاق الشيفت
app.post('/api/end-shift', async (req, res) => {
    const { shift_id, notes } = req.body;
    try {
        await pool.query("UPDATE shifts SET end_time = NOW(), status = 'closed', notes = $1 WHERE id = $2", [notes, shift_id]);
        res.json({ message: 'تم إغلاق الشيفت بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 13. تفاصيل مبيعات الشيفت الحية
app.get('/api/admin/shift-live-details/:shift_id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT s.id as sale_id, p.name, p.category, s.quantity, s.unit_price, s.unit_cost, (s.quantity * s.unit_price) as subtotal, s.is_staff_order, s.status, s.pc_number, s.created_at 
            FROM sales s 
            JOIN products p ON s.product_id = p.id 
            WHERE s.shift_id = $1 ORDER BY s.created_at DESC
        `, [req.params.shift_id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 14. لوحة تحكم المسؤول (Dashboard)
app.get('/api/admin/dashboard', async (req, res) => {
    try {
        const shiftsRes = await pool.query(`
            SELECT 
                s.id, s.start_time, s.end_time, s.status, s.shift_date, s.notes, u.username,
                COALESCE(SUM(CASE WHEN sa.status = 'completed' THEN sa.quantity * sa.unit_price ELSE 0 END), 0) as total_sales,
                COALESCE(SUM(CASE WHEN sa.status = 'completed' THEN sa.quantity * sa.unit_cost ELSE 0 END), 0) as total_cost,
                COALESCE(SUM(CASE WHEN sa.status = 'completed' THEN sa.quantity * (sa.unit_price - sa.unit_cost) ELSE 0 END), 0) as total_profit,
                COALESCE(SUM(CASE WHEN sa.status = 'completed' THEN sa.tip_amount ELSE 0 END), 0) as total_tips
            FROM shifts s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN sales sa ON s.id = sa.shift_id
            GROUP BY s.id, u.username ORDER BY s.id DESC
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

// 15. إغلاق إجباري للشيفت
app.post('/api/admin/force-close-shift', async (req, res) => {
    try {
        await pool.query("UPDATE shifts SET end_time = NOW(), status = 'closed', notes = 'إغلاق إجباري بواسطة المسؤول' WHERE id = $1", [req.body.shift_id]);
        res.json({ message: 'تم الإغلاق بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 شغال على البورت ${PORT} - حواسب كافيه ❤️`));
