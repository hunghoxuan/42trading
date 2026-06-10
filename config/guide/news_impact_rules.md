# News Impact Rules — Directional Bias Reference

> Config enrichment: adds `impact_rules` to each news type with directional logic,
> magnitude, conditions, and thresholds for machine-parseable agent use.

---

## Structure Overview

Each news type gains an `impact_rules` block with:

| Field | Purpose |
|---|---|
| `condition_field` | Primary data field to evaluate (e.g. `actual_vs_forecast`) |
| `secondary_fields` | Additional fields that modify the outcome (e.g. wages, UE rate) |
| `thresholds` | Quantified triggers mapped to named conditions |
| `rules[]` | Array of directional rules per symbol/condition |
| `currency` qualifier | Separates same-symbol rules by event country (e.g. USD CPI vs EUR CPI on EURUSD) |
| `special_case` | Edge-case overrides (e.g. stagflation, goldilocks, overheating) |

---

## CPI — Score: 95

**`condition_field`**: `actual_vs_forecast`

### Thresholds

| Condition | Operator | Value | Unit |
|---|---|---|---|
| `hot` | `>` | +0.1 | percentage points |
| `cool` | `<` | -0.1 | percentage points |
| `inline` | between | [-0.1, +0.1] | percentage points |

### Impact Rules

| Symbol | Condition | Direction | Magnitude | Reason |
|---|---|---|---|---|
| USD | hot | **Bullish** | High | Hot CPI triggers hawkish Fed repricing; rate hike bets rise |
| USD | cool | **Bearish** | High | Cool CPI signals disinflation; rate cut expectations increase |
| USD | inline | Neutral | Low | Market already priced in; muted reaction expected |
| XAUUSD | hot | **Bearish** | High | Real yields rise with hawkish repricing; USD strength weighs on gold |
| XAUUSD | cool | **Bullish** | High | Lower real yield expectations; USD softens — gold bid |
| XAUUSD | hot + stagflation *(actual YoY > 5.0 AND GDP growth < 1.0)* | **Bullish** | Medium | Stagflation fear — safe haven demand overrides rate logic |
| US30 / NAS100 / SPX500 | hot | **Bearish** | High | Rate hike fears crush equity multiples; sell-off likely |
| US30 / NAS100 / SPX500 | cool | **Bullish** | High | Rate cut narrative drives risk-on rally |
| EURUSD | hot (USD event) | **Bearish** | High | USD bid; EUR/USD drops on dollar strength |
| EURUSD | hot (EUR event) | **Bullish** | Medium | ECB hawkish repricing; EUR/USD rises on eurozone rate expectations |

---

## NFP — Score: 98

**`condition_field`**: `actual_vs_forecast`
**`secondary_fields`**: `average_hourly_earnings_vs_forecast`, `unemployment_rate_actual`

### Thresholds

| Condition | Operator | Value | Unit |
|---|---|---|---|
| `strong` | `>` | +50k | thousands of jobs |
| `weak` | `<` | -50k | thousands of jobs |
| `inline` | between | [-50k, +50k] | thousands of jobs |

### Impact Rules

| Symbol | Condition | Direction | Magnitude | Reason |
|---|---|---|---|---|
| USD | strong | **Bullish** | High | Tight labor market; Fed stays hawkish — no cuts imminent |
| USD | weak | **Bearish** | High | Labor market deteriorating; rate cut expectations rise |
| USD | inline + wages beat | **Bullish** | Medium | Wage inflation keeps Fed on hold; USD supported |
| USD | inline + unemployment rising | **Bearish** | Medium | Rising UE rate signals slowdown beneath headline NFP |
| XAUUSD | weak | **Bullish** | High | Rate cut bets surge; USD falls — gold bids strongly |
| XAUUSD | strong | **Bearish** | Medium | USD strength weighs on gold; may recover if broader risk-off develops |
| US30 / NAS100 | goldilocks *(beat +50k to +150k)* | **Bullish** | Medium | Healthy jobs but not overheating — good economy, no extreme hawkish fear |
| US30 / NAS100 | overheating *(beat > +150k)* | **Bearish** | Medium | Overheating labor market raises rate hike overshoot fears |
| US30 / NAS100 | weak | **Bearish** | High | Recession fears dominate; equities sell off broadly |
| USDJPY | strong | **Bullish** | High | US–Japan yield differential widens; USD/JPY spikes |

---

## FOMC — Score: 99

**`condition_field`**: `rate_decision`
**`secondary_fields`**: `statement_tone`, `dot_plot_revision`, `press_conference_tone`

### Conditions

| Condition Key | Logic |
|---|---|
| `hike` | `rate_change > 0` |
| `cut` | `rate_change < 0` |
| `hold_hawkish` | `rate_change == 0 AND statement_tone == "hawkish"` |
| `hold_dovish` | `rate_change == 0 AND statement_tone == "dovish"` |
| `hold_neutral` | `rate_change == 0 AND statement_tone == "neutral"` |

### Impact Rules

| Symbol | Condition | Direction | Magnitude | Reason |
|---|---|---|---|---|
| USD | hike | **Bullish** | High | Tightening cycle; USD bids on yield advantage |
| USD | cut | **Bearish** | High | Easing cycle begins; dollar loses yield appeal |
| USD | hold_hawkish | **Bullish** | Medium | "Higher for longer" rhetoric — no cut yet, USD stays bid |
| USD | hold_dovish | **Bearish** | Medium | Market front-runs anticipated cuts; USD softens |
| XAUUSD | cut | **Bullish** | High | Lower real rates + weaker USD = strongest gold rally scenario |
| XAUUSD | hike | **Bearish** | High | Higher real yields reduce gold's appeal as non-yielding asset |
| XAUUSD | hold_neutral | **Bullish** | Medium | Uncertainty bid; gold used as policy hedge |
| BTCUSD | cut | **Bullish** | High | Liquidity expansion narrative drives crypto rally |
| BTCUSD | hike | **Bearish** | Medium | Risk-off; BTC correlates with equities in tightening regimes |
| US30 / NAS100 / SPX500 | cut | **Bullish** | High | Lower discount rate expands equity multiples; risk-on rally |
| US30 / NAS100 / SPX500 | hike | **Bearish** | High | Higher rates compress valuations; growth stocks hit hardest |
| USDJPY | hike + BOJ still dovish | **Bullish** | High | Fed–BOJ policy divergence widens; USD/JPY spikes sharply |

---

## GDP — Score: 85

**`condition_field`**: `actual_vs_forecast`

### Thresholds

| Condition | Operator | Value | Unit |
|---|---|---|---|
| `beat` | `>` | +0.1 | percentage points |
| `miss` | `<` | -0.1 | percentage points |
| `negative` | `<` | 0.0 | QoQ annualized |
| `recession` | consecutive_negative | 2 | quarters |

### Impact Rules

| Symbol | Condition | Currency | Direction | Magnitude | Reason |
|---|---|---|---|---|---|
| USD | beat | USD | **Bullish** | Medium | Strong economy; Fed less likely to cut — USD supported |
| USD | miss | USD | **Bearish** | Medium | Weak growth raises rate cut bets; USD softens |
| USD | recession | USD | **Bearish** | High | Two consecutive negative quarters confirmed; major USD selling |
| XAUUSD | miss | any | **Bullish** | Medium | Safe haven demand; weaker growth = lower rate expectations |
| US30 / NAS100 | beat | USD | **Bullish** | Medium | Earnings growth optimism; risk-on |
| US30 / NAS100 | miss | USD | **Bearish** | Medium | Growth slowdown raises earnings risk; equities sell |
| EURUSD | beat | EUR | **Bullish** | Medium | Eurozone recovery narrative; EUR bid, ECB less likely to cut |
| EURUSD | miss | EUR | **Bearish** | Medium | Weak EU growth raises ECB cut expectations; EUR sold |
| UK100 | beat | GBP | **Bullish** | Medium | UK growth surprise supports domestic equities |

---

## PMI — Score: 78

**`condition_field`**: `actual_value`
**`secondary_fields`**: `actual_vs_forecast`, `manufacturing_vs_services`

### Thresholds

| Condition | Logic |
|---|---|
| `expansion` | `actual_value > 50` |
| `contraction` | `actual_value < 50` |
| `shock_contraction` | `actual_value < 48 AND actual_vs_forecast < -1.5` |
| `beat` | `actual_vs_forecast > 0` |
| `miss` | `actual_vs_forecast < 0` |

### Impact Rules

| Symbol | Condition | Sub-type | Direction | Magnitude | Reason |
|---|---|---|---|---|---|
| USD | expansion + beat | any | **Bullish** | Medium | Above 50 + beat forecast — business activity expanding, USD supported |
| USD | contraction | any | **Bearish** | Medium | Below 50 = contraction territory; growth concerns weigh on USD |
| USD | shock_contraction | any | **Bearish** | High | Unexpected sharp contraction — large move likely; recession fear trigger |
| EURUSD | beat | EUR PMI | **Bullish** | Medium | Eurozone manufacturing recovery signal; EUR/USD higher |
| EURUSD | contraction | EUR PMI | **Bearish** | Low | EUR offered but reaction often muted if already priced in |
| GER40 | beat | German PMI | **Bullish** | Medium | German manufacturing PMI beat — industrial recovery drives DAX |
| XAUUSD | contraction | USD PMI | **Bullish** | Low | Mild safe haven bid on growth concerns; gold benefits moderately |
| US30 | expansion + beat | ISM Services | **Bullish** | Medium | Services ≈ 70% of US economy; beat is a strong growth signal for equities |
| US30 | shock_contraction | ISM Services | **Bearish** | High | Services contraction = broad economic slowdown; equities sell hard |

---

## Magnitude Key

| Level | Typical pip range | Notes |
|---|---|---|
| **High** | 50–150+ pips (FX), 1–3%+ (indices) | Strong directional conviction; avoid counter-trend trades |
| **Medium** | 20–50 pips (FX), 0.5–1% (indices) | Tradeable but watch for fade setups post-spike |
| **Low** | < 20 pips (FX), < 0.5% (indices) | Often a drift; best to wait for market structure to confirm |

---

## Agent Evaluation Logic (Pseudocode)

```
ON news_event received:
  match news_type → load impact_rules block
  evaluate condition_field (actual vs forecast from FF calendar)
  classify → condition key (hot/cool/inline, strong/weak, hike/cut etc.)
  
  FOR each rule in impact_rules.rules:
    IF rule.condition matches classified condition:
      IF rule.currency defined → check event currency matches
      IF rule.secondary_trigger defined → evaluate secondary_fields
      IF rule.special_case defined → check special_case trigger expression
      → apply direction + magnitude to symbol
      → flag symbol as HIGH_IMPACT for duration window
      → suppress new entries if current_time within before_minutes of event
      → resume after during_minutes has elapsed
```
