// ── STRATEGY-02: RSI + MACD + SR + Volume + HTF Filter ──

// ── Binance API Helpers ───────────────────────────────

async function getTopCoins(limit = CONFIG.TOP_COINS_COUNT) {
  const res = await fetch(`${CONFIG.BINANCE_API}/ticker/24hr`);
  const tickers = await res.json();
  return tickers
    .filter(t =>
      t.symbol.endsWith('USDT') &&
      !t.symbol.includes('DOWN') &&
      !t.symbol.includes('UP') &&
      !t.symbol.includes('BEAR') &&
      !t.symbol.includes('BULL') &&
      parseFloat(t.quoteVolume) > 1000000 // min $1M daily volume
    )
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, limit)
    .map(t => t.symbol);
}

async function getCandles(symbol, interval, limit = CONFIG.CANDLE_LIMIT) {
  const url = `${CONFIG.BINANCE_API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const raw = await res.json();
  if (!Array.isArray(raw)) return [];
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

// ── MODULE: Volume Analysis ───────────────────────────

function getVolumeSignal(candles) {
  if (candles.length < 20) return { volumeOk: false, volumeRatio: 0 };

  const recent = candles.slice(-20);
  const avgVol = recent.slice(0, 19).reduce((s, c) => s + c.volume, 0) / 19;
  const lastVol = recent[recent.length - 1].volume;
  const ratio = lastVol / avgVol;

  return {
    volumeOk:    ratio >= CONFIG.VOLUME_MULTIPLIER,
    volumeRatio: parseFloat(ratio.toFixed(2)),
    avgVolume:   avgVol,
    lastVolume:  lastVol,
  };
}

// ── MODULE: Higher Timeframe Trend Filter ─────────────

const HTF_MAP = {
  '15m': '1h',
  '30m': '4h',
  '1h':  '4h',
  '4h':  '1d',
};

async function getHTFTrend(symbol, timeframe) {
  try {
    const htf = HTF_MAP[timeframe];
    if (!htf) return { trend: 'neutral', ema20: null, ema50: null };

    const candles = await getCandles(symbol, htf, 60);
    if (!candles || candles.length < 55) return { trend: 'neutral' };

    const closes = candles.map(c => c.close);
    const ema20  = calculateEMAArray(closes, 20);
    const ema50  = calculateEMAArray(closes, 50);

    const lastEma20 = ema20[ema20.length - 1];
    const lastEma50 = ema50[ema50.length - 1];
    const lastClose = closes[closes.length - 1];

    let trend = 'neutral';
    if (lastClose > lastEma20 && lastEma20 > lastEma50) trend = 'bullish';
    else if (lastClose < lastEma20 && lastEma20 < lastEma50) trend = 'bearish';

    return { trend, ema20: lastEma20, ema50: lastEma50 };
  } catch {
    return { trend: 'neutral' };
  }
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
  for (let i = 15; i <= closes.length; i++) {
    rsiValues.push(calculateRSI(closes.slice(0, i)));
  }

  const current  = rsiValues[rsiValues.length - 1];
  const previous = rsiValues[rsiValues.length - 2];
  if (current === null || previous === null) return null;

  let state = 'neutral';
  if (current < 30) state = 'oversold';
  else if (current > 70) state = 'overbought';

  const oversoldRecovery    = previous < 30 && current > previous;
  const overboughtRejection = previous > 70 && current < previous;

  return {
    rsiValue: current,
    state,
    momentum:             current > previous ? 'rising' : 'falling',
    oversoldRecovery,
    overboughtRejection,
  };
}

// ── MODULE 5: MACD Engine ─────────────────────────────

function calculateEMAArray(closes, period) {
  const k = 2 / (period + 1);
  const result = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    result.push(closes[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function getMACDSignal(closes) {
  if (closes.length < 40) return null;

  const ema12 = calculateEMAArray(closes, 12);
  const ema26 = calculateEMAArray(closes, 26);

  const macdLine  = ema12.map((v, i) => v - ema26[i]);
  const macdSlice = macdLine.slice(25);

  const signalLine = calculateEMAArray(macdSlice, 9);
  const histogram  = macdSlice.map((v, i) => v - signalLine[i]);

  const len = histogram.length;
  const prevMACD   = macdSlice[len - 2];
  const currMACD   = macdSlice[len - 1];
  const prevSignal = signalLine[len - 2];
  const currSignal = signalLine[len - 1];
  const prevHist   = histogram[len - 2];
  const currHist   = histogram[len - 1];

  const bullishCross = prevMACD < prevSignal && currMACD > currSignal;
  const bearishCross = prevMACD > prevSignal && currMACD < currSignal;

  let crossover = 'none';
  if (bullishCross) crossover = 'bullish';
  else if (bearishCross) crossover = 'bearish';

  return {
    crossover,
    histBullish:  currHist > prevHist || currHist > 0,
    histBearish:  currHist < prevHist || currHist < 0,
    histIncreasing: currHist > prevHist,
    histDecreasing: currHist < prevHist,
    macdValue:    parseFloat(currMACD.toFixed(8)),
    signalValue:  parseFloat(currSignal.toFixed(8)),
    histogram:    parseFloat(currHist.toFixed(8)),
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

function clusterZones(points, threshold = 0.025) {
  const zones = [];
  const used  = new Set();

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

  const supportsBelow     = supportLevels.filter(p => p < currentPrice);
  const resistancesAbove  = resistanceLevels.filter(p => p > currentPrice);

  const nearestSupport    = supportsBelow.length    ? Math.max(...supportsBelow)    : null;
  const nearestResistance = resistancesAbove.length ? Math.min(...resistancesAbove) : null;

  return {
    supportZone:     nearestSupport !== null,
    resistanceZone:  nearestResistance !== null,
    supportPrice:    nearestSupport,
    resistancePrice: nearestResistance,
  };
}

function getPriceLocation(currentPrice, sr, threshold = 0.025) {
  const { supportPrice, resistancePrice } = sr;

  if (supportPrice) {
    const dist = Math.abs(currentPrice - supportPrice) / supportPrice;
    if (dist <= threshold) return 'Support';
  }
  if (resistancePrice) {
    const dist = Math.abs(currentPrice - resistancePrice) / resistancePrice;
    if (dist <= threshold) return 'Resistance';
  }

  return 'Between';
}

// ── MODULE 8 & 9: Breakout / Breakdown ───────────────

function detectBreakout(candles, sr) {
  const { resistancePrice, supportPrice } = sr;
  const prev = candles[candles.length - 2];
  const curr = candles[candles.length - 1];

  if (resistancePrice && prev.close <= resistancePrice && curr.close > resistancePrice) {
    return { breakout: true, type: 'bullish' };
  }
  if (supportPrice && prev.close >= supportPrice && curr.close < supportPrice) {
    return { breakdown: true, type: 'bearish' };
  }
  return { breakout: false, breakdown: false };
}

// ── MODULE 10: Retest Logic ───────────────────────────

function detectRetest(candles, sr) {
  const { resistancePrice, supportPrice } = sr;
  const currentPrice = candles[candles.length - 1].close;
  const threshold = 0.02;

  if (resistancePrice) {
    const wasAbove  = candles.slice(-10, -3).some(c => c.close > resistancePrice);
    const nearOldRes = Math.abs(currentPrice - resistancePrice) / resistancePrice <= threshold;
    if (wasAbove && nearOldRes) return { retest: true, type: 'bullish' };
  }
  if (supportPrice) {
    const wasBelow   = candles.slice(-10, -3).some(c => c.close < supportPrice);
    const nearOldSup = Math.abs(currentPrice - supportPrice) / supportPrice <= threshold;
    if (wasBelow && nearOldSup) return { retest: true, type: 'bearish' };
  }

  return { retest: false };
}

// ── MODULE 12: Grade ──────────────────────────────────

function getGrade(score) {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'F';
}

// ── MAIN: Analyze symbol + timeframe ─────────────────

async function analyzeSymbol(symbol, timeframe) {
  try {
    const candles = await getCandles(symbol, timeframe);
    if (!candles || candles.length < 50) return null;

    const closes       = candles.map(c => c.close);
    const currentPrice = closes[closes.length - 1];

    // Core indicators
    const rsi    = getRSISignal(closes);
    const macd   = getMACDSignal(closes);
    const sr     = getSupportResistance(candles);
    const volume = getVolumeSignal(candles);

    if (!rsi || !macd) return null;
    if (!sr.supportZone && !sr.resistanceZone) return null;

    const priceLocation = getPriceLocation(currentPrice, sr);
    if (priceLocation === 'Between') return null;

    // Higher Timeframe Trend
    const htf = await getHTFTrend(symbol, timeframe);

    const breakoutInfo = detectBreakout(candles, sr);
    const retestInfo   = detectRetest(candles, sr);

    // ── BUY Signal ────────────────────────────────────
    if (priceLocation === 'Support') {
      // HTF must be bullish or neutral (not bearish)
      if (htf.trend === 'bearish') return null;

      const rsiOk   = rsi.state === 'oversold' || rsi.oversoldRecovery || rsi.rsiValue < 45;
      const macdOk  = macd.crossover === 'bullish';
      const histOk  = macd.histBullish;
      const srAlign = sr.supportZone;
      const brOk    = breakoutInfo.type === 'bullish' || retestInfo.type === 'bullish';

      // Scoring
      let score = 0;
      if (srAlign)      score += 30;
      if (rsiOk)        score += 20;
      // MACD partial scoring
      if (macdOk && histOk)         score += 25;
      else if (histOk)              score += 15;
      else if (macd.macdValue > macd.signalValue) score += 8;
      // Volume bonus
      if (volume.volumeOk)          score += 10;
      // HTF bonus
      if (htf.trend === 'bullish')  score += 10;
      // Breakout/Retest bonus
      if (brOk)                     score += 5;

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
        macdSignal:      macdOk ? 'Bullish Crossover' : 'Bullish',
        breakout:        breakoutInfo.breakout  || false,
        retest:          retestInfo.retest      || false,
        score,
        grade:           getGrade(score),
        signal:          'BUY',
        entryPrice:      currentPrice,
        htfTrend:        htf.trend,
        volumeRatio:     volume.volumeRatio,
        strength:        'HIGH',
      };
    }

    // ── SELL Signal ───────────────────────────────────
    if (priceLocation === 'Resistance') {
      // HTF must be bearish or neutral
      if (htf.trend === 'bullish') return null;

      const rsiOk   = rsi.state === 'overbought' || rsi.overboughtRejection || rsi.rsiValue > 55;
      const macdOk  = macd.crossover === 'bearish';
      const histOk  = macd.histBearish;
      const srAlign = sr.resistanceZone;
      const brOk    = breakoutInfo.type === 'bearish' || retestInfo.type === 'bearish';

      let score = 0;
      if (srAlign)      score += 30;
      if (rsiOk)        score += 20;
      if (macdOk && histOk)         score += 25;
      else if (histOk)              score += 15;
      else if (macd.macdValue < macd.signalValue) score += 8;
      if (volume.volumeOk)          score += 10;
      if (htf.trend === 'bearish')  score += 10;
      if (brOk)                     score += 5;

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
        macdSignal:      macdOk ? 'Bearish Crossover' : 'Bearish',
        breakout:        breakoutInfo.breakdown || false,
        retest:          retestInfo.retest      || false,
        score,
        grade:           getGrade(score),
        signal:          'SELL',
        entryPrice:      currentPrice,
        htfTrend:        htf.trend,
        volumeRatio:     volume.volumeRatio,
        strength:        'HIGH',
      };
    }

    return null;
  } catch (err) {
    console.warn(`analyzeSymbol failed ${symbol}/${timeframe}:`, err.message);
    return null;
  }
}

// ── Full Scan ─────────────────────────────────────────

async function runFullScan(onProgress) {
  const coins   = await getTopCoins(CONFIG.TOP_COINS_COUNT);
  const signals = [];
  let done = 0;
  const total = coins.length * CONFIG.TIMEFRAMES.length;

  for (const symbol of coins) {
    for (const tf of CONFIG.TIMEFRAMES) {
      const result = await analyzeSymbol(symbol, tf);
      if (result) signals.push(result);
      done++;
      if (onProgress) onProgress(done, total, symbol);
      await new Promise(r => setTimeout(r, 80));
    }
  }

  return signals;
}
