/**
 * Hawasb Cafe POS - Production Server Entry Point
 */

require('dotenv').config();
const app = require('./app');
const db = require('./db');

// Hardening Bug J: Prevent server startup if JWT_SECRET is unset or using unsafe defaults
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.trim() === '' || jwtSecret === 'secret_key') {
  console.error('\n================================================================');
  console.error('FATAL CONFIGURATION ERROR:');
  console.error('process.env.JWT_SECRET must be set to a secure, non-default value.');
  console.error('Refusing to start POS server in an insecure state.');
  console.error('================================================================\n');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

// Test DB Connectivity on boot
db.query('SELECT NOW() as db_time')
  .then((res) => {
    console.log(`[Database] PostgreSQL connected successfully at ${res.rows[0].db_time}`);
    app.listen(PORT, () => {
      console.log(`[Hawasb Cafe POS] Server running on port ${PORT} in ${process.env.NODE_ENV || 'production'} mode`);
    });
  })
  .catch((err) => {
    console.error('[Database] Failed to connect to PostgreSQL:', err.message);
    process.exit(1);
  });