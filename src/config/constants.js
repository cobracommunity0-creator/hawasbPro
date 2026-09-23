/**
 * Hawasb Cafe POS - Central Business Constants & Configuration Keys
 */

module.exports = {
  // Commission settings defaults
  DEFAULT_COMMISSION_RATE: 0.10,
  DEFAULT_COMMISSION_PAYMENT_METHODS: ['cash', 'vodafone_cash', 'credit_shakak'],

  // Supported payment channels
  PAYMENT_METHODS: {
    CASH: 'cash',
    VODAFONE_CASH: 'vodafone_cash',
    CREDIT_SHAKAK: 'credit_shakak',
  },

  // Shift status progression
  SHIFT_STATUS: {
    OPEN: 'open',
    PENDING_HANDOVER: 'pending_handover',
    CLOSED: 'closed',
    FORCE_CLOSED: 'force_closed',
  },

  // User authorization roles
  ROLES: {
    OWNER: 'owner',
    CASHIER: 'cashier',
  },

  // System settings database keys
  SETTINGS_KEYS: {
    COMMISSION_RATE: 'commission_rate',
    COMMISSION_PAYMENT_METHODS: 'commission_payment_methods',
    BLOCK_NEGATIVE_STOCK: 'block_negative_stock',
    DAILY_FIXED_COST: 'daily_fixed_cost',
  },
};