const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/hawasb_db',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// قارئ CSV بدون الحاجة لتثبيت أي مكتبات إضافية
function parseCSV(filename) {
    const filePath = path.join(__dirname, filename);
    if (!fs.existsSync(filePath)) {
        throw new Error(`الملف ${filename} غير موجود في المجلد الحالي`);
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split(/\r?\n/).filter(l => l.trim() !== '');
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    
    return lines.slice(1).map(line => {
        const values = [];
        let curr = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') inQuotes = !inQuotes;
            else if (c === ',' && !inQuotes) {
                values.push(curr.trim().replace(/^"|"$/g, ''));
                curr = '';
            } else {
                curr += c;
            }
        }
        values.push(curr.trim().replace(/^"|"$/g, ''));
        const row = {};
        headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
        return row;
    });
}

const catMap = {
    '1': 'خامات ومواد تغليف',
    'مشروبات ساقعه': 'مشروبات ساقعة',
    'شيبسيات و اندومي': 'شيبسيات وسناكس',
    'البسكويت والحلويات': 'البسكويت والحلويات',
    'مشروبات سخنه': 'مشروبات ساخنة',
    'منتجات مركبه ووجبات': 'منتجات مركبة ووجبات',
    'ماكولات': 'مأكولات',
    'الهارد': 'خدمات وأخرى'
};

async function runImport() {
    const client = await pool.connect();
    try {
        console.log('🚀 بدء رفع بيانات الأصناف والخامات والأحجام...');
        await client.query('BEGIN');

        // 1. التأكد من الجداول
        await client.query(`
            CREATE TABLE IF NOT EXISTS product_variants (
                id SERIAL PRIMARY KEY,
                product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                variant_name VARCHAR(100) NOT NULL,
                selling_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
                cost_price NUMERIC(10, 4) NOT NULL DEFAULT 0.0000
            );

            CREATE TABLE IF NOT EXISTS product_boms (
                id SERIAL PRIMARY KEY,
                parent_product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                ingredient_product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                quantity_required NUMERIC(10, 4) NOT NULL DEFAULT 1.0000,
                rule VARCHAR(30) NOT NULL DEFAULT 'ALWAYS'
            );
        `);

        // 2. إدخال الأقسام
        const categories = Object.values(catMap);
        for (const cat of categories) {
            await client.query('INSERT INTO product_categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [cat]);
        }

        // 3. رفع المنتجات (products_rows.csv)
        const products = parseCSV('products_rows.csv');
        console.log(`📦 جاري معالجة ${products.length} صنف...`);

        const frontLoc = await client.query("SELECT id FROM inventory_locations WHERE code = 'FRONT_DISPLAY' LIMIT 1");
        const backLoc = await client.query("SELECT id FROM inventory_locations WHERE code = 'BACKROOM' LIMIT 1");
        const frontId = frontLoc.rows[0].id;
        const backId = backLoc.rows[0].id;

        for (const p of products) {
            const id = parseInt(p.id);
            const name = p.name.trim();
            const rawCat = p.category ? p.category.trim() : 'عام';
            const catName = catMap[rawCat] || 'عام';
            const costPrice = parseFloat(p.cost_price) || 0;
            const sellingPrice = parseFloat(p.selling_price) || 0;
            const stockQty = parseFloat(p.stock_quantity) || 0;
            const unitType = p.unit_type ? p.unit_type.trim() : 'قطعة';
            const isDrink = parseInt(p.is_drink) || 0;

            let productType = 'DIRECT_UNIT';
            if (catName === 'خامات ومواد تغليف') productType = 'PACKAGING_MATERIAL';
            else if (['شاي', 'قهوه', 'موهيتو', 'سندوتش بطاطس', 'طبق بطاطس'].includes(name)) productType = 'PREPARED_DRINK';

            await client.query(`
                INSERT INTO products (id, name, category, cost_price, unit_cost_price, selling_price, unit_selling_price, stock_quantity, unit_type, is_drink, product_type, is_active)
                VALUES ($1, $2, $3, $4, $4, $5, $5, $6, $7, $8, $9, TRUE)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    category = EXCLUDED.category,
                    cost_price = EXCLUDED.cost_price,
                    unit_cost_price = EXCLUDED.unit_cost_price,
                    selling_price = EXCLUDED.selling_price,
                    unit_selling_price = EXCLUDED.unit_selling_price,
                    stock_quantity = EXCLUDED.stock_quantity,
                    unit_type = EXCLUDED.unit_type,
                    is_drink = EXCLUDED.is_drink,
                    product_type = EXCLUDED.product_type,
                    is_active = TRUE
            `, [id, name, catName, costPrice, sellingPrice, stockQty, unitType, isDrink, productType]);

            // رصيد الواجهة = العدد الفعلي المسجل بالملف
            await client.query(`
                INSERT INTO location_inventory (product_id, location_id, quantity)
                VALUES ($1, $2, $3)
                ON CONFLICT (product_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity
            `, [id, frontId, stockQty]);

            // رصيد المخزن الاحتياطي
            const reserveQty = stockQty > 0 ? (stockQty * 2) : 50;
            await client.query(`
                INSERT INTO location_inventory (product_id, location_id, quantity)
                VALUES ($1, $2, $3)
                ON CONFLICT (product_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity
            `, [id, backId, reserveQty]);
        }

        // 4. رفع تركيبات الخامات (product_ingredients_rows.csv)
        const ingredients = parseCSV('product_ingredients_rows.csv');
        console.log(`🧪 جاري معالجة ${ingredients.length} تركيبة خامات (BOM)...`);
        await client.query('DELETE FROM product_boms');

        for (const ing of ingredients) {
            await client.query(`
                INSERT INTO product_boms (parent_product_id, ingredient_product_id, quantity_required, rule)
                VALUES ($1, $2, $3, 'ALWAYS')
            `, [parseInt(ing.parent_product_id), parseInt(ing.ingredient_id), parseFloat(ing.quantity_required) || 1]);
        }

        // 5. رفع خيارات الأحجام (product_variants_rows.csv)
        const variants = parseCSV('product_variants_rows.csv');
        console.log(`☕ جاري معالجة ${variants.length} خيار أحجام وأسعار (Variants)...`);
        await client.query('DELETE FROM product_variants');

        for (const v of variants) {
            await client.query(`
                INSERT INTO product_variants (id, product_id, variant_name, selling_price, cost_price)
                VALUES ($1, $2, $3, $4, $5)
            `, [parseInt(v.id), parseInt(v.product_id), v.variant_name.trim(), parseFloat(v.selling_price) || 0, parseFloat(v.cost_price) || 0]);
        }

        // 6. ضبط الترقيم التلقائي (Sequences)
        await client.query(`
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'products_id_seq') THEN
                    PERFORM setval('products_id_seq', COALESCE((SELECT MAX(id) FROM products), 1));
                END IF;
                IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'product_variants_id_seq') THEN
                    PERFORM setval('product_variants_id_seq', COALESCE((SELECT MAX(id) FROM product_variants), 1));
                END IF;
                IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'product_boms_id_seq') THEN
                    PERFORM setval('product_boms_id_seq', COALESCE((SELECT MAX(id) FROM product_boms), 1));
                END IF;
            END $$;
        `);

        await client.query('COMMIT');
        console.log('✅ تم رفع وتحديث كافة المنتجات والخامات والأحجام بنجاح 100%!');
        process.exit(0);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ حدث خطأ أثناء الرفع:', err.message);
        process.exit(1);
    } finally {
        client.release();
    }
}

runImport();
