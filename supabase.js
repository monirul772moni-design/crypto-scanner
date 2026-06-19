// ── Supabase DB Layer ─────────────────────────────────
let supabaseClient = null;

function initSupabase() {
  const { createClient } = supabase;
  supabaseClient = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  return supabaseClient;
}

// Save a signal to DB
async function saveSignal(signal) {
  const { data, error } = await supabaseClient
    .from('signals')
    .insert([{
      symbol:           signal.symbol,
      timeframe:        signal.timeframe,
      signal_type:      signal.signal,
      strategy:         signal.strategy,
      price_location:   signal.priceLocation,
      support_price:    signal.supportPrice,
      resistance_price: signal.resistancePrice,
      rsi_value:        signal.rsi,
      macd_signal:      signal.macdSignal,
      breakout:         signal.breakout,
      retest:           signal.retest,
      score:            signal.score,
      grade:            signal.grade,
      entry_price:      signal.entryPrice,
    }])
    .select()
    .single();

  if (error) { console.error('saveSignal error:', error); return null; }

  // Create a PENDING outcome row
  await supabaseClient.from('signal_outcomes').insert([{
    signal_id:   data.id,
    symbol:      signal.symbol,
    entry_price: signal.entryPrice,
    signal_type: signal.signal,
    outcome:     'PENDING',
  }]);

  // Schedule outcome check after 2 hours
  scheduleOutcomeCheck(data.id, signal.symbol, signal.entryPrice, signal.signal);

  return data;
}

// Load today's signals from DB
async function loadTodaySignals() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data, error } = await supabaseClient
    .from('signals')
    .select('*')
    .gte('created_at', today.toISOString())
    .order('created_at', { ascending: false });

  if (error) { console.error('loadTodaySignals error:', error); return []; }
  return data || [];
}

// Load recent history (last 50 records)
async function loadHistory() {
  const { data, error } = await supabaseClient
    .from('signals')
    .select(`
      *,
      signal_outcomes (outcome, pnl_percent, exit_price, checked_at)
    `)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) { console.error('loadHistory error:', error); return []; }
  return data || [];
}

// Load outcomes for performance section
async function loadOutcomes() {
  const { data, error } = await supabaseClient
    .from('signal_outcomes')
    .select('*')
    .neq('outcome', 'PENDING')
    .order('checked_at', { ascending: false })
    .limit(30);

  if (error) { console.error('loadOutcomes error:', error); return []; }
  return data || [];
}

// Update outcome after 2 hours
async function updateOutcome(signalId, exitPrice, entryPrice, signalType) {
  let pnl = ((exitPrice - entryPrice) / entryPrice) * 100;
  if (signalType === 'SELL') pnl = -pnl;
  const outcome = pnl > 0 ? 'WIN' : 'LOSS';

  await supabaseClient
    .from('signal_outcomes')
    .update({
      exit_price:  exitPrice,
      outcome:     outcome,
      pnl_percent: parseFloat(pnl.toFixed(2)),
      checked_at:  new Date().toISOString(),
    })
    .eq('signal_id', signalId);

  return { outcome, pnl: parseFloat(pnl.toFixed(2)) };
}

// Schedule the 2-hour outcome check
function scheduleOutcomeCheck(signalId, symbol, entryPrice, signalType) {
  setTimeout(async () => {
    try {
      const price = await getCurrentPrice(symbol);
      if (!price) return;
      const result = await updateOutcome(signalId, price, entryPrice, signalType);
      showToast(`${symbol} outcome: ${result.outcome} (${result.pnl > 0 ? '+' : ''}${result.pnl}%)`, result.outcome === 'WIN' ? 'buy' : 'sell');
      await refreshDashboard();
    } catch (e) {
      console.error('Outcome check failed:', e);
    }
  }, CONFIG.OUTCOME_CHECK_DELAY);
}

// Win rate calculation
async function getWinRate() {
  const { data, error } = await supabaseClient
    .from('signal_outcomes')
    .select('outcome')
    .neq('outcome', 'PENDING');

  if (error || !data || data.length === 0) return null;
  const wins = data.filter(d => d.outcome === 'WIN').length;
  return Math.round((wins / data.length) * 100);
    }
