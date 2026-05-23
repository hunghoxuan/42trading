//@version=5
// © GainzAlgo

indicator("Smart Money Structure | GainzAlgo", overlay=true)

length = input.int(5, "Pivot Length", minval=1, maxval=20, step=1, tooltip="Number of bars to identify pivot highs and lows.")
momentum_threshold_base = input.float(0.01, "Base Momentum Threshold (%)", minval=0.001, maxval=1.0, step=0.001, tooltip="Base percentage change for signals.")
tp_points = input.int(10, "Take Profit (points)", minval=5, maxval=500, step=5)
sl_points = input.int(10, "Stop Loss (points)", minval=5, maxval=500, step=5)
min_signal_distance = input.int(5, "Min Signal Distance (bars)", minval=1, maxval=50, step=1)
tp_box_height = input.float(0.5, "TP Box Height % (Optional)", minval=0.1, maxval=2.0, step=0.1)
pre_momentum_factor_base = input.float(0.5, "Base Pre-Momentum Factor", minval=0.1, maxval=1.0, step=0.1, tooltip="Base factor for Get Ready signals.")
shortTrendPeriod = input.int(30, title="Short Trend Period", minval=10, maxval=100)
longTrendPeriod = input.int(100, title="Long Trend Period", minval=50, maxval=200)

use_momentum_filter = input.bool(true, "Use Momentum Filter", group="Signal Filters", tooltip="Require price change to exceed momentum threshold.")
use_trend_filter = input.bool(true, "Use Higher Timeframe Trend Filter", group="Signal Filters", tooltip="Require alignment with the selected higher timeframe trend.")
higher_tf_choice = input.string("5M", "Higher Timeframe", options=["1M", "5M", "15M", "30M", "1H", "4H", "D"], group="Signal Filters", tooltip="Choose the timeframe for the higher timeframe filter.")
use_lower_tf_filter = input.bool(true, "Use Lower Timeframe Filter", group="Signal Filters", tooltip="Prevent signals against the selected lower timeframe trend.")
lower_tf_choice = input.string("5M", "Lower Timeframe", options=["1M", "5M", "15M", "30M", "1H", "4H", "D"], group="Signal Filters", tooltip="Choose the timeframe for the lower timeframe filter.")
use_volume_filter = input.bool(true, "Use Volume Filter", group="Signal Filters", tooltip="Require volume above average (optional).")
use_breakout_filter = input.bool(true, "Use Breakout Filter", group="Signal Filters", tooltip="Require price to break previous high/low (optional).")
show_get_ready = input.bool(false, "Show Get Ready Signals", group="Signal Filters", tooltip="Enable or disable Get Ready signals.")
restrict_repeated_signals = input.bool(true, "Restrict Repeated Signals", group="Signal Filters", tooltip="Prevent multiple signals in the same trend direction until trend changes.")
restrict_trend_tf_choice = input.string("5M", "Restrict Trend Timeframe", options=["1M", "5M", "15M", "30M", "1H", "4H", "D"], group="Signal Filters", tooltip="Choose the timeframe to check trend for restricting repeated signals.")

enable_liquidity_zones = input.bool(false, "Enable Liquidity Zone Detection", group="Advanced Analysis Tools", tooltip="Identifies potential liquidity pools and sweep zones")
enable_market_profile = input.bool(true, "Enable Market Profile Analysis", group="Advanced Analysis Tools", tooltip="Shows order flow imbalance and institutional activity")
enable_divergence_scanner = input.bool(true, "Enable Divergence Scanner", group="Advanced Analysis Tools", tooltip="Detects price and momentum divergences for reversal signals")
enable_trend_analysis = input.bool(true, "Enable Trend Strength Matrix", group="Advanced Analysis Tools", tooltip="Show detailed predictions for future trends across timeframes.")

volumeLongPeriod = input.int(50, "Long Volume Period", minval=10, maxval=100, group="Volume Filter Settings")
volumeShortPeriod = input.int(5, "Short Volume Period", minval=1, maxval=20, group="Volume Filter Settings")
breakoutPeriod = input.int(5, "Breakout Period", minval=1, maxval=50, group="Breakout Filter Settings")

atr_raw = ta.atr(14)
atr = na(atr_raw) and bar_index > 0 ? (high - low) : atr_raw
volatility_factor = atr / close
momentum_threshold = momentum_threshold_base * (1 + volatility_factor * 2)
pre_momentum_factor = pre_momentum_factor_base * (1 - volatility_factor * 0.5)
pre_momentum_threshold = momentum_threshold * pre_momentum_factor

var float raw_cvd = 0.0
delta_volume = close > close[1] ? volume : close < close[1] ? -volume : 0
raw_cvd := raw_cvd + delta_volume
cvd_level = math.abs(raw_cvd) < 10000 ? "Low" : math.abs(raw_cvd) < 50000 ? "Medium" : "High"
cvd_color = raw_cvd > 0 ? color.lime : raw_cvd < 0 ? color.red : color.yellow

price_change = ((close - close[1]) / close[1]) * 100

pivot_high = ta.pivothigh(high, length, length)
pivot_low = ta.pivotlow(low, length, length)

var float last_high = na
var float last_low = na
if not na(pivot_high)
    last_high := pivot_high
if not na(pivot_low)
    last_low := pivot_low

var float choch_sell_level = na
var float choch_buy_level = na
var float bos_sell_level = na
var float bos_buy_level = na
var float tp_sell_level = na
var float tp_buy_level = na
var float sl_sell_level = na
var float sl_buy_level = na
var int last_signal_bar = -min_signal_distance - 1
var string last_signal = "Neutral"
var int last_trend = 0

[ema1M, vwap1M] = request.security(syminfo.tickerid, "1", [ta.ema(close, 20), ta.vwap(hlc3)])
[ema5M, vwap5M] = request.security(syminfo.tickerid, "5", [ta.ema(close, 20), ta.vwap(hlc3)])
[ema15M, vwap15M] = request.security(syminfo.tickerid, "15", [ta.ema(close, 20), ta.vwap(hlc3)])
[ema30M, vwap30M] = request.security(syminfo.tickerid, "30", [ta.ema(close, 20), ta.vwap(hlc3)])
[ema1H, vwap1H] = request.security(syminfo.tickerid, "60", [ta.ema(close, 20), ta.vwap(hlc3)])
[ema4H, vwap4H] = request.security(syminfo.tickerid, "240", [ta.ema(close, 20), ta.vwap(hlc3)])
[emaD, vwapD] = request.security(syminfo.tickerid, "D", [ta.ema(close, 20), ta.vwap(hlc3)])

trend1M = close > ema1M and close > vwap1M ? 1 : close < ema1M and close < vwap1M ? -1 : 0
trend5M = close > ema5M and close > vwap5M ? 1 : close < ema5M and close < vwap5M ? -1 : 0
trend15M = close > ema15M and close > vwap15M ? 1 : close < ema15M and close < vwap15M ? -1 : 0
trend30M = close > ema30M and close > vwap30M ? 1 : close < ema30M and close < vwap30M ? -1 : 0
trend1H = close > ema1H and close > vwap1H ? 1 : close < ema1H and close < vwap1H ? -1 : 0
trend4H = close > ema4H and close > vwap4H ? 1 : close < ema4H and close < vwap4H ? -1 : 0
trendD = close > emaD and close > vwapD ? 1 : close < emaD and close < vwapD ? -1 : 0

trend_strength_raw = trend1M + trend5M + trend15M + trend30M + trend1H + trend4H + trendD
trend_strength = (trend_strength_raw / 7) * 100

var float system_confidence = 50.0
if trend_strength_raw == 7 or trend_strength_raw == -7
    system_confidence := 90.0
else if trend_strength_raw >= 4 or trend_strength_raw <= -4
    system_confidence := 75.0
else if trend_strength_raw >= 2 or trend_strength_raw <= -2
    system_confidence := 60.0
else
    system_confidence := 50.0

var int higher_tf_trend = 0
if higher_tf_choice == "1M"
    higher_tf_trend := trend1M
else if higher_tf_choice == "5M"
    higher_tf_trend := trend5M
else if higher_tf_choice == "15M"
    higher_tf_trend := trend15M
else if higher_tf_choice == "30M"
    higher_tf_trend := trend30M
else if higher_tf_choice == "1H"
    higher_tf_trend := trend1H
else if higher_tf_choice == "4H"
    higher_tf_trend := trend4H
else if higher_tf_choice == "D"
    higher_tf_trend := trendD

bullish_trend_ok = higher_tf_trend == 1
bearish_trend_ok = higher_tf_trend == -1

var int lower_tf_trend = 0
if lower_tf_choice == "1M"
    lower_tf_trend := trend1M
else if lower_tf_choice == "5M"
    lower_tf_trend := trend5M
else if lower_tf_choice == "15M"
    lower_tf_trend := trend15M
else if lower_tf_choice == "30M"
    lower_tf_trend := trend30M
else if lower_tf_choice == "1H"
    lower_tf_trend := trend1H
else if lower_tf_choice == "4H"
    lower_tf_trend := trend4H
else if lower_tf_choice == "D"
    lower_tf_trend := trendD

lower_tf_bullish = lower_tf_trend == 1
lower_tf_bearish = lower_tf_trend == -1
lower_tf_not_neutral = lower_tf_trend != 0

var int restrict_tf_trend = 0
if restrict_trend_tf_choice == "1M"
    restrict_tf_trend := trend1M
else if restrict_trend_tf_choice == "5M"
    restrict_tf_trend := trend5M
else if restrict_trend_tf_choice == "15M"
    restrict_tf_trend := trend15M
else if restrict_trend_tf_choice == "30M"
    restrict_tf_trend := trend30M
else if restrict_trend_tf_choice == "1H"
    restrict_tf_trend := trend1H
else if restrict_trend_tf_choice == "4H"
    restrict_tf_trend := trend4H
else if restrict_trend_tf_choice == "D"
    restrict_tf_trend := trendD

volAvg50 = ta.sma(volume, volumeLongPeriod)
volShort = ta.sma(volume, volumeShortPeriod)
volCondition = volume > volAvg50 and ta.change(volShort) > 0

highestBreakout = ta.highest(high, breakoutPeriod)
lowestBreakout = ta.lowest(low, breakoutPeriod)

choch_sell = ta.crossunder(low, last_high) and close < open
choch_buy = ta.crossover(high, last_low) and close > open
bos_sell = ta.crossunder(low, last_low[1]) and low < last_low[1] and close < open
bos_buy = ta.crossover(high, last_high[1]) and high > last_high[1] and close > open

early_sell_signal = use_momentum_filter ? price_change < -momentum_threshold : true
early_buy_signal = use_momentum_filter ? price_change > momentum_threshold : true

sell_trend_ok = use_trend_filter ? bearish_trend_ok : true
buy_trend_ok = use_trend_filter ? bullish_trend_ok : true

sell_lower_tf_ok = use_lower_tf_filter ? (not lower_tf_bullish and lower_tf_not_neutral) : true
buy_lower_tf_ok = use_lower_tf_filter ? (not lower_tf_bearish and lower_tf_not_neutral) : true

sell_volume_ok = use_volume_filter ? volCondition : true
buy_volume_ok = use_volume_filter ? volCondition : true

sell_breakout_ok = use_breakout_filter ? close < lowestBreakout[1] : true
buy_breakout_ok = use_breakout_filter ? close > highestBreakout[1] : true

sell_allowed = not restrict_repeated_signals or (last_signal != "Sell" or (last_signal == "Sell" and restrict_tf_trend != last_trend and restrict_tf_trend != -1))
buy_allowed = not restrict_repeated_signals or (last_signal != "Buy" or (last_signal == "Buy" and restrict_tf_trend != last_trend and restrict_tf_trend != 1))

sell_condition = early_sell_signal and (bar_index - last_signal_bar >= min_signal_distance) and sell_trend_ok and sell_lower_tf_ok and sell_volume_ok and sell_breakout_ok and sell_allowed
buy_condition = early_buy_signal and (bar_index - last_signal_bar >= min_signal_distance) and buy_trend_ok and buy_lower_tf_ok and buy_volume_ok and buy_breakout_ok and buy_allowed

get_ready_sell = use_momentum_filter ? (price_change < -pre_momentum_threshold and price_change > -momentum_threshold) : true and (bar_index - last_signal_bar >= min_signal_distance) and sell_trend_ok and sell_lower_tf_ok and sell_volume_ok and sell_breakout_ok
get_ready_buy = use_momentum_filter ? (price_change > pre_momentum_threshold and price_change < momentum_threshold) : true and (bar_index - last_signal_bar >= min_signal_distance) and buy_trend_ok and buy_lower_tf_ok and buy_volume_ok and buy_breakout_ok

if enable_liquidity_zones
    lookback = 20
    recent_high = ta.highest(high, lookback)
    if high >= recent_high * 0.9995 and high <= recent_high * 1.0005 and bar_index > lookback
        label.new(bar_index, high, "💧 LIQ", color=color.new(#FF6B35, 80), style=label.style_label_down, textcolor=#FF6B35, size=size.tiny)
    recent_low = ta.lowest(low, lookback)
    if low <= recent_low * 1.0005 and low >= recent_low * 0.9995 and bar_index > lookback
        label.new(bar_index, low, "💧 LIQ", color=color.new(#FF6B35, 80), style=label.style_label_up, textcolor=#FF6B35, size=size.tiny)

if enable_market_profile
    var float recent_buy_vol = 0.0
    var float recent_sell_vol = 0.0
    if close > open
        recent_buy_vol := ta.sma(volume, 20)
    else if close < open
        recent_sell_vol := ta.sma(volume, 20)
    vol_ratio = recent_buy_vol > 0 and recent_sell_vol > 0 ? recent_buy_vol / (recent_buy_vol + recent_sell_vol) : 0.5
    strong_buy_flow = vol_ratio > 0.65 and volume > volAvg50 * 1.5
    strong_sell_flow = vol_ratio < 0.35 and volume > volAvg50 * 1.5
    if strong_buy_flow
        label.new(bar_index, low, "🔥 BUY", color=color.new(#00D9FF, 70), style=label.style_label_up, textcolor=color.white, size=size.small)
    if strong_sell_flow
        label.new(bar_index, high, "🔥 SELL", color=color.new(#FF006E, 70), style=label.style_label_down, textcolor=color.white, size=size.small)

if enable_divergence_scanner
    rsi = ta.rsi(close, 14)
    price_lower_low = low < low[5] and low[5] < low[10]
    rsi_higher_low = rsi > rsi[5] and rsi[5] > rsi[10]
    bullish_divergence = price_lower_low and rsi_higher_low and rsi < 40
    price_higher_high = high > high[5] and high[5] > high[10]
    rsi_lower_high = rsi < rsi[5] and rsi[5] < rsi[10]
    bearish_divergence = price_higher_high and rsi_lower_high and rsi > 60
    if bullish_divergence
        label.new(bar_index, low, "⚡ BULL", color=color.new(#00F5FF, 60), style=label.style_label_up, textcolor=color.white, size=size.small)
    if bearish_divergence
        label.new(bar_index, high, "⚡ BEAR", color=color.new(#C77DFF, 60), style=label.style_label_down, textcolor=color.white, size=size.small)

if show_get_ready and get_ready_sell
    label.new(bar_index, high, "⚠ READY", color=color.new(#FFB627, 70), style=label.style_label_down, textcolor=color.white, size=size.small)
if show_get_ready and get_ready_buy
    label.new(bar_index, low, "⚠ READY", color=color.new(#FFB627, 70), style=label.style_label_up, textcolor=color.white, size=size.small)

if sell_condition
    label.new(bar_index, high, "🔴 SELL", color=color.new(#FF1744, 0), style=label.style_label_down, textcolor=color.white, size=size.normal)
    tp_sell_level := low - tp_points
    sl_sell_level := high + sl_points
    last_signal := "Sell"
    last_signal_bar := bar_index
    last_trend := restrict_tf_trend

if buy_condition
    label.new(bar_index, low, "🟢 BUY", color=color.new(#00E676, 0), style=label.style_label_up, textcolor=color.white, size=size.normal)
    tp_buy_level := high + tp_points
    sl_buy_level := low - sl_points
    last_signal := "Buy"
    last_signal_bar := bar_index
    last_trend := restrict_tf_trend

var line choch_sell_line = na
var line choch_buy_line = na
var line bos_sell_line = na
var line bos_buy_line = na
var box choch_sell_box = na
var box choch_buy_box = na
var box bos_sell_box = na
var box bos_buy_box = na

if choch_sell
    line.delete(choch_sell_line)
    box.delete(choch_sell_box)
    choch_sell_level := last_high
    choch_sell_line := line.new(bar_index, choch_sell_level, bar_index + 1, choch_sell_level, color=color.new(#00E5FF, 0), style=line.style_solid, width=2)
    choch_sell_box := box.new(bar_index - 2, choch_sell_level * 1.001, bar_index + 5, choch_sell_level * 0.999, bgcolor=color.new(#00E5FF, 95), border_color=color.new(#00E5FF, 80), border_width=1)
    label.new(bar_index, choch_sell_level, "CHoCH", color=color.new(#00E5FF, 85), textcolor=#00E5FF, style=label.style_label_left, size=size.tiny)

if choch_buy
    line.delete(choch_buy_line)
    box.delete(choch_buy_box)
    choch_buy_level := last_low
    choch_buy_line := line.new(bar_index, choch_buy_level, bar_index + 1, choch_buy_level, color=color.new(#76FF03, 0), style=line.style_solid, width=2)
    choch_buy_box := box.new(bar_index - 2, choch_buy_level * 1.001, bar_index + 5, choch_buy_level * 0.999, bgcolor=color.new(#76FF03, 95), border_color=color.new(#76FF03, 80), border_width=1)
    label.new(bar_index, choch_buy_level, "CHoCH", color=color.new(#76FF03, 85), textcolor=#76FF03, style=label.style_label_left, size=size.tiny)

if bos_sell
    line.delete(bos_sell_line)
    box.delete(bos_sell_box)
    bos_sell_level := last_low[1]
    bos_sell_line := line.new(bar_index, bos_sell_level, bar_index + 1, bos_sell_level, color=color.new(#E040FB, 0), style=line.style_solid, width=2)
    bos_sell_box := box.new(bar_index - 2, bos_sell_level * 1.001, bar_index + 5, bos_sell_level * 0.999, bgcolor=color.new(#E040FB, 95), border_color=color.new(#E040FB, 80), border_width=1)
    label.new(bar_index, bos_sell_level, "BOS", color=color.new(#E040FB, 85), textcolor=#E040FB, style=label.style_label_left, size=size.tiny)

if bos_buy
    line.delete(bos_buy_line)
    box.delete(bos_buy_box)
    bos_buy_level := last_high[1]
    bos_buy_line := line.new(bar_index, bos_buy_level, bar_index + 1, bos_buy_level, color=color.new(#00BFA5, 0), style=line.style_solid, width=2)
    bos_buy_box := box.new(bar_index - 2, bos_buy_level * 1.001, bar_index + 5, bos_buy_level * 0.999, bgcolor=color.new(#00BFA5, 95), border_color=color.new(#00BFA5, 80), border_width=1)
    label.new(bar_index, bos_buy_level, "BOS", color=color.new(#00BFA5, 85), textcolor=#00BFA5, style=label.style_label_left, size=size.tiny)

var line sup = na
var line res = na

if barstate.islast
    float lowest_y2 = 60000
    int lowest_x2 = 0
    float highest_y2 = 0
    int highest_x2 = 0
    int maxShortBars = math.min(shortTrendPeriod, bar_index)
    for i = 1 to maxShortBars
        if low[i] < lowest_y2
            lowest_y2 := low[i]
            lowest_x2 := i
        if high[i] > highest_y2
            highest_y2 := high[i]
            highest_x2 := i
    float lowest_y1 = 60000
    int lowest_x1 = 0
    float highest_y1 = 0
    int highest_x1 = 0
    int maxLongBars = math.min(longTrendPeriod, bar_index)
    for j = shortTrendPeriod + 1 to maxLongBars
        if low[j] < lowest_y1
            lowest_y1 := low[j]
            lowest_x1 := j
        if high[j] > highest_y1
            highest_y1 := high[j]
            highest_x1 := j
    int trendStrength = trend_strength_raw
    if lowest_x1 > 0 and lowest_x2 > 0
        line.delete(sup)
        sup := line.new(int(bar_index - lowest_x1), lowest_y1, int(bar_index - lowest_x2), lowest_y2, extend=extend.right, style=line.style_solid, width=3, color=trendStrength >= 1 ? (trendStrength >= 4 ? color.new(#00E676, 30) : trendStrength >= 2 ? color.new(#76FF03, 40) : color.new(#FFEB3B, 50)) : color.new(color.gray, 60))
    if highest_x1 > 0 and highest_x2 > 0
        line.delete(res)
        res := line.new(int(bar_index - highest_x1), highest_y1, int(bar_index - highest_x2), highest_y2, extend=extend.right, style=line.style_solid, width=3, color=trendStrength <= -1 ? (trendStrength <= -4 ? color.new(#FF1744, 30) : trendStrength <= -2 ? color.new(#E040FB, 40) : color.new(#FFEB3B, 50)) : color.new(color.gray, 60))

plot(choch_sell_level, "CHoCH Sell", color=color.new(#00E5FF, 70), style=plot.style_circles, linewidth=1)
plot(choch_buy_level, "CHoCH Buy", color=color.new(#76FF03, 70), style=plot.style_circles, linewidth=1)
plot(bos_sell_level, "BOS Sell", color=color.new(#E040FB, 70), style=plot.style_circles, linewidth=1)
plot(bos_buy_level, "BOS Buy", color=color.new(#00BFA5, 70), style=plot.style_circles, linewidth=1)

momentum_5m = request.security(syminfo.tickerid, "5", close - close[3])
momentum_15m = request.security(syminfo.tickerid, "15", close - close[3])
momentum_30m = request.security(syminfo.tickerid, "30", close - close[3])
momentum_1h = request.security(syminfo.tickerid, "60", close - close[3])
momentum_4h = request.security(syminfo.tickerid, "240", close - close[3])
momentum_d = request.security(syminfo.tickerid, "D", close - close[3])

volatility_5m = request.security(syminfo.tickerid, "5", ta.atr(14))
volatility_15m = request.security(syminfo.tickerid, "15", ta.atr(14))
volatility_30m = request.security(syminfo.tickerid, "30", ta.atr(14))
volatility_1h = request.security(syminfo.tickerid, "60", ta.atr(14))
volatility_4h = request.security(syminfo.tickerid, "240", ta.atr(14))
volatility_d = request.security(syminfo.tickerid, "D", ta.atr(14))

volatility_avg_5m = request.security(syminfo.tickerid, "5", ta.sma(ta.atr(14), 20))
volatility_avg_15m = request.security(syminfo.tickerid, "15", ta.sma(ta.atr(14), 20))
volatility_avg_30m = request.security(syminfo.tickerid, "30", ta.sma(ta.atr(14), 20))
volatility_avg_1h = request.security(syminfo.tickerid, "60", ta.sma(ta.atr(14), 20))
volatility_avg_4h = request.security(syminfo.tickerid, "240", ta.sma(ta.atr(14), 20))
volatility_avg_d = request.security(syminfo.tickerid, "D", ta.sma(ta.atr(14), 20))

score_5m = trend5M + (momentum_5m > 0 ? 0.5 : momentum_5m < 0 ? -0.5 : 0) + (volatility_5m > volatility_avg_5m ? 0.5 : 0)
score_15m = trend15M + (momentum_15m > 0 ? 0.5 : momentum_15m < 0 ? -0.5 : 0) + (volatility_15m > volatility_avg_15m ? 0.5 : 0)
score_30m = trend30M + (momentum_30m > 0 ? 0.5 : momentum_30m < 0 ? -0.5 : 0) + (volatility_30m > volatility_avg_30m ? 0.5 : 0)
score_1h = trend1H + (momentum_1h > 0 ? 0.5 : momentum_1h < 0 ? -0.5 : 0) + (volatility_1h > volatility_avg_1h ? 0.5 : 0)
score_4h = trend4H + (momentum_4h > 0 ? 0.5 : momentum_4h < 0 ? -0.5 : 0) + (volatility_4h > volatility_avg_4h ? 0.5 : 0)
score_d = trendD + (momentum_d > 0 ? 0.5 : momentum_d < 0 ? -0.5 : 0) + (volatility_d > volatility_avg_d ? 0.5 : 0)

pred_5m = score_5m > 0.5 ? "▲" : score_5m < -0.5 ? "▼" : "━"
pred_15m = score_15m > 0.5 ? "▲" : score_15m < -0.5 ? "▼" : "━"
pred_30m = score_30m > 0.5 ? "▲" : score_30m < -0.5 ? "▼" : "━"
pred_1h = score_1h > 0.5 ? "▲" : score_1h < -0.5 ? "▼" : "━"
pred_4h = score_4h > 0.5 ? "▲" : score_4h < -0.5 ? "▼" : "━"
pred_d = score_d > 0.5 ? "▲" : score_d < -0.5 ? "▼" : "━"

var table trendTable = table.new(position.top_right, columns=2, rows=11, bgcolor=color.new(#0A0E27, 15), border_width=1, border_color=color.new(#00D9FF, 50))

if barstate.islast
    table.cell(trendTable, 0, 0, "⚡ SMART MONEY", text_color=color.new(#00F5FF, 0), text_size=size.normal, bgcolor=color.new(#1A1F3A, 30))
    table.cell(trendTable, 1, 0, "v3.0", text_color=color.new(#00D9FF, 40), text_size=size.small, bgcolor=color.new(#1A1F3A, 30))
    
    table.cell(trendTable, 0, 1, "📊 Strength", text_color=color.new(#FFFFFF, 20), text_size=size.small, bgcolor=color.new(#0F1629, 40))
    strength_color = trend_strength > 50 ? color.new(#00E676, 0) : trend_strength > 0 ? color.new(#76FF03, 0) : trend_strength > -50 ? color.new(#FF6B35, 0) : color.new(#FF1744, 0)
    table.cell(trendTable, 1, 1, str.tostring(math.round(trend_strength)), text_color=strength_color, text_size=size.normal, bgcolor=color.new(#0F1629, 40))
    
    table.cell(trendTable, 0, 2, "🎯 Confidence", text_color=color.new(#FFFFFF, 20), text_size=size.small, bgcolor=color.new(#0F1629, 40))
    conf_color = system_confidence >= 75 ? color.new(#00E5FF, 0) : system_confidence >= 60 ? color.new(#00D9FF, 20) : color.new(#FFB627, 0)
    table.cell(trendTable, 1, 2, str.tostring(system_confidence) + "%", text_color=conf_color, text_size=size.normal, bgcolor=color.new(#0F1629, 40))
    
    table.cell(trendTable, 0, 3, "💎 Volume", text_color=color.new(#FFFFFF, 20), text_size=size.small, bgcolor=color.new(#0F1629, 40))
    cvd_display = str.tostring(math.round(raw_cvd / 1000)) + "K"
    table.cell(trendTable, 1, 3, cvd_display, text_color=cvd_color, text_size=size.small, bgcolor=color.new(#0F1629, 40))
    
    table.cell(trendTable, 0, 4, "1M", text_color=color.new(#8B93FF, 30), text_size=size.tiny, bgcolor=color.new(#0A0E27, 50))
    table.cell(trendTable, 1, 4, trend1M == 1 ? "▲" : trend1M == -1 ? "▼" : "━", text_color=trend1M == 1 ? color.new(#76FF03, 0) : trend1M == -1 ? color.new(#FF1744, 0) : color.new(#FFB627, 40), text_size=size.small, bgcolor=color.new(#0A0E27, 50))
    
    table.cell(trendTable, 0, 5, "5M", text_color=color.new(#8B93FF, 30), text_size=size.tiny, bgcolor=color.new(#0A0E27, 50))
    table.cell(trendTable, 1, 5, trend5M == 1 ? "▲" : trend5M == -1 ? "▼" : "━", text_color=trend5M == 1 ? color.new(#76FF03, 0) : trend5M == -1 ? color.new(#FF1744, 0) : color.new(#FFB627, 40), text_size=size.small, bgcolor=color.new(#0A0E27, 50))
    
    table.cell(trendTable, 0, 6, "15M", text_color=color.new(#8B93FF, 30), text_size=size.tiny, bgcolor=color.new(#0A0E27, 50))
    table.cell(trendTable, 1, 6, trend15M == 1 ? "▲" : trend15M == -1 ? "▼" : "━", text_color=trend15M == 1 ? color.new(#76FF03, 0) : trend15M == -1 ? color.new(#FF1744, 0) : color.new(#FFB627, 40), text_size=size.small, bgcolor=color.new(#0A0E27, 50))
    
    table.cell(trendTable, 0, 7, "30M", text_color=color.new(#8B93FF, 30), text_size=size.tiny, bgcolor=color.new(#0A0E27, 50))
    table.cell(trendTable, 1, 7, trend30M == 1 ? "▲" : trend30M == -1 ? "▼" : "━", text_color=trend30M == 1 ? color.new(#76FF03, 0) : trend30M == -1 ? color.new(#FF1744, 0) : color.new(#FFB627, 40), text_size=size.small, bgcolor=color.new(#0A0E27, 50))
    
    table.cell(trendTable, 0, 8, "1H", text_color=color.new(#8B93FF, 30), text_size=size.tiny, bgcolor=color.new(#0A0E27, 50))
    table.cell(trendTable, 1, 8, trend1H == 1 ? "▲" : trend1H == -1 ? "▼" : "━", text_color=trend1H == 1 ? color.new(#76FF03, 0) : trend1H == -1 ? color.new(#FF1744, 0) : color.new(#FFB627, 40), text_size=size.small, bgcolor=color.new(#0A0E27, 50))
    
    table.cell(trendTable, 0, 9, "4H", text_color=color.new(#8B93FF, 30), text_size=size.tiny, bgcolor=color.new(#0A0E27, 50))
    table.cell(trendTable, 1, 9, trend4H == 1 ? "▲" : trend4H == -1 ? "▼" : "━", text_color=trend4H == 1 ? color.new(#76FF03, 0) : trend4H == -1 ? color.new(#FF1744, 0) : color.new(#FFB627, 40), text_size=size.small, bgcolor=color.new(#0A0E27, 50))
    
    table.cell(trendTable, 0, 10, "1D", text_color=color.new(#8B93FF, 30), text_size=size.tiny, bgcolor=color.new(#0A0E27, 50))
    table.cell(trendTable, 1, 10, trendD == 1 ? "▲" : trendD == -1 ? "▼" : "━", text_color=trendD == 1 ? color.new(#76FF03, 0) : trendD == -1 ? color.new(#FF1744, 0) : color.new(#FFB627, 40), text_size=size.small, bgcolor=color.new(#0A0E27, 50))

if enable_trend_analysis
    var table ai_table = table.new(position.bottom_right, columns=7, rows=2, bgcolor=color.new(#0A0E27, 15), border_width=1, border_color=color.new(#E040FB, 50))
    
    if barstate.islast
        table.cell(ai_table, 0, 0, "🔮 TREND", text_color=color.new(#E040FB, 0), text_size=size.small, bgcolor=color.new(#1A1F3A, 30))
        table.cell(ai_table, 1, 0, "5M", text_color=color.new(#FFFFFF, 30), text_size=size.tiny, bgcolor=color.new(#1A1F3A, 30))
        table.cell(ai_table, 2, 0, "15M", text_color=color.new(#FFFFFF, 30), text_size=size.tiny, bgcolor=color.new(#1A1F3A, 30))
        table.cell(ai_table, 3, 0, "30M", text_color=color.new(#FFFFFF, 30), text_size=size.tiny, bgcolor=color.new(#1A1F3A, 30))
        table.cell(ai_table, 4, 0, "1H", text_color=color.new(#FFFFFF, 30), text_size=size.tiny, bgcolor=color.new(#1A1F3A, 30))
        table.cell(ai_table, 5, 0, "4H", text_color=color.new(#FFFFFF, 30), text_size=size.tiny, bgcolor=color.new(#1A1F3A, 30))
        table.cell(ai_table, 6, 0, "1D", text_color=color.new(#FFFFFF, 30), text_size=size.tiny, bgcolor=color.new(#1A1F3A, 30))
        
        table.cell(ai_table, 0, 1, "Predict", text_color=color.new(#C77DFF, 20), text_size=size.tiny, bgcolor=color.new(#0F1629, 40))
        table.cell(ai_table, 1, 1, pred_5m, text_color=pred_5m == "▲" ? color.new(#00E676, 0) : pred_5m == "▼" ? color.new(#FF1744, 0) : color.new(#FFB627, 40), text_size=size.normal, bgcolor=color.new(#0F1629, 40))
        table.cell(ai_table, 2, 1, pred_15m, text_color=pred_15m == "▲" ? color.new(#00E676, 0) : pred_15m == "▼" ? color.new(#FF1744, 0) : color.new(#FFB627, 40), text_size=size.normal, bgcolor=color.new(#0F1629, 40))
        table.cell(ai_table, 3, 1, pred_30m, text_color=pred_30m == "▲" ? color.new(#00E676, 0) : pred_30m == "▼" ? color.new(#FF1744, 0) : color.new(#FFB627, 40), text_size=size.normal, bgcolor=color.new(#0F1629, 40))
        table.cell(ai_table, 4, 1, pred_1h, text_color=pred_1h == "▲" ? color.new(#00E676, 0) : pred_1h == "▼" ? color.new(#FF1744, 0) : color.new(#FFB627, 40), text_size=size.normal, bgcolor=color.new(#0F1629, 40))
        table.cell(ai_table, 5, 1, pred_4h, text_color=pred_4h == "▲" ? color.new(#00E676, 0) : pred_4h == "▼" ? color.new(#FF1744, 0) : color.new(#FFB627, 40), text_size=size.normal, bgcolor=color.new(#0F1629, 40))
        table.cell(ai_table, 6, 1, pred_d, text_color=pred_d == "▲" ? color.new(#00E676, 0) : pred_d == "▼" ? color.new(#FF1744, 0) : color.new(#FFB627, 40), text_size=size.normal, bgcolor=color.new(#0F1629, 40))