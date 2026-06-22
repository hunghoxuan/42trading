// This Pine Script® code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/
// © repo32
// This is an update to my 2015 version from the original pinescript.
// The original version was the first version of pinescript.  This updates to Version 6
// Due to changes in Tradingview, the original colors changed in 2026, causing everything to turn blue.
// This update allows the user to choose the label and tex
// This version also adds alerts for each symbol


//@version=6
indicator("Candlestick Patterns Identified, update 1-17-26", overlay = true)

trend = input.int(5, minval = 1, title = "Trend in Bars")
dojiSize = input.float(0.05, minval = 0.01, title = "Doji size")

bullColor = input.color(color.lime, "Bullish Arrow Color")
bearColor = input.color(color.red, "Bearish Arrow Color")
dojiColor = input.color(color.white, "Other(i.e. Doji) Symbol Color")
bullText = input.color(color.lime, "Bullish Text Color")
bearText = input.color(color.red, "Bearish Text Color")
dojiText = input.color(color.white, "Other(i.e. Doji) Text Color")

doji = math.abs(open - close) <= (high - low) * dojiSize
plotshape(doji, title="Doji", style=shape.cross , color=dojiColor, textcolor=dojiText,  text="Doji")

bearHarami = close[1] > open[1] and open > close and open <= close[1] and open[1] <= close and open - close < close[1] - open[1] and open[trend] < open
plotshape(bearHarami, title="Bearish Harami", style=shape.arrowdown, color=bearColor, textcolor=bearText, text="Bearish\nHarami")

bullHarami = open[1] > close[1] and close > open and close <= open[1] and close[1] <= open and close - open < open[1] - close[1] and open[trend] > open
plotshape(bullHarami, title="Bullish Harami", location=location.belowbar, style=shape.arrowup, color=bullColor, textcolor=bullText, text="Bullish\nHarami")

bearEng = close[1] > open[1] and open > close and open >= close[1] and open[1] >= close and open - close > close[1] - open[1] and open[trend] < open
plotshape(bearEng, title="Bearish Engulfing", style=shape.arrowdown, color=bearColor, textcolor=bearText, text="Bearish\nEngulfing")

bullEng = open[1] > close[1] and close > open and close >= open[1] and close[1] >= open and close - open > open[1] - close[1] and open[trend] > open
plotshape(bullEng, title="Bullish Engulfing", location=location.belowbar, style=shape.arrowup, color=bullColor,  textcolor=bullText, text="Bullish\nEngulfling")

piercing = close[1] < open[1] and open < low[1] and close > close[1] + ((open[1] - close[1]) / 2) and close < open[1] and open[trend] > open
plotshape(piercing, title="Piercing Line", location=location.belowbar, style=shape.arrowup, color=bullColor,  textcolor=bullText, text="Piercing\nLine")

lower = ta.lowest(10)[1]
bullBelt = low == open and open < lower and open < close and close > ((high[1] - low[1]) / 2) + low[1] and open[trend] > open
plotshape(bullBelt, title="Bullish Belt", location=location.belowbar, style=shape.arrowup, color=bullColor,  textcolor=bullText, text="Bullish\nBelt")

bullKick = open[1] > close[1] and open >= open[1] and close > open and open[trend] > open
plotshape(bullKick, title="Bullish Kicker", location=location.belowbar, style=shape.arrowup, color=bullColor,  textcolor=bullText, text="Bullish\nKicker")

bearKick = open[1] < close[1] and open <= open[1] and close <= open and open[trend] < open
plotshape(bearKick, title="Bearish Kicker", style=shape.arrowdown,  color=bearColor, textcolor=bearText, text="Bearish\nKicker")

hangingMan = (high - low > 4 * math.abs(open - close)) and ((close - low) / (0.001 + high - low) >= 0.75) and ((open - low) / (0.001 + high - low) >= 0.75) and open[trend] < open and high[1] < open and high[2] < open
plotshape(hangingMan, title="Hanging Man", style=shape.arrowdown,  color=bearColor, textcolor=bearText, text="Hanging\nMan")

eveningStar = close[2] > open[2] and math.min(open[1], close[1]) > close[2] and open < math.min(open[1], close[1]) and close < open
plotshape(eveningStar, title="Evening Star", style=shape.arrowdown,  color=bearColor, textcolor=bearText, text="Evening\nStar")

morningStar = close[2] < open[2] and math.max(open[1], close[1]) < close[2] and open > math.max(open[1], close[1]) and close > open
plotshape(morningStar, title="Morning Star", location=location.belowbar, style=shape.arrowup, color=bullColor,  textcolor=bullText, text="Morning\nStar")

shootingStar = open[1] < close[1] and open > close[1] and high - math.max(open, close) >= math.abs(open - close) * 3 and math.min(close, open) - low <= math.abs(open - close)
plotshape(shootingStar, title="Shooting Star", style=shape.arrowdown,  color=bearColor, textcolor=bearText, text="Shooting\nStar")

hammer = (high - low > 3 * math.abs(open - close)) and ((close - low) / (0.001 + high - low) > 0.6) and ((open - low) / (0.001 + high - low) > 0.6)
plotshape(hammer, title="Hammer", location=location.belowbar, style=shape.diamond, color=dojiColor, textcolor=dojiText, text="H")

invHammer = (high - low > 3 * math.abs(open - close)) and ((high - close) / (0.001 + high - low) > 0.6) and ((high - open) / (0.001 + high - low) > 0.6)
plotshape(invHammer, title="Inverted Hammer", location=location.belowbar, style=shape.diamond, color=dojiColor, textcolor=dojiText, text="IH")

// Alerts
alertcondition(doji, "Doji", "Doji detected")
alertcondition(bearHarami, "Bearish Harami", "Bearish Harami detected")
alertcondition(bullHarami, "Bullish Harami", "Bullish Harami detected")
alertcondition(bearEng, "Bearish Engulfing", "Bearish Engulfing detected")
alertcondition(bullEng, "Bullish Engulfing", "Bullish Engulfing detected")
alertcondition(piercing, "Piercing Line", "Piercing Line detected")
alertcondition(bullBelt, "Bullish Belt", "Bullish Belt detected")
alertcondition(bullKick, "Bullish Kicker", "Bullish Kicker detected")
alertcondition(bearKick, "Bearish Kicker", "Bearish Kicker detected")
alertcondition(hangingMan, "Hanging Man", "Hanging Man detected")
alertcondition(eveningStar, "Evening Star", "Evening Star detected")
alertcondition(morningStar, "Morning Star", "Morning Star detected")
alertcondition(shootingStar, "Shooting Star", "Shooting Star detected")
alertcondition(hammer, "Hammer", "Hammer detected")
alertcondition(invHammer, "Inverted Hammer", "Inverted Hammer detected")
