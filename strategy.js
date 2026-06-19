// ── STRATEGY-02: RSI + MACD + Support/Resistance ─────

// ── Binance API Helpers ───────────────────────────────

async function getTopCoins(limit = CONFIG.TOP_COINS_COUNT) {
  const res = await fetch(`${CONFIG.BINANCE_API}/ticker/24hr`);
  const tickers = await res.json();
  return tickers
    .filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('DOWN') && !t.symbol.includes('UP') && !t.symbol.includes('BEAR') && !t.symbol.includes('BULL'))
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, limit)
    .map(t => t.symbol);
}

async function getCandles(symbol, interval, limit = CONFIG.CANDLE_LIMIT) {
  const url = `${CONFIG.BINANCE_API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const raw = await res.json();
  return raw.map(c => ({
    time:   c[0],
    open:   parseFloat(c[1]),
    high:   parseFloat(c[2]),
    low:    parseFloat(c[3]),
    close:  parseFloat(c[4]),
    volume: parseFloat(c[5]),
  }));
}

async function getCurrentPrice(symbol) {
  try {
    const res = await fetch(`${CONFIG.BINANCE_API}/ticker/price?symbol=${symbol}`);
    const data = await res.json();
    return parseFloat(data.price);
  } catch { return null; }
}

// ── MODULE 4: RSI Engine ──────────────────────────────

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
}

function getRSISignal(closes) {
  const rsiValues = [];
  for (let i = 14; i <= closes.length; i++) {
    rsiValues.push(calculateRSI(closes.slice(0, i)));
  }

  const current = rsiValues[rsiValues.length - 1];
  const previous = rsiValues[rsiValues.length - 2];
  if (current === null || previous === null) return null;

  let state = 'neutral';
  if (current < 30) state = 'oversold';
  else if (current > 70) state = 'overbought';

  let momentum = current > previous ? 'rising' : 'falling';

  // Oversold recovery
  const oversoldRecovery = previous < 30 && current > previous;
  // Overbought rejection
  const overboughtRejection = previous > 70 && current < previous;

  return { rsiValue: current, state, momentum, oversoldRecovery, overboughtRejection };
}

// ── MODULE 5: MACD Engine ─────────────────────────────

function calculateEMA(closes, period) {
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateEMAArray(closes, period) {
  const k = 2 / (period + 1);
  const result = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    result.push(closes[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function getMACDSignal(closes) {
  if (closes.length < 35) return null;

  const ema12 = calculateEMAArray(closes, 12);
  const ema26 = calculateEMAArray(closes, 26);

  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const macdSlice = macdLine.slice(25); // enough for signal line

  const signalLine = calculateEMAArray(macdSlice, 9);
  const histogram = macdSlice.map((v, i) => v - signalLine[i]);

  const len = histogram.length;
  const prevMACD = macdSlice[len - 2];
  const currMACD = macdSlice[len - 1];
  const prevSignal = signalLine[len - 2];
  const currSignal = signalLine[len - 1];
  const prevHist = histogram[len - 2];
  const currHist = histogram[len - 1];

  // Bullish crossover: MACD crosses above Signal
  const bullishCross = prevMACD < prevSignal && currMACD > currSignal;
  // Bearish crossover
  const bearishCross = prevMACD > prevSignal && currMACD < currSignal;

  // Histogram confirmation
  const histIncreasing = currHist > prevHist;
  const histDecreasing = currHist < prevHist;
  const histGreen = currHist > 0;
  const histRed = currHist < 0;

  let crossover = 'none';
  if (bullishCross) crossover = 'bullish';
  else if (bearishCross) crossover = 'bearish';

  return {
    crossover,
    histBullish: histIncreasing || histGreen,
    histBearish: histDecreasing || histRed,
    macdValue: parseFloat(currMACD.toFixed(6)),
    signalValue: parseFloat(currSignal.toFixed(6)),
  };
}

// ── MODULE 2 & 3: Support/Resistance Engine ───────────

function findSwingLows(candles, lookback = 5) {
  const lows = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const curr = candles[i].low;
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && candles[j].low <= curr) { isSwing = false; break; }
    }
    if (isSwing) lows.push({ index: i, price: curr });
  }
  return lows;
}

function findSwingHighs(candles, lookback = 5) {
  const highs = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const curr = candles[i].high;
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && candles[j].high >= curr) { isSwing = false; break; }
    }
    if (isSwing) highs.push({ index: i, price: curr });
  }
  return highs;
}

function clusterZones(points, threshold = 0.015) {
  // Group nearby price levels into zones
  const zones = [];
  const used = new Set();

  for (let i = 0; i < points.length; i++) {
    if (used.has(i)) continue;
    const cluster = [points[i].price];
    used.add(i);

    for (let j = i + 1; j < points.length; j++) {
      if (used.has(j)) continue;
      const diff = Math.abs(points[i].price - points[j].price) / points[i].price;
      if (diff <= threshold) {
        cluster.push(points[j].price);
        used.add(j);
      }
    }

    if (cluster.length >= 2) {
      zones.push(cluster.reduce((a, b) => a + b, 0) / cluster.length);
    }
  }
  return zones;
}

function getSupportResistance(candles) {
  const swingLows  = findSwingLows(candles);
  const swingHighs = findSwingHighs(candles);

  const supportLevels    = clusterZones(swingLows);
  const resistanceLevels = clusterZones(swingHighs);

  const currentPrice = candles[candles.length - 1].close;

  // Find nearest support below price
  const supportsBelow = supportLevels.filter(p => p < currentPrice);
  const resistancesAbove = resistanceLevels.filter(p => p > currentPrice);

  const nearestSupport    = supportsBelow.length ? Math.max(...supportsBelow) : null;
  const nearestResistance = resistancesAbove.length ? Math.min(...resistancesAbove) : null;

  return {
    supportZone:     nearestSupport !== null,
    resistanceZone:  nearestResistance !== null,
    supportPrice:    nearestSupport,
    resistancePrice: nearestResistance,
    allSupports:     supportLevels,
    allResistances:  resistanceLevels,
  };
}

// ── MODULE 3: Price Location Filter ──────────────────

function getPriceLocation(currentPrice, sr, threshold = 0.012) {
  const { supportPrice, resistancePrice } = sr;

  if (supportPrice) {
    const distSupport = Math.abs(currentPrice - supportPrice) / supportPrice;
    if (distSupport <= threshold) return 'Support';
  }

  if (resistancePrice) {
    const distResistance = Math.abs(currentPrice - resistancePrice) / resistancePrice;
    if (distResistance <= threshold) return 'Resistance';
  }

  return 'Between';
}

// ── MODULE 8 & 9: Breakout / Breakdown ───────────────

function detectBreakout(candles, sr) {
  const { resistancePrice, supportPrice } = sr;
  const last2 = candles.slice(-2);
  const prev = last2[0];
  const curr = last2[1];

  // Bullish breakout: closes above resistance
  if (resistancePrice && prev.close <= resistancePrice && curr.close > resistancePrice) {
    return { breakout: true, type: 'bullish' };
  }

  // Bearish breakdown: closes below support
  if (supportPrice && prev.close >= supportPrice && curr.close < supportPrice) {
    return { breakdown: true, type: 'bearish' };
  }

  return { breakout: false, breakdown: false };
}

// ── MODULE 10: Retest Logic ───────────────────────────

function detectRetest(candles, sr) {
  const { resistancePrice, supportPrice } = sr;
  const currentPrice = candles[candles.length - 1].close;
  const threshold = 0.012;

  // Bullish retest: was resistance, now acting as support
  if (resistancePrice) {
    const wasAbove = candles.slice(-10, -3).some(c => c.close > resistancePrice);
    const nearOldRes = Math.abs(currentPrice - resistancePrice) / resistancePrice <= threshold;
    if (wasAbove && nearOldRes) return { retest: true, type: 'bullish' };
  }

  // Bearish retest: was support, now acting as resistance
  if (supportPrice) {
    const wasBelow = candles.slice(-10, -3).some(c => c.close < supportPrice);
    const nearOldSup = Math.abs(currentPrice - supportPrice) / supportPrice <= threshold;
    if (wasBelow && nearOldSup) return { retest: true, type: 'bearish' };
  }

  return { retest: false };
}

// ── MODULE 11: Signal Scoring ─────────────────────────

function calculateScore(params) {
  let score = 0;

  // S/R Alignment (35 pts)
  if (params.srAligned) score += 35;

  // RSI Confirmation (25 pts)
  if (params.rsiConfirmed) score += 25;

  // MACD Confirmation (25 pts)
  if (params.macdConfirmed) score += 25;

  // Breakout / Retest (15 pts)
  if (params.breakoutOrRetest) score += 15;

  return score;
}

function getGrade(score) {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'F';
}

// ── MAIN: Analyze a single symbol + timeframe ─────────

async function analyzeSymbol(symbol, timeframe) {
  try {
    const candles = await getCandles(symbol, timeframe);
    if (!candles || candles.length < 50) return null;

    const closes = candles.map(c => c.close);
    const currentPrice = closes[closes.length - 1];

    // Get indicators
    const rsi  = getRSISignal(closes);
    const macd = getMACDSignal(closes);
    const sr   = getSupportResistance(candles);

    if (!rsi || !macd || (!sr.supportZone && !sr.resistanceZone)) return null;

    const priceLocation = getPriceLocation(currentPrice, sr);
    if (priceLocation === 'Between') return null; // MODULE 13 rejection

    const breakoutInfo = detectBreakout(candles, sr);
    const retestInfo   = detectRetest(candles, sr);

    // ── MODULE 6: BUY Signal ──────────────────────────
    if (priceLocation === 'Support') {
      const rsiOk   = rsi.state === 'oversold' || rsi.oversoldRecovery;
      const macdOk  = macd.crossover === 'bullish';
      const histOk  = macd.histBullish;
      const srAlign = sr.supportZone;
      const brOk    = breakoutInfo.type === 'bullish' || retestInfo.type === 'bullish';

      const score = calculateScore({
        srAligned:        srAlign,
        rsiConfirmed:     rsiOk,
        macdConfirmed:    macdOk && histOk,
        breakoutOrRetest: brOk,
      });

      if (score < CONFIG.MIN_SCORE) return null;

      return {
        symbol,
        strategy:        'RSI_MACD_SR_CONFLUENCE',
        timeframe,
        priceLocation:   'Support',
        supportZone:     true,
        resistanceZone:  sr.resistanceZone,
        supportPrice:    sr.supportPrice,
        resistancePrice: sr.resistancePrice,
        rsi:             rsi.rsiValue,
        macdSignal:      'Bullish',
        breakout:        breakoutInfo.breakout || false,
        retest:          retestInfo.retest || false,
        score,
        grade:           getGrade(score),
        signal:          'BUY',
        entryPrice:      currentPrice,
        strength:        'HIGH',
      };
    }

    // ── MODULE 7: SELL Signal ─────────────────────────
    if (priceLocation === 'Resistance') {
      const rsiOk   = rsi.state === 'overbought' || rsi.overboughtRejection;
      const macdOk  = macd.crossover === 'bearish';
      const histOk  = macd.histBearish;
      const srAlign = sr.resistanceZone;
      const brOk    = breakoutInfo.type === 'bearish' || retestInfo.type === 'bearish';

      const score = calculateScore({
        srAligned:        srAlign,
        rsiConfirmed:     rsiOk,
        macdConfirmed:    macdOk && histOk,
        breakoutOrRetest: brOk,
      });

      if (score < CONFIG.MIN_SCORE) return null;

      return {
        symbol,
        strategy:        'RSI_MACD_SR_CONFLUENCE',
        timeframe,
        priceLocation:   'Resistance',
        supportZone:     sr.supportZone,
        resistanceZone:  true,
        supportPrice:    sr.supportPrice,
        resistancePrice: sr.resistancePrice,
        rsi:             rsi.rsiValue,
        macdSignal:      'Bearish',
        breakout:        breakoutInfo.breakdown || false,
        retest:          retestInfo.retest || false,
        score,
        grade:           getGrade(score),
        signal:          'SELL',
        entryPrice:      currentPrice,
        strength:        'HIGH',
      };
    }

    return null;
  } catch (err) {
    console.warn(`analyzeSymbol failed for ${symbol}/${timeframe}:`, err.message);
    return null;
  }
}

// Scan all coins across all timeframes
async function runFullScan(onProgress) {
  const coins = await getTopCoins(CONFIG.TOP_COINS_COUNT);
  const signals = [];
  let done = 0;
  const total = coins.length * CONFIG.TIMEFRAMES.length;

  for (const symbol of coins) {
    for (const tf of CONFIG.TIMEFRAMES) {
      const result = await analyzeSymbol(symbol, tf);
      if (result) signals.push(result);
      done++;
      if (onProgress) onProgress(done, total, symbol);
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 60));
    }
  }

  return signals;
      }
