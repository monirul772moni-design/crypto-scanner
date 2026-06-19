// ── Config ────────────────────────────────────────────
const CONFIG = {
  SUPABASE_URL:      'https://ffveqdbfwzvdtspdcbbs.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmdmVxZGJmd3p2ZHRzcGRjYmJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3ODk1NTMsImV4cCI6MjA5NzM2NTU1M30.jJNLVNOnubhTjzx_AoMgAOXHUNNzIpMYwWt9NrQNbYs',

  // Binance API (free, no key needed)
  BINANCE_API: 'https://api.binance.com/api/v3',

  // Top coins to scan by volume
  TOP_COINS_COUNT: 100,

  // Auto-refresh interval (seconds)
  REFRESH_INTERVAL: 300,

  // Outcome check delay — 2 hours
  OUTCOME_CHECK_DELAY: 2 * 60 * 60 * 1000,

  // Timeframes
  TIMEFRAMES: ['15m', '30m', '1h', '4h'],

  // Minimum score to show signal
  MIN_SCORE: 60,

  // Candle limit per request
  CANDLE_LIMIT: 100,

  // Volume: last candle must be X times average volume
  VOLUME_MULTIPLIER: 1.2,

  // Duplicate signal block window (ms) — 1 hour
  DUPLICATE_WINDOW: 60 * 60 * 1000,
};
