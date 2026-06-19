// ── Config ────────────────────────────────────────────
const CONFIG = {
  SUPABASE_URL: 'https://ffveqdbfwzvdtspdcbbs.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmdmVxZGJmd3p2ZHRzcGRjYmJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3ODk1NTMsImV4cCI6MjA5NzM2NTU1M30.jJNLVNOnubhTjzx_AoMgAOXHUNNzIpMYwWt9NrQNbYs',

  // Binance API (free, no key needed)
  BINANCE_API: 'https://api.binance.com/api/v3',

  // How many top coins to scan (by volume)
  TOP_COINS_COUNT: 100,

  // Auto-refresh interval (seconds)
  REFRESH_INTERVAL: 300, // 5 minutes

  // Outcome check delay (milliseconds)
  OUTCOME_CHECK_DELAY: 2 * 60 * 60 * 1000, // 2 hours

  // Timeframes to scan
  TIMEFRAMES: ['15m', '30m', '1h', '4h'],

  // Minimum score to show signal
  MIN_SCORE: 60,

  // Candle limit for analysis
  CANDLE_LIMIT: 100,
};
