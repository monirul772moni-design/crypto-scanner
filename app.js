// ── App Controller ────────────────────────────────────

let activeFilter = 'ALL';
let activeTF     = 'ALL';
let countdownVal = CONFIG.REFRESH_INTERVAL;
let countdownTimer = null;
let isScanning = false;
let allSignals = [];

// ── Init ──────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  initSupabase();
  bindUI();
  await refreshDashboard();
  startCountdown();
});

function bindUI() {
  // Manual scan button
  document.getElementById('manualScanBtn').addEventListener('click', () => {
    if (!isScanning) triggerScan();
  });

  // Signal type filters
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderSignals();
    });
  });

  // Timeframe filter
  document.getElementById('tfFilter').addEventListener('change', e => {
    activeTF = e.target.value;
    renderSignals();
  });
}

// ── Countdown + Auto-scan ─────────────────────────────

function startCountdown() {
  countdownVal = CONFIG.REFRESH_INTERVAL;
  clearInterval(countdownTimer);
  countdownTimer = setInterval(async () => {
    countdownVal--;
    document.getElementById('countdown').textContent = countdownVal;
    if (countdownVal <= 0) {
      clearInterval(countdownTimer);
      await triggerScan();
    }
  }, 1000);
}

// ── Scan Trigger ──────────────────────────────────────

async function triggerScan() {
  if (isScanning) return;
  isScanning = true;

  const btn = document.getElementById('manualScanBtn');
  btn.disabled = true;
  btn.textContent = '⟳ Scanning...';

  showScanningOverlay(true);
  showToast('Scanning top 100 coins across 4 timeframes...', 'info');

  try {
    const newSignals = await runFullScan((done, total, symbol) => {
      document.getElementById('scanProgress').textContent = done;
      document.getElementById('scanTotal').textContent    = total;
    });

    // Save new signals to DB
    for (const sig of newSignals) {
      await saveSignal(sig);
    }

    document.getElementById('lastScan').textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    await refreshDashboard();

    showToast(`Scan complete — ${newSignals.length} signal(s) found`, 'info');
  } catch (err) {
    console.error('Scan error:', err);
    showToast('Scan failed. Check console.', 'sell');
  } finally {
    isScanning = false;
    showScanningOverlay(false);
    btn.disabled = false;
    btn.textContent = '⟳ Scan Now';
    startCountdown();
  }
}

// ── Dashboard Refresh ─────────────────────────────────

async function refreshDashboard() {
  const [todaySignals, history, outcomes, winRate] = await Promise.all([
    loadTodaySignals(),
    loadHistory(),
    loadOutcomes(),
    getWinRate(),
  ]);

  allSignals = todaySignals;

  // Stats
  document.getElementById('totalSignals').textContent = todaySignals.length;
  document.getElementById('buyCount').textContent     = todaySignals.filter(s => s.signal_type === 'BUY').length;
  document.getElementById('sellCount').textContent    = todaySignals.filter(s => s.signal_type === 'SELL').length;
  document.getElementById('coinsScanned').textContent = CONFIG.TOP_COINS_COUNT;
  document.getElementById('winRate').textContent      = winRate !== null ? `${winRate}%` : '--%';
  document.getElementById('historyCount').textContent = `${history.length} records`;

  renderSignals();
  renderHistory(history);
  renderPerformance(outcomes);
}

// ── Signal Card Renderer ──────────────────────────────

function renderSignals() {
  const grid = document.getElementById('signalsGrid');
  const empty = document.getElementById('emptyState');

  let filtered = allSignals;
  if (activeFilter !== 'ALL') filtered = filtered.filter(s => s.signal_type === activeFilter);
  if (activeTF !== 'ALL')     filtered = filtered.filter(s => s.timeframe === activeTF);

  if (filtered.length === 0) {
    grid.innerHTML = '';
    grid.appendChild(createEmptyState());
    return;
  }

  grid.innerHTML = filtered.map(sig => createSignalCard(sig)).join('');
}

function createSignalCard(sig) {
  const type  = sig.signal_type;
  const grade = sig.grade === 'A+' ? 'Ap' : sig.grade;
  const time  = new Date(sig.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  return `
    <div class="signal-card ${type.toLowerCase()}">
      <div class="signal-badge ${type.toLowerCase()}">
        <span class="badge-type">${type}</span>
        <span class="badge-tf">${sig.timeframe}</span>
      </div>
      <div class="signal-info">
        <div class="signal-symbol">${sig.symbol}</div>
        <div class="signal-meta">
          <span class="meta-tag">${sig.price_location}</span>
          <span class="meta-tag rsi">RSI ${sig.rsi_value?.toFixed(1) ?? '--'}</span>
          <span class="meta-tag macd">MACD ${sig.macd_signal}</span>
          ${sig.htf_trend ? `<span class="meta-tag htf htf-${sig.htf_trend}">HTF ${sig.htf_trend?.toUpperCase()}</span>` : ''}
          ${sig.volume_ratio ? `<span class="meta-tag vol">VOL ${sig.volume_ratio}x</span>` : ''}
          ${sig.breakout ? '<span class="meta-tag">BREAKOUT</span>' : ''}
          ${sig.retest  ? '<span class="meta-tag">RETEST</span>'   : ''}
        </div>
      </div>
      <div class="signal-right">
        <div class="signal-price">$${formatPrice(sig.entry_price)}</div>
        <div class="signal-grade grade-${grade}">${sig.grade}</div>
        <div class="signal-score">${sig.score}/100 · ${time}</div>
      </div>
    </div>
  `;
}

function createEmptyState() {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `<div class="empty-icon">◈</div><p>No signals match the current filter.</p>`;
  return div;
}

// ── History Renderer ──────────────────────────────────

function renderHistory(history) {
  const list = document.getElementById('historyList');
  if (!history.length) {
    list.innerHTML = '<div class="empty-state"><p>No history yet.</p></div>';
    return;
  }

  list.innerHTML = history.map(sig => {
    const outcome = sig.signal_outcomes?.[0];
    const type    = sig.signal_type;
    const time    = new Date(sig.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const date    = new Date(sig.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    let outcomeBadge = '';
    if (outcome) {
      if (outcome.outcome === 'WIN') {
        outcomeBadge = `<span class="outcome-badge outcome-win">WIN +${outcome.pnl_percent}%</span>`;
      } else if (outcome.outcome === 'LOSS') {
        outcomeBadge = `<span class="outcome-badge outcome-loss">LOSS ${outcome.pnl_percent}%</span>`;
      } else {
        outcomeBadge = `<span class="outcome-badge outcome-pending">PENDING</span>`;
      }
    }

    return `
      <div class="history-item ${type.toLowerCase()}">
        <div>
          <div class="h-symbol">${sig.symbol} <span style="color:var(--muted);font-size:0.7rem;font-weight:400">${type} · ${sig.timeframe}</span></div>
          <div class="h-details">Entry $${formatPrice(sig.entry_price)} · Score ${sig.score} · ${sig.grade}</div>
          ${outcomeBadge}
        </div>
        <div class="h-time">${date}<br>${time}</div>
      </div>
    `;
  }).join('');
}

// ── Performance Renderer ──────────────────────────────

function renderPerformance(outcomes) {
  const grid = document.getElementById('perfGrid');
  if (!outcomes.length) {
    grid.innerHTML = '<div class="perf-empty">No outcomes recorded yet. Results appear 2 hours after each signal.</div>';
    return;
  }

  grid.innerHTML = outcomes.map(o => {
    const pnl     = o.pnl_percent;
    const pnlClass = pnl >= 0 ? 'pos' : 'neg';
    const pnlStr   = `${pnl >= 0 ? '+' : ''}${pnl}%`;
    const checkedAt = o.checked_at ? new Date(o.checked_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '--';

    return `
      <div class="perf-card">
        <div class="perf-symbol">${o.symbol}</div>
        <div class="perf-detail">
          Type: ${o.signal_type}<br>
          Entry: $${formatPrice(o.entry_price)}<br>
          Exit:  $${formatPrice(o.exit_price)}<br>
          Checked: ${checkedAt}
        </div>
        <div class="perf-pnl ${pnlClass}">${pnlStr}</div>
      </div>
    `;
  }).join('');
}

// ── Scanning Overlay ──────────────────────────────────

function showScanningOverlay(show) {
  const overlay = document.getElementById('scanningOverlay');
  if (show) overlay.classList.add('active');
  else overlay.classList.remove('active');
}

// ── Toast ─────────────────────────────────────────────

function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 4000);
}

// ── Utils ─────────────────────────────────────────────

function formatPrice(price) {
  if (!price) return '--';
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (price >= 1)    return price.toFixed(4);
  return price.toFixed(6);
}
