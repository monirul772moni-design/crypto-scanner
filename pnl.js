// ── Real-time P&L inside Signal Cards ────────────────
// Fetches live price every 10s and updates each card

const PNL = {
  trackers: {}, // signalId -> intervalId
};

// ── Start tracking for a signal card ─────────────────

function startPnlTracking(signal) {
  const cardId = `pnl-row-${signal.id}`;
  if (PNL.trackers[signal.id]) return;

  // Fetch immediately, then every 10s
  fetchAndUpdatePnl(signal, cardId);

  PNL.trackers[signal.id] = setInterval(() => {
    fetchAndUpdatePnl(signal, cardId);
  }, 10000);
}

async function fetchAndUpdatePnl(signal, cardId) {
  try {
    const res  = await fetch(`${CONFIG.BINANCE_API}/ticker/price?symbol=${signal.symbol}`);
    const data = await res.json();
    const now  = parseFloat(data.price);
    const entry = signal.entry_price;

    let pct = ((now - entry) / entry) * 100;
    if (signal.signal_type === 'SELL') pct = -pct;

    const row = document.getElementById(cardId);
    if (!row) {
      clearInterval(PNL.trackers[signal.id]);
      delete PNL.trackers[signal.id];
      return;
    }

    const isProfit = pct >= 0;
    row.innerHTML = `
      <span class="pnl-live-label">Live P&L</span>
      <span class="pnl-live-price">$${formatPrice(now)}</span>
      <span class="pnl-live-pct ${isProfit ? 'pnl-pos' : 'pnl-neg'}">
        ${isProfit ? '▲' : '▼'} ${isProfit ? '+' : ''}${pct.toFixed(2)}%
      </span>
    `;
  } catch {}
}

// ── Stop tracking (cleanup) ───────────────────────────

function stopPnlTracking(signalId) {
  if (PNL.trackers[signalId]) {
    clearInterval(PNL.trackers[signalId]);
    delete PNL.trackers[signalId];
  }
}
