/**
 * Hawasb Cafe POS - Express Application Setup
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth.routes');
const ordersRoutes = require('./routes/orders.routes');
const shiftsRoutes = require('./routes/shifts.routes');
const itemsRoutes = require('./routes/items.routes');
const debtsRoutes = require('./routes/debts.routes');
const consumptionsRoutes = require('./routes/consumptions.routes');
const financeRoutes = require('./routes/finance.routes');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static assets from public/
app.use(express.static(path.join(__dirname, '../public')));

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/shifts', shiftsRoutes);
app.use('/api/items', itemsRoutes);
app.use('/api/debts', debtsRoutes);
app.use('/api/consumptions', consumptionsRoutes);
app.use('/api/finance', financeRoutes);

// Catch-all route to serve SPA
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'المسار البرمجي غير موجود' });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Centralized error handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Server Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'حدث خطأ داخلي في الخادم. يرجى مراجعة المسؤول.',
  });
});

module.exports = app;