#property strict
#property description "TradingView -> MT5 pull bridge EA"

#include <Trade/Trade.mqh>

// Bump this on every code update so running build is obvious on chart/logs.
string EA_BUILD_VERSION = "v2026.05.13 21:32 - 9a74f8d8";

//--- 1. CONNECTION & IDENTITY
input string InpServerBaseUrl = "https://trade.mozasolution.com/webhook"; // VPS Webhook URL
input string InpEaApiKey      = "acc_fab38ed32ecde9b28b3dd33d8be10a77da6a"; // EA API Key
input int    InpPollSeconds   = 2;           // Polling Frequency (seconds)
input long   InpMagic         = 20260411;    // Magic Number (Unique ID for this EA)

//--- 2. FEATURES (ON/OFF)
input bool   InpDisableRemoteLog    = false; // Disable Remote Logging (VPS)
input bool   InpEnableTradeEventAck = true;  // Sync Trade Events to VPS (START/TP/SL)
input bool   InpEnableVirtualGuard  = true;  // Enable Virtual SL/TP & Trailing
input bool   InpEnableDuplicateGate = true;  // Prevent Duplicate Signals
input bool   InpStrictSymbolResolve = true;  // Strict Symbol Matching
input bool   InpShowDebugPanel      = true;  // Show EA State on Chart

//--- 3. RISK & FORMULA VARIABLES
input bool   InpUseRiskPercentSizing = true; // Use % Risk Sizing
input double InpMaxRiskPct           = 1.0;  // Max Risk % per Trade
input double InpMaxRiskAmount        = 100.0; // Max Risk $ per Trade
input bool   InpUseMarginPercentSizing = false; // Use Margin Cap Sizing
input double InpMarginPercentOfBalance = 100.0; // Margin Budget (% of Balance)
input double InpMarginSafetyPercent    = 98.0; // Margin Safety Cap (%)
input double InpFallbackFixedLot     = 0.01; // Fallback Lot (if sizing fails)
input bool   InpHardFailOnMarginPrecheck = false; // Stop on Margin Fail

//--- 4. VIRTUAL GUARD & TRAILING RULES
input double InpVirtualBreakEvenR    = 1.0;  // BE Profit (R-Multiple)
input double InpVirtualTrailStartR   = 1.5;  // Trail Start (R-Multiple)
input double InpVirtualTrailGivebackR = 0.7; // Trail Giveback (R-Multiple)
input int    InpVirtualMaxHoldMinutes = 0;   // Time Stop (0=Disabled)
input int    InpVirtualFallbackSLPts = 300; // Fallback SL distance
input double InpVirtualFallbackRR    = 1.5; // Fallback RR for TP
input double InpVirtualMinRR         = 1.0; // Min RR enforcement

//--- 5. EXECUTION & SAFETY DEFAULTS
input string InpSymbolSuffix         = "";   // Symbol Suffix (e.g. .m, -pro)
input int    InpDeviationPts         = 20;   // Max Slippage (Points)
input int    InpStopBufferPts        = 50;   // Broker Stop Buffer (Points)
input int    InpMaxSignalAgeSeconds  = 7200; // Max Signal Age (Seconds)
input int    InpDedupKeepSeconds     = 86400; // Duplicate Cache Duration (Seconds)
input int    InpStopRetrySeconds     = 5;    // SL/TP Retry Interval
input int    InpStopRetryMaxAttempts = 24;   // SL/TP Max Retries

//--- 6. BROKER MANAGEMENT (THE HAND)
enum ENUM_MANAGEMENT_STRATEGY {
   STRATEGY_NONE,  // None
   STRATEGY_BE,    // Break Even
   STRATEGY_TRAIL, // Trailing Stop
   STRATEGY_BOTH   // Both
};

input ENUM_MANAGEMENT_STRATEGY InpMgtStrategy = STRATEGY_NONE; // Management Strategy
input int    InpMgtBE_Trigger_Pips = 15; // BE Trigger (Pips)
input int    InpMgtBE_Offset_Pips  = 1;  // BE Offset (Pips)
input int    InpMgtTrail_Start_Pips = 20; // Trail Start (Pips)
input int    InpMgtTrail_Step_Pips  = 5;  // Trail Step (Pips)

//--- 7. SYSTEM & SIMULATION
sinput string InpMappingFile         = "TVBridge_Mappings.csv"; // Internal ticket mapping file
input bool    InpBacktestMode        = false; // Replay signals from CSV
input string  InpBacktestFileCommon  = "tvbridge_signals.csv";
input bool    InpBacktestHasHeader   = true;

CTrade trade;

string   g_seenIds[];
datetime g_seenAt[];

datetime g_btTime[];
string   g_btSignalId[];
string   g_btAction[];
string   g_btSymbol[];
string   g_btNote[];
double   g_btVolume[];
double   g_btSl[];
double   g_btTp[];
int      g_btCursor = 0;
bool     g_btLoaded = false;

string   g_dbgLastSignalId = "";
string   g_dbgLastAction   = "";
string   g_dbgLastSymbol   = "";
string   g_dbgLastStatus   = "INIT";
string   g_dbgLastError    = "";
datetime g_dbgLastTime     = 0;
string   g_dbgLastPollSummary = "No polls yet";
int      g_dbgPollCount = 0;
int      g_dbgPollPullFail = 0;
int      g_dbgPollNoSignal = 0;
int      g_dbgPollExecOk = 0;
int      g_dbgPollExecFail = 0;

// Ack debug context for current signal execution.
string   g_ackAction = "";
string   g_ackSymbol = "";
string   g_ackVolumeNote = "";
string   g_ackStopNote = "";
double   g_ackReqVolume = 0.0;
double   g_ackUsedVolume = 0.0;
double   g_ackReqSl = 0.0;
double   g_ackReqTp = 0.0;
double   g_ackUsedSl = 0.0;
double   g_ackUsedTp = 0.0;
double   g_ackEntryExec = 0.0;
double   g_ackMarginReq = 0.0;
double   g_ackMarginBudget = 0.0;
double   g_ackFreeMargin = 0.0;
double   g_ackBalance = 0.0;

//--- 8. PARTIAL TP TRACKING
struct SPartialTarget {
   string sid;
   double price;
   double pct;
   bool   done;
};
SPartialTarget g_partialTargets[];

void ParsePartialTps(string sid, string rawJson)
{
   if(sid == "" || rawJson == "") return;
   
   string token = "\"partial_tps\"";
   int p = StringFind(rawJson, token);
   if(p < 0) return;
   
   int b1 = StringFind(rawJson, "[", p);
   int b2 = StringFind(rawJson, "]", b1);
   if(b1 < 0 || b2 < 0) return;
   
   string list = StringSubstr(rawJson, b1 + 1, b2 - b1 - 1);
   
   int start = 0;
   while(true)
   {
      int o1 = StringFind(list, "{", start);
      int o2 = StringFind(list, "}", o1);
      if(o1 < 0 || o2 < 0) break;
      
      string item = StringSubstr(list, o1, o2 - o1 + 1);
      double price = JsonGetNumber(item, "price");
      double pct   = JsonGetNumber(item, "size_pct");
      
      if(price > 0 && pct > 0)
      {
         int n = ArraySize(g_partialTargets);
         ArrayResize(g_partialTargets, n + 1);
         g_partialTargets[n].sid = sid;
         g_partialTargets[n].price = price;
         g_partialTargets[n].pct = pct;
         g_partialTargets[n].done = false;
      }
      start = o2 + 1;
   }
}
double   g_ackEquity = 0.0;
double   g_ackPnlRealized = 0.0;
bool     g_ackHasPnlRealized = false;
datetime g_ackSignalTs = 0;
datetime g_ackExecTs = 0;
int      g_ackRetcode = 0;
string   g_ackRetmsg = "";
// Broker execution telemetry (pips/lots/usd)
double   g_ackPipsPerPoint = 0.0;   // pip multiplier vs point (10 for 5-digit, 1 for 3-digit JPY)
double   g_ackPipValuePerLot = 0.0; // USD value of 1 pip on 1 standard lot for this symbol
double   g_ackSlPips = 0.0;         // SL distance in pips
double   g_ackTpPips = 0.0;         // TP distance in pips
double   g_ackRiskMoneyActual = 0.0;    // lots * pip_value * sl_pips (actual risk $)
double   g_ackRewardMoneyPlanned = 0.0; // lots * pip_value * tp_pips (planned reward $)

string   g_stopRetrySignalId[];
ulong    g_stopRetryTicket[];
string   g_stopRetryAction[];
string   g_stopRetrySymbol[];
double   g_stopRetrySl[];
double   g_stopRetryTp[];
int      g_stopRetryAttempts[];
datetime g_stopRetryLastTry[];
datetime g_stopRetryFirstSeen[];

ulong    g_vgTicket[];
string   g_vgSignalId[];
string   g_vgSymbol[];
int      g_vgSide[];         // +1 BUY, -1 SELL
double   g_vgEntry[];
double   g_vgSl[];
double   g_vgTp[];
double   g_vgRisk[];
datetime g_vgOpenedAt[];

ulong    g_posMapTicket[];
string   g_posMapSignalId[];
bool     g_posMapOpenedAckSent[];

ulong    g_ordMapTicket[];
string   g_ordMapSignalId[];
datetime g_syncLastTime = 0;
datetime g_syncHistoryLastTime = 0;
datetime g_lastClosedDealSyncTime = 0;

string   g_lastPullPayload = "None";
string   g_lastSyncPayload = "None";
datetime g_lastPullUpdate = 0;
datetime g_lastSyncUpdate = 0;
string   g_lastPullSummary = "INIT";
string   g_lastSyncSummary = "INIT";
int      g_lastPullCode = 0;
int      g_lastSyncCode = 0;
int      g_lastHttpCode = 0;
string   g_lastHttpError = "";
string   g_lastHttpUrl = "";
string   g_lastHttpMethod = "";

string   g_leaseTokenMapSignalId[];
string   g_leaseTokenMapValue[];
string   g_tradeIdMapSignalId[];
string   g_tradeIdMapValue[];

// Reliable Ack Queue
string   g_ackQSignalId[];
string   g_ackQStatus[];
string   g_ackQTicket[];
string   g_ackQError[];
string   g_ackQBody[];
int      g_ackQRetryCount[];

struct SVpsSyncSignal
{
   string signal_id;
   string status;
   string symbol;
   string action;
   string ticket;
   double volume;
   double sl;
   double tp;
   double pnl;
};

string JsonGetString(const string json, const string key)
{
   string token = "\"" + key + "\"";
   int p = StringFind(json, token);
   if(p < 0) return "";
   int c = StringFind(json, ":", p + StringLen(token));
   if(c < 0) return "";
   int q1 = StringFind(json, "\"", c + 1);
   if(q1 < 0) return "";
   int q2 = StringFind(json, "\"", q1 + 1);
   if(q2 < 0) return "";
   return StringSubstr(json, q1 + 1, q2 - q1 - 1);
}

double JsonGetNumber(const string json, const string key, const double fallback=0.0)
{
   string token = "\"" + key + "\"";
   int p = StringFind(json, token);
   if(p < 0) return fallback;
   int c = StringFind(json, ":", p + StringLen(token));
   if(c < 0) return fallback;
   int s = c + 1;
   while(s < StringLen(json) && (StringGetCharacter(json, s) == ' ' || StringGetCharacter(json, s) == '"')) s++;
   int e = s;
   while(e < StringLen(json))
   {
      int ch = StringGetCharacter(json, e);
      if((ch >= '0' && ch <= '9') || ch == '.' || ch == '-') e++;
      else break;
   }
   if(e <= s) return fallback;
   return StringToDouble(StringSubstr(json, s, e - s));
}

string JsonExtractFirstArrayObject(const string json, const string key)
{
   string needle = "\"" + key + "\":[";
   int arrStart = StringFind(json, needle);
   if(arrStart < 0) return "";
   int i = arrStart + StringLen(needle);
   int n = StringLen(json);

   while(i < n)
   {
      int ch = StringGetCharacter(json, i);
      if(ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n')
      {
         i++;
         continue;
      }
      break;
   }
   if(i >= n) return "";
   if(StringGetCharacter(json, i) != '{') return "";

   int objStart = i;
   int depth = 0;
   bool inString = false;
   bool escaped = false;
   for(; i < n; i++)
   {
      int ch = StringGetCharacter(json, i);
      if(inString)
      {
         if(escaped) escaped = false;
         else if(ch == '\\') escaped = true;
         else if(ch == '"') inString = false;
         continue;
      }
      if(ch == '"')
      {
         inString = true;
         continue;
      }
      if(ch == '{')
      {
         depth++;
         continue;
      }
      if(ch == '}')
      {
         depth--;
         if(depth == 0)
            return StringSubstr(json, objStart, i - objStart + 1);
      }
   }
   return "";
}

string BuildApiUrl(const string path)
{
   string base = InpServerBaseUrl;
   while(StringLen(base) > 0 && StringGetCharacter(base, StringLen(base) - 1) == '/')
      base = StringSubstr(base, 0, StringLen(base) - 1);

   string rel = path;
   if(StringLen(rel) == 0)
      rel = "/";
   if(StringGetCharacter(rel, 0) != '/')
      rel = "/" + rel;

   return base + rel;
}

string SanitizeOneLine(const string raw, const int maxLen = 140)
{
   string out = "";
   int n = StringLen(raw);
   for(int i = 0; i < n; ++i)
   {
      int ch = StringGetCharacter(raw, i);
      if(ch == '\r' || ch == '\n' || ch == '\t')
         out += " ";
      else
         out += StringSubstr(raw, i, 1);
      if(StringLen(out) >= maxLen)
         break;
   }
   StringTrimLeft(out);
   StringTrimRight(out);
   if(StringLen(raw) > StringLen(out))
      out += "...";
   return out;
}

string ExtractApiError(const string body)
{
   string msg = JsonGetString(body, "error");
   if(msg != "")
      return msg;
   msg = JsonGetString(body, "message");
   if(msg != "")
      return msg;
   return SanitizeOneLine(body, 120);
}

string ApiKeyMask()
{
   string k = InpEaApiKey;
   StringTrimLeft(k);
   StringTrimRight(k);
   int n = StringLen(k);
   if(n <= 0) return "(empty)";
   string prefix = n >= 4 ? StringSubstr(k, 0, 4) : k;
   string last4 = n >= 4 ? StringSubstr(k, n - 4, 4) : k;
   return prefix + "***" + last4;
}

string ApiKeyHint()
{
   string k = InpEaApiKey;
   StringTrimLeft(k);
   StringTrimRight(k);
   if(StringLen(k) == 0)
      return "MISSING";
   if(StringFind(k, "acc_") != 0)
      return "INVALID_PREFIX";
   return "OK";
}

int CountOccurrences(const string haystack, const string needle)
{
   int cnt = 0;
   int at = 0;
   int step = StringLen(needle);
   if(step <= 0) return 0;
   while(true)
   {
      int p = StringFind(haystack, needle, at);
      if(p < 0) break;
      cnt++;
      at = p + step;
   }
   return cnt;
}

bool HttpGet(const string url, string &response)
{
   char post[];
   ArrayResize(post, 0);
   char result[];
   string headers = "";
   if(StringLen(InpEaApiKey) > 0)
      headers = "x-api-key: " + InpEaApiKey + "\r\n";
   g_lastHttpMethod = "GET";
   g_lastHttpUrl = url;
   g_lastHttpCode = 0;
   g_lastHttpError = "";
   ResetLastError();
   string resHeaders = "";
   int code = WebRequest("GET", url, headers, 10000, post, result, resHeaders);
   if(code == -1)
   {
      int err = GetLastError();
      g_lastHttpCode = -1;
      g_lastHttpError = "webrequest_error=" + IntegerToString(err);
      Print("WebRequest GET failed: ", err, " url=", url);
      return false;
   }
   g_lastHttpCode = code;
   response = CharArrayToString(result);
   if(code < 200 || code >= 300)
   {
      g_lastHttpError = ExtractApiError(response);
      Print("GET non-2xx code=", code, " err=", g_lastHttpError, " url=", url);
      return false;
   }
   return true;
}

bool HttpPostJson(const string url, const string body)
{
   string dummy;
   return HttpPostJsonWithResponse(url, body, dummy);
}

bool HttpPostJsonWithResponse(const string url, const string body, string &response)
{
   char data[];
   StringToCharArray(body, data, 0, StringLen(body), CP_UTF8);
   char result[];
   string headers = "Content-Type: application/json\r\n";
   if(StringLen(InpEaApiKey) > 0)
      headers += "x-api-key: " + InpEaApiKey + "\r\n";
   g_lastHttpMethod = "POST";
   g_lastHttpUrl = url;
   g_lastHttpCode = 0;
   g_lastHttpError = "";
   ResetLastError();
   string resHeaders = "";
   int code = WebRequest("POST", url, headers, 10000, data, result, resHeaders);
   if(code == -1)
   {
      int err = GetLastError();
      g_lastHttpCode = -1;
      g_lastHttpError = "webrequest_error=" + IntegerToString(err);
      response = "Error=" + IntegerToString(err);
      return false;
   }
   g_lastHttpCode = code;
   response = CharArrayToString(result);
   if(code < 200 || code >= 300)
      g_lastHttpError = ExtractApiError(response);
   return (code >= 200 && code < 300);
}


string JsonEscape(const string s)
{
   string out = "";
   int n = StringLen(s);
   for(int i = 0; i < n; ++i)
   {
      int ch = StringGetCharacter(s, i);
      if(ch == '\\')
         out += "\\\\";
      else if(ch == '\"')
         out += "\\\"";
      else if(ch == '\n')
         out += "\\n";
      else if(ch == '\r')
         out += "\\r";
      else if(ch == '\t')
         out += "\\t";
      else if(ch >= 0 && ch < 32)
         out += " ";
      else
         out += StringSubstr(s, i, 1);
   }
   return out;
}

datetime ParseSignalTime(const string raw)
{
   string s = raw;
   StringTrimLeft(s);
   StringTrimRight(s);
   if(StringLen(s) == 0)
      return 0;

   bool allDigits = true;
   for(int i = 0; i < StringLen(s); ++i)
   {
      int ch = StringGetCharacter(s, i);
      if(ch < '0' || ch > '9')
      {
         allDigits = false;
         break;
      }
   }
   if(allDigits)
      return (datetime)StringToInteger(s);

   return StringToTime(s);
}

void PruneSeenSignals()
{
   if(InpDedupKeepSeconds <= 0)
      return;

   datetime cutoff = TimeCurrent() - InpDedupKeepSeconds;
   int n = ArraySize(g_seenIds);
   int w = 0;
   for(int i = 0; i < n; ++i)
   {
      if(g_seenAt[i] >= cutoff)
      {
         if(w != i)
         {
            g_seenIds[w] = g_seenIds[i];
            g_seenAt[w] = g_seenAt[i];
         }
         ++w;
      }
   }
   ArrayResize(g_seenIds, w);
   ArrayResize(g_seenAt, w);
}

void RemoveStopRetryAt(const int idx)
{
   int n = ArraySize(g_stopRetrySignalId);
   if(idx < 0 || idx >= n)
      return;
   for(int i = idx; i < n - 1; ++i)
   {
      g_stopRetrySignalId[i] = g_stopRetrySignalId[i + 1];
      g_stopRetryTicket[i] = g_stopRetryTicket[i + 1];
      g_stopRetryAction[i] = g_stopRetryAction[i + 1];
      g_stopRetrySymbol[i] = g_stopRetrySymbol[i + 1];
      g_stopRetrySl[i] = g_stopRetrySl[i + 1];
      g_stopRetryTp[i] = g_stopRetryTp[i + 1];
      g_stopRetryAttempts[i] = g_stopRetryAttempts[i + 1];
      g_stopRetryLastTry[i] = g_stopRetryLastTry[i + 1];
      g_stopRetryFirstSeen[i] = g_stopRetryFirstSeen[i + 1];
   }
   ArrayResize(g_stopRetrySignalId, n - 1);
   ArrayResize(g_stopRetryTicket, n - 1);
   ArrayResize(g_stopRetryAction, n - 1);
   ArrayResize(g_stopRetrySymbol, n - 1);
   ArrayResize(g_stopRetrySl, n - 1);
   ArrayResize(g_stopRetryTp, n - 1);
   ArrayResize(g_stopRetryAttempts, n - 1);
   ArrayResize(g_stopRetryLastTry, n - 1);
   ArrayResize(g_stopRetryFirstSeen, n - 1);
}

void EnqueueStopRetry(const string signalId,
                      const ulong ticket,
                      const string action,
                      const string symbol,
                      const double sl,
                      const double tp)
{
   if((sl <= 0.0 && tp <= 0.0) || StringLen(symbol) == 0)
      return;

   int n = ArraySize(g_stopRetrySignalId);
   for(int i = 0; i < n; ++i)
   {
      if(g_stopRetrySignalId[i] == signalId)
      {
         g_stopRetryTicket[i] = ticket;
         g_stopRetryAction[i] = action;
         g_stopRetrySymbol[i] = symbol;
         g_stopRetrySl[i] = sl;
         g_stopRetryTp[i] = tp;
         return;
      }
   }

   ArrayResize(g_stopRetrySignalId, n + 1);
   ArrayResize(g_stopRetryTicket, n + 1);
   ArrayResize(g_stopRetryAction, n + 1);
   ArrayResize(g_stopRetrySymbol, n + 1);
   ArrayResize(g_stopRetrySl, n + 1);
   ArrayResize(g_stopRetryTp, n + 1);
   ArrayResize(g_stopRetryAttempts, n + 1);
   ArrayResize(g_stopRetryLastTry, n + 1);
   ArrayResize(g_stopRetryFirstSeen, n + 1);

   g_stopRetrySignalId[n] = signalId;
   g_stopRetryTicket[n] = ticket;
   g_stopRetryAction[n] = action;
   g_stopRetrySymbol[n] = symbol;
   g_stopRetrySl[n] = sl;
   g_stopRetryTp[n] = tp;
   g_stopRetryAttempts[n] = 0;
   g_stopRetryLastTry[n] = 0;
   g_stopRetryFirstSeen[n] = TimeCurrent();
}

void ProcessStopRetryQueue()
{
   int n = ArraySize(g_stopRetrySignalId);
   if(n <= 0)
      return;

   datetime nowTs = TimeCurrent();
   int retryEvery = MathMax(1, InpStopRetrySeconds);
   int maxAttempts = MathMax(1, InpStopRetryMaxAttempts);

   for(int i = n - 1; i >= 0; --i)
   {
      if(g_stopRetryAttempts[i] >= maxAttempts)
      {
         Print("Stop retry max attempts reached id=", g_stopRetrySignalId[i],
               " symbol=", g_stopRetrySymbol[i],
               " attempts=", g_stopRetryAttempts[i]);
         RemoveStopRetryAt(i);
         continue;
      }

      if(g_stopRetryLastTry[i] > 0 && (nowTs - g_stopRetryLastTry[i]) < retryEvery)
         continue;

      string info = "";
      bool ok = ApplyStopsAfterOpen(g_stopRetryTicket[i],
                                    g_stopRetryAction[i],
                                    g_stopRetrySymbol[i],
                                    g_stopRetrySl[i],
                                    g_stopRetryTp[i],
                                    info);
      g_stopRetryAttempts[i]++;
      g_stopRetryLastTry[i] = nowTs;

      if(ok)
      {
         Print("Stop retry success id=", g_stopRetrySignalId[i],
               " symbol=", g_stopRetrySymbol[i],
               " attempts=", g_stopRetryAttempts[i],
               " info=", info);
         RemoveStopRetryAt(i);
         continue;
      }

      Print("Stop retry pending id=", g_stopRetrySignalId[i],
            " ticket=", IntegerToString((long)g_stopRetryTicket[i]),
            " symbol=", g_stopRetrySymbol[i],
            " attempt=", g_stopRetryAttempts[i], "/", maxAttempts,
            " info=", info);
   }
}

bool FindLatestPositionTicket(const string symbol, const long magic, ulong &ticketOut)
{
   ticketOut = 0;
   datetime bestTime = 0;
   for(int i = PositionsTotal() - 1; i >= 0; --i)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket))
         continue;
      if(PositionGetString(POSITION_SYMBOL) != symbol)
         continue;
      if(PositionGetInteger(POSITION_MAGIC) != magic)
         continue;
      datetime t = (datetime)PositionGetInteger(POSITION_TIME);
      if(ticketOut == 0 || t >= bestTime)
      {
         ticketOut = ticket;
         bestTime = t;
      }
   }
   return ticketOut != 0;
}

string PositionSideText(const ENUM_POSITION_TYPE pt)
{
   if(pt == POSITION_TYPE_BUY)  return "BUY";
   if(pt == POSITION_TYPE_SELL) return "SELL";
   return "?";
}

string PositionTimeText(const datetime t)
{
   if(t <= 0) return "-";
   return TimeToString(t, TIME_DATE | TIME_MINUTES);
}

double PositionRR(const double entry, const double sl, const double tp)
{
   if(sl <= 0.0 || tp <= 0.0 || entry <= 0.0)
      return 0.0;
   double risk = MathAbs(entry - sl);
   if(risk <= 0.0)
      return 0.0;
   double reward = MathAbs(tp - entry);
  return reward / risk;
}

int FindVirtualGuardIndexByTicket(const ulong ticket)
{
   for(int i = 0; i < ArraySize(g_vgTicket); ++i)
   {
      if(g_vgTicket[i] == ticket)
         return i;
   }
   return -1;
}

void RemoveVirtualGuardAt(const int idx)
{
   int n = ArraySize(g_vgTicket);
   if(idx < 0 || idx >= n)
      return;
   for(int i = idx; i < n - 1; ++i)
   {
      g_vgTicket[i] = g_vgTicket[i + 1];
      g_vgSignalId[i] = g_vgSignalId[i + 1];
      g_vgSymbol[i] = g_vgSymbol[i + 1];
      g_vgSide[i] = g_vgSide[i + 1];
      g_vgEntry[i] = g_vgEntry[i + 1];
      g_vgSl[i] = g_vgSl[i + 1];
      g_vgTp[i] = g_vgTp[i + 1];
      g_vgRisk[i] = g_vgRisk[i + 1];
      g_vgOpenedAt[i] = g_vgOpenedAt[i + 1];
   }
   ArrayResize(g_vgTicket, n - 1);
   ArrayResize(g_vgSignalId, n - 1);
   ArrayResize(g_vgSymbol, n - 1);
   ArrayResize(g_vgSide, n - 1);
   ArrayResize(g_vgEntry, n - 1);
   ArrayResize(g_vgSl, n - 1);
   ArrayResize(g_vgTp, n - 1);
   ArrayResize(g_vgRisk, n - 1);
   ArrayResize(g_vgOpenedAt, n - 1);
}

bool BuildVirtualLevels(const string action,
                        const string symbol,
                        const double entry,
                        double slIn,
                        double tpIn,
                        double &slOut,
                        double &tpOut,
                        double &riskOut)
{
   slOut = slIn;
   tpOut = tpIn;
   riskOut = 0.0;

   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits < 0) digits = 5;
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if(point <= 0.0) point = 0.00001;

   int fallbackPts = MathMax(10, InpVirtualFallbackSLPts);
   double minRR = MathMax(0.1, InpVirtualMinRR);
   double fallbackRR = MathMax(0.2, InpVirtualFallbackRR);

   if(action == "BUY")
   {
      if(slOut <= 0.0 || slOut >= entry)
         slOut = entry - fallbackPts * point;
      riskOut = entry - slOut;
      if(riskOut <= 0.0)
         return false;
      if(tpOut <= 0.0 || tpOut <= entry)
         tpOut = entry + riskOut * fallbackRR;
      double rrNow = (tpOut - entry) / riskOut;
      if(rrNow < minRR)
         tpOut = entry + riskOut * minRR;
   }
   else if(action == "SELL")
   {
      if(slOut <= 0.0 || slOut <= entry)
         slOut = entry + fallbackPts * point;
      riskOut = slOut - entry;
      if(riskOut <= 0.0)
         return false;
      if(tpOut <= 0.0 || tpOut >= entry)
         tpOut = entry - riskOut * fallbackRR;
      double rrNow = (entry - tpOut) / riskOut;
      if(rrNow < minRR)
         tpOut = entry - riskOut * minRR;
   }
   else
   {
      return false;
   }

   slOut = NormalizeDouble(slOut, digits);
   tpOut = NormalizeDouble(tpOut, digits);
   return true;
}

void RegisterVirtualGuard(const string signalId,
                          const ulong ticket,
                          const string action,
                          const string symbol,
                          const double slCandidate,
                          const double tpCandidate)
{
   if(!InpEnableVirtualGuard || ticket == 0 || StringLen(symbol) == 0)
      return;
   if(!PositionSelectByTicket(ticket))
      return;

   double entry = PositionGetDouble(POSITION_PRICE_OPEN);
   datetime openedAt = (datetime)PositionGetInteger(POSITION_TIME);
   int side = action == "BUY" ? 1 : (action == "SELL" ? -1 : 0);
   if(side == 0)
      return;

   double vSl = 0.0, vTp = 0.0, risk = 0.0;
   if(!BuildVirtualLevels(action, symbol, entry, slCandidate, tpCandidate, vSl, vTp, risk))
      return;

   int idx = FindVirtualGuardIndexByTicket(ticket);
   if(idx < 0)
   {
      int n = ArraySize(g_vgTicket);
      ArrayResize(g_vgTicket, n + 1);
      ArrayResize(g_vgSignalId, n + 1);
      ArrayResize(g_vgSymbol, n + 1);
      ArrayResize(g_vgSide, n + 1);
      ArrayResize(g_vgEntry, n + 1);
      ArrayResize(g_vgSl, n + 1);
      ArrayResize(g_vgTp, n + 1);
      ArrayResize(g_vgRisk, n + 1);
      ArrayResize(g_vgOpenedAt, n + 1);
      idx = n;
   }

   g_vgTicket[idx] = ticket;
   g_vgSignalId[idx] = signalId;
   g_vgSymbol[idx] = symbol;
   g_vgSide[idx] = side;
   g_vgEntry[idx] = entry;
   g_vgSl[idx] = vSl;
   g_vgTp[idx] = vTp;
   g_vgRisk[idx] = risk;
   g_vgOpenedAt[idx] = openedAt;
}

void ProcessVirtualGuards()
{
   if(!InpEnableVirtualGuard || ArraySize(g_vgTicket) == 0)
      return;

   double beR = MathMax(0.2, InpVirtualBreakEvenR);
   double trailStartR = MathMax(beR, InpVirtualTrailStartR);
   double givebackR = MathMax(0.0, InpVirtualTrailGivebackR);
   int maxHoldMin = MathMax(0, InpVirtualMaxHoldMinutes);
   datetime nowTs = TimeCurrent();

   for(int i = ArraySize(g_vgTicket) - 1; i >= 0; --i)
   {
      ulong ticket = g_vgTicket[i];
      if(!PositionSelectByTicket(ticket))
      {
         RemoveVirtualGuardAt(i);
         continue;
      }

      string symbol = g_vgSymbol[i];
      int side = g_vgSide[i];
      double entry = g_vgEntry[i];
      double risk = g_vgRisk[i];
      if(risk <= 0.0 || side == 0)
      {
         RemoveVirtualGuardAt(i);
         continue;
      }

      double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
      double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
      if(bid <= 0.0 || ask <= 0.0)
      {
         MqlTick tick;
         if(SymbolInfoTick(symbol, tick))
         {
            bid = tick.bid;
            ask = tick.ask;
         }
      }
      if(bid <= 0.0 || ask <= 0.0)
         continue;

      double px = side > 0 ? bid : ask;
      double profitR = side > 0 ? (px - entry) / risk : (entry - px) / risk;

      // Break-even
      if(profitR >= beR)
      {
         if(side > 0 && g_vgSl[i] < entry)
            g_vgSl[i] = entry;
         if(side < 0 && g_vgSl[i] > entry)
            g_vgSl[i] = entry;
      }

      // Trailing by R giveback.
      if(profitR >= trailStartR)
      {
         double lockR = MathMax(0.0, profitR - givebackR);
         if(side > 0)
         {
            double nextSl = entry + lockR * risk;
            if(nextSl > g_vgSl[i])
               g_vgSl[i] = nextSl;
         }
         else
         {
            double nextSl = entry - lockR * risk;
            if(nextSl < g_vgSl[i])
               g_vgSl[i] = nextSl;
         }
      }

      bool hitSl = (side > 0) ? (px <= g_vgSl[i]) : (px >= g_vgSl[i]);
      bool hitTp = false;
      if(g_vgTp[i] > 0.0)
         hitTp = (side > 0) ? (px >= g_vgTp[i]) : (px <= g_vgTp[i]);

      bool timeUp = false;
      if(maxHoldMin > 0 && g_vgOpenedAt[i] > 0)
         timeUp = ((nowTs - g_vgOpenedAt[i]) >= (maxHoldMin * 60));

      if(!(hitSl || hitTp || timeUp))
         continue;

      string reason = hitSl ? "virtual_sl" : (hitTp ? "virtual_tp" : "virtual_timeout");
      bool closed = trade.PositionClose(ticket);
      if(closed)
      {
         Print("Virtual guard close success id=", g_vgSignalId[i],
               " ticket=", IntegerToString((int)ticket),
               " symbol=", symbol,
               " reason=", reason,
               " px=", DoubleToString(px, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS)));
         string vgStatus = hitSl ? "SL" : (hitTp ? "TP" : "CANCEL");
         g_ackSymbol = symbol;
         g_ackAction = side > 0 ? "BUY" : "SELL";
         g_ackHasPnlRealized = false;
         g_ackPnlRealized = 0.0;
         Ack(g_vgSignalId[i], vgStatus, IntegerToString((int)ticket), reason);
         int pIdx = FindPositionMapIndex(ticket);
         if(pIdx >= 0)
            RemovePositionMapAt(pIdx);
         RemoveVirtualGuardAt(i);
      }
      else
      {
         Print("Virtual guard close failed id=", g_vgSignalId[i],
               " ticket=", IntegerToString((int)ticket),
               " symbol=", symbol,
               " reason=", reason,
               " retcode=", IntegerToString((int)trade.ResultRetcode()),
               " msg=", trade.ResultRetcodeDescription());
      }
   }
}

int FindPositionMapIndex(const ulong ticket)
{
   for(int i = 0; i < ArraySize(g_posMapTicket); ++i)
      if(g_posMapTicket[i] == ticket)
         return i;
   return -1;
}

void MapPositionSignal(const ulong ticket, const string signalId)
{
   if(ticket == 0 || StringLen(signalId) == 0)
      return;
   int idx = FindPositionMapIndex(ticket);
   if(idx < 0)
   {
      int n = ArraySize(g_posMapTicket);
      ArrayResize(g_posMapTicket, n + 1);
      ArrayResize(g_posMapSignalId, n + 1);
      ArrayResize(g_posMapOpenedAckSent, n + 1);
      idx = n;
   }
   g_posMapTicket[idx] = ticket;
   g_posMapSignalId[idx] = signalId;
   SaveMappings();
}

void SaveMappings()
{
   int h = FileOpen(InpMappingFile, FILE_WRITE|FILE_CSV|FILE_ANSI);
   if(h == INVALID_HANDLE) return;

   FileWrite(h, "TYPE", "TICKET", "SIGNAL_ID", "ACK_SENT");

   for(int i=0; i<ArraySize(g_posMapTicket); i++)
      FileWrite(h, "POS", IntegerToString(g_posMapTicket[i]), g_posMapSignalId[i], (g_posMapOpenedAckSent[i]?"1":"0"));

   for(int i=0; i<ArraySize(g_ordMapTicket); i++)
      FileWrite(h, "ORD", IntegerToString(g_ordMapTicket[i]), g_ordMapSignalId[i], "0");

   FileClose(h);
}

void LoadMappings()
{
   int h = FileOpen(InpMappingFile, FILE_READ|FILE_CSV|FILE_ANSI);
   if(h == INVALID_HANDLE) return;

   if(!FileIsEnding(h)) FileReadString(h); // Header
   if(!FileIsEnding(h)) FileReadString(h);
   if(!FileIsEnding(h)) FileReadString(h);
   if(!FileIsEnding(h)) FileReadString(h);

   ArrayResize(g_posMapTicket, 0);
   ArrayResize(g_posMapSignalId, 0);
   ArrayResize(g_posMapOpenedAckSent, 0);
   ArrayResize(g_ordMapTicket, 0);
   ArrayResize(g_ordMapSignalId, 0);

   while(!FileIsEnding(h))
   {
      string type = FileReadString(h);
      if(StringLen(type) == 0) break;
      string ticketStr = FileReadString(h);
      string signalId = FileReadString(h);
      string ackSentStr = FileReadString(h);

      if(type == "POS")
      {
         int n = ArraySize(g_posMapTicket);
         ArrayResize(g_posMapTicket, n+1);
         ArrayResize(g_posMapSignalId, n+1);
         ArrayResize(g_posMapOpenedAckSent, n+1);
         g_posMapTicket[n] = (ulong)StringToInteger(ticketStr);
         g_posMapSignalId[n] = signalId;
         g_posMapOpenedAckSent[n] = (ackSentStr == "1");
      }
      else if(type == "ORD")
      {
         int n = ArraySize(g_ordMapTicket);
         ArrayResize(g_ordMapTicket, n+1);
         ArrayResize(g_ordMapSignalId, n+1);
         g_ordMapTicket[n] = (ulong)StringToInteger(ticketStr);
         g_ordMapSignalId[n] = signalId;
      }
   }
   FileClose(h);
   Print("Loaded mappings: Positions=", ArraySize(g_posMapTicket), " Orders=", ArraySize(g_ordMapTicket));
}

bool GetSignalIdByPositionTicket(const ulong ticket, string &signalIdOut, int &idxOut)
{
   signalIdOut = "";
   idxOut = -1;
   if(ticket == 0)
      return false;
   int idx = FindPositionMapIndex(ticket);
   if(idx < 0)
      return false;
   signalIdOut = g_posMapSignalId[idx];
   idxOut = idx;
   return StringLen(signalIdOut) > 0;
}

void RemovePositionMapAt(const int idx)
{
   int n = ArraySize(g_posMapTicket);
   if(idx < 0 || idx >= n)
      return;
   for(int i = idx; i < n - 1; ++i)
   {
      g_posMapTicket[i] = g_posMapTicket[i + 1];
      g_posMapSignalId[i] = g_posMapSignalId[i + 1];
      g_posMapOpenedAckSent[i] = g_posMapOpenedAckSent[i + 1];
   }
   ArrayResize(g_posMapTicket, n - 1);
   ArrayResize(g_posMapSignalId, n - 1);
   ArrayResize(g_posMapOpenedAckSent, n - 1);
   SaveMappings();
}

int FindOrderMapIndex(const ulong ticket)
{
   for(int i = 0; i < ArraySize(g_ordMapTicket); ++i)
      if(g_ordMapTicket[i] == ticket)
         return i;
   return -1;
}

void MapOrderSignal(const ulong ticket, const string signalId)
{
   if(ticket == 0 || StringLen(signalId) == 0)
      return;
   int idx = FindOrderMapIndex(ticket);
   if(idx < 0)
   {
      int n = ArraySize(g_ordMapTicket);
      ArrayResize(g_ordMapTicket, n + 1);
      ArrayResize(g_ordMapSignalId, n + 1);
      idx = n;
   }
   g_ordMapTicket[idx] = ticket;
   g_ordMapSignalId[idx] = signalId;
   SaveMappings();
}

bool GetSignalIdByOrderTicket(const ulong ticket, string &signalIdOut, int &idxOut)
{
   signalIdOut = "";
   idxOut = -1;
   if(ticket == 0)
      return false;
   int idx = FindOrderMapIndex(ticket);
   if(idx < 0)
      return false;
   signalIdOut = g_ordMapSignalId[idx];
   idxOut = idx;
   return StringLen(signalIdOut) > 0;
}

void RemoveOrderMapAt(const int idx)
{
   int n = ArraySize(g_ordMapTicket);
   if(idx < 0 || idx >= n)
      return;
   for(int i = idx; i < n - 1; ++i)
   {
      g_ordMapTicket[i] = g_ordMapTicket[i + 1];
      g_ordMapSignalId[i] = g_ordMapSignalId[i + 1];
   }
   ArrayResize(g_ordMapTicket, n - 1);
   ArrayResize(g_ordMapSignalId, n - 1);
   SaveMappings();
}

string NormalizeOrderType(const string orderTypeRaw)
{
   string t = orderTypeRaw;
   StringToLower(t);
   if(t == "market" || t == "limit" || t == "stop")
      return t;
   return "limit";
}

string ResolvePendingKind(const string action, const string orderType, const double entry, const double ask, const double bid)
{
   double eps = MathMax(0.00000001, MathAbs(entry) * 0.0000001);

   // Normalize pending kind by side + entry/current relation to avoid broker "invalid price".
   // BUY: entry below ask => LIMIT, otherwise STOP.
   // SELL: entry above bid => LIMIT, otherwise STOP.
   if(action == "BUY")
      return (entry <= (ask - eps) ? "limit" : "stop");
   if(action == "SELL")
      return (entry >= (bid + eps) ? "limit" : "stop");
   return "limit";
}

void CleanupVirtualGuardByTicket(const ulong ticket)
{
   int idx = FindVirtualGuardIndexByTicket(ticket);
   if(idx >= 0)
      RemoveVirtualGuardAt(idx);
}

string BuildPositionsTable(const int maxRows = 8)
{
   int total = PositionsTotal();
   string out = "Open Positions\n";
   out += "Sym      Side  Entry      TP         SL         RR   Time\n";

   int shown = 0;
   int matched = 0;
   for(int i = total - 1; i >= 0; --i)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket))
         continue;

      long magic = PositionGetInteger(POSITION_MAGIC);
      if(magic != InpMagic)
         continue;
      matched++;

      string sym = PositionGetString(POSITION_SYMBOL);
      ENUM_POSITION_TYPE ptype = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      string side = PositionSideText(ptype);

      double entry = PositionGetDouble(POSITION_PRICE_OPEN);
      double tp = PositionGetDouble(POSITION_TP);
      double sl = PositionGetDouble(POSITION_SL);
      datetime ptm = (datetime)PositionGetInteger(POSITION_TIME);
      int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      if(digits < 0) digits = 5;

      string entryTxt = entry > 0.0 ? DoubleToString(entry, digits) : "-";
      string tpTxt = tp > 0.0 ? DoubleToString(tp, digits) : "-";
      string slTxt = sl > 0.0 ? DoubleToString(sl, digits) : "-";
      double rr = PositionRR(entry, sl, tp);
      string rrTxt = rr > 0.0 ? DoubleToString(rr, 2) : "-";
      string timeTxt = PositionTimeText(ptm);

      out += StringFormat("%-8s %-5s %-10s %-10s %-10s %-4s %s\n",
                          sym, side, entryTxt, tpTxt, slTxt, rrTxt, timeTxt);
      shown++;
      if(shown >= maxRows)
         break;
   }

   if(shown == 0)
      out += "- (no positions for this EA magic)\n";
   else if(matched > shown)
      out += StringFormat("... showing %d rows\n", shown);

   return out;
}

void RefreshDebugPanel()
{
   if(!InpShowDebugPanel)
      return;

   string mode = InpBacktestMode ? "BACKTEST" : "LIVE";
   string stPull = g_lastPullUpdate > 0 ? (" [" + TimeToString(g_lastPullUpdate, TIME_SECONDS) + "]") : "";
   string stSync = g_lastSyncUpdate > 0 ? (" [" + TimeToString(g_lastSyncUpdate, TIME_SECONDS) + "]") : "";
   string authHint = ApiKeyHint();
   int ackQ = ArraySize(g_ackQSignalId);
   int stopQ = ArraySize(g_stopRetrySignalId);
   int posCnt = PositionsTotal();
   int ordCnt = OrdersTotal();
   string text =
      "TVBridgeEA | Build " + EA_BUILD_VERSION + " (" + mode + ")\n" +
      "--------------------------------------------------\n" +
      "Account=" + IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN)) + "  Poll=" + IntegerToString(InpPollSeconds) + "s\n" +
      "API Key=" + ApiKeyMask() + "  AuthHint=" + authHint + "\n" +
      "PULL" + stPull + " code=" + IntegerToString(g_lastPullCode) + " :: " + g_lastPullSummary + "\n" +
      "SYNC" + stSync + " code=" + IntegerToString(g_lastSyncCode) + " :: " + g_lastSyncSummary + "\n" +
      "LAST SIGNAL: " + g_dbgLastStatus + " | " + g_dbgLastAction + " " + g_dbgLastSymbol + " | id=" + g_dbgLastSignalId + "\n" +
      "Queues: ack=" + IntegerToString(ackQ) + " stopRetry=" + IntegerToString(stopQ) + " | Terminal: pos=" + IntegerToString(posCnt) + " ord=" + IntegerToString(ordCnt);
   if(authHint != "OK")
      text += "\nHint: rotate account API key in UI, then paste latest acc_... into InpEaApiKey.";
   Comment(text);
}

bool IsDuplicateSignal(const string signalId)
{
   if(!InpEnableDuplicateGate || StringLen(signalId) == 0)
      return false;

   PruneSeenSignals();
   for(int i = ArraySize(g_seenIds) - 1; i >= 0; --i)
   {
      if(g_seenIds[i] == signalId)
         return true;
   }
   return false;
}

void RememberSignal(const string signalId)
{
   if(!InpEnableDuplicateGate || StringLen(signalId) == 0)
      return;

   int n = ArraySize(g_seenIds);
   ArrayResize(g_seenIds, n + 1);
   ArrayResize(g_seenAt, n + 1);
   g_seenIds[n] = signalId;
   g_seenAt[n] = TimeCurrent();
   PruneSeenSignals();
}

bool IsExpiredSignal(const datetime signalTs)
{
   if(InpMaxSignalAgeSeconds <= 0 || signalTs <= 0)
      return false;
   // Server timestamps are unix/UTC based; compare against UTC clock to avoid broker-server TZ offset.
   return (TimeGMT() - signalTs) > InpMaxSignalAgeSeconds;
}

bool IsPlausibleEpochTs(const datetime ts)
{
   if(ts <= 0)
      return false;
   // Guard against parser artifacts (e.g., year-only parse) and absurd future timestamps.
   datetime minTs = D'2000.01.01 00:00:00';
   datetime maxTs = TimeGMT() + 86400 * 365; // 1 year in future is still acceptable.
   return ts >= minTs && ts <= maxTs;
}

bool ResolveSymbol(const string raw, string &resolved)
{
   string s = raw;
   StringTrimLeft(s);
   StringTrimRight(s);
   if(StringLen(s) > 0 && (SymbolInfoInteger(s, SYMBOL_SELECT) || SymbolSelect(s, true)))
   {
      resolved = s;
      return true;
   }

   if(StringLen(InpSymbolSuffix) > 0)
   {
      string t = s + InpSymbolSuffix;
      if(SymbolInfoInteger(t, SYMBOL_SELECT) || SymbolSelect(t, true))
      {
         resolved = t;
         return true;
      }
   }

   resolved = "";
   return false;
}

int VolumeDigits(const double step)
{
   if(step <= 0.0)
      return 2;
   for(int d = 0; d <= 8; ++d)
   {
      double scaled = step * MathPow(10.0, d);
      if(MathAbs(scaled - MathRound(scaled)) < 1e-8)
         return d;
   }
   return 2;
}

bool NormalizeVolumeForSymbol(const string symbol,
                              const double volumeIn,
                              double &volumeOut,
                              string &noteOut,
                              bool forceNoRoundingUp = false)
{
   noteOut = "";
   double vMin = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double vMax = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double vStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if(vMin <= 0.0) vMin = 0.01;
   if(vMax <= 0.0) vMax = 100.0;
   if(vStep <= 0.0) vStep = 0.01;

   double v = volumeIn;
   if(v <= 0.0)
      v = vMin;

   if(v < vMin)
   {
      if(forceNoRoundingUp) {
         volumeOut = 0;
         noteOut = "[rejected] Calculated " + DoubleToString(v, 4) + " < min lot " + DoubleToString(vMin, 2);
         return false;
      }
      v = vMin;
      noteOut += "[vol->min]";
   }
   if(v > vMax)
   {
      v = vMax;
      noteOut += "[vol->max]";
   }

   // MathFloor ensures we don't exceed the risk cap by rounding down to the nearest step.
   double steps = MathFloor((v - vMin) / vStep + 1e-9);
   double vAligned = vMin + steps * vStep;
   if(vAligned < vMin) {
      if(forceNoRoundingUp) {
         volumeOut = 0;
         noteOut = "[rejected] Aligned " + DoubleToString(vAligned, 4) + " < min lot " + DoubleToString(vMin, 2);
         return false;
      }
      vAligned = vMin;
   }
   if(vAligned > vMax)
      vAligned = vMax;

   int vd = VolumeDigits(vStep);
   vAligned = NormalizeDouble(vAligned, vd);
   volumeOut = vAligned;

   if(volumeOut < vMin - 1e-10 || volumeOut > vMax + 1e-10)
      return false;

   return true;
}

bool ComputeRiskBasedVolume(const string action,
                            const string symbol,
                            const double plannedEntryPrice,
                            const double slPrice,
                            const double requestedRiskPct,
                            const double requestedRiskMoney,
                            double &volumeOut,
                            string &noteOut)
{
   noteOut = "";
   volumeOut = 0.0;
   if(!InpUseRiskPercentSizing)
   {
      noteOut = "[risk_mode_off]";
      return false;
   }
   if(InpMaxRiskPct <= 0.0)
   {
      noteOut = "[risk_pct<=0]";
      return false;
   }
   if(slPrice <= 0.0)
   {
      noteOut = "[missing_sl]";
      return false;
   }

   double entryPrice = plannedEntryPrice;
   ENUM_ORDER_TYPE orderType = ORDER_TYPE_BUY;
   MqlTick tick;
   if((!MathIsValidNumber(entryPrice)) || entryPrice <= 0.0)
   {
      if(!SymbolInfoTick(symbol, tick))
      {
         noteOut = "[tick_unavailable]";
         return false;
      }
      entryPrice = (action == "BUY" ? tick.ask : tick.bid);
   }
   if(action == "BUY")
   {
      orderType = ORDER_TYPE_BUY;
      if(slPrice >= entryPrice)
      {
         noteOut = "[sl_not_below_entry]";
         return false;
      }
   }
   else if(action == "SELL")
   {
      orderType = ORDER_TYPE_SELL;
      if(slPrice <= entryPrice)
      {
         noteOut = "[sl_not_above_entry]";
         return false;
      }
   }
   else
   {
      noteOut = "[unsupported_action_for_risk]";
      return false;
   }
   if(entryPrice <= 0.0)
   {
      noteOut = "[entry_price_invalid]";
      return false;
   }

   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   if(balance <= 0.0)
   {
      noteOut = "[balance_invalid]";
      return false;
   }
   
   double riskMoney = 0.0;
   if(requestedRiskMoney > 0.0) {
      riskMoney = requestedRiskMoney;
   } else if(requestedRiskPct > 0.0) {
      riskMoney = balance * (requestedRiskPct / 100.0);
   } else {
      riskMoney = balance * (InpMaxRiskPct / 100.0);
   }
   
   double maxRiskFromPct = balance * (InpMaxRiskPct / 100.0);
   riskMoney = MathMin(riskMoney, maxRiskFromPct);
   
   if(InpMaxRiskAmount > 0.0) {
      riskMoney = MathMin(riskMoney, InpMaxRiskAmount);
   }

   if(riskMoney <= 0.0)
   {
      noteOut = "[risk_money_invalid]";
      return false;
   }

   double lossForOneLot = 0.0;
   if(!OrderCalcProfit(orderType, symbol, 1.0, entryPrice, slPrice, lossForOneLot))
   {
      noteOut = "[OrderCalcProfit_failed]";
      return false;
   }
   double lossAbs = MathAbs(lossForOneLot);
   if(lossAbs <= 0.0)
   {
      noteOut = "[loss_per_lot_invalid]";
      return false;
   }

   double rawVolume = riskMoney / lossAbs;
   string normNote = "";
   // Round down to ensure we never exceed InpMaxRiskPct.
   if(!NormalizeVolumeForSymbol(symbol, rawVolume, volumeOut, normNote, true))
   {
      noteOut = normNote;
      return false;
   }

   noteOut = "[risk_sized balance=" + DoubleToString(balance, 2)
             + " max_risk$=" + DoubleToString(riskMoney, 2)
             + " loss1lot$=" + DoubleToString(lossAbs, 2)
             + " target_vol=" + DoubleToString(rawVolume, 4) + "]";
   if(StringLen(normNote) > 0) noteOut += " " + normNote;
   return true;
}


bool FitVolumeToFreeMargin(const string action,
                           const string symbol,
                           const double volumeIn,
                           double &volumeOut,
                           string &noteOut)
{
   noteOut = "";
   volumeOut = volumeIn;
   if(!(action == "BUY" || action == "SELL"))
      return true;

   MqlTick tick;
   if(!SymbolInfoTick(symbol, tick))
   {
      noteOut = "[tick_unavailable_for_margin]";
      return false;
   }
   double price = (action == "BUY" ? tick.ask : tick.bid);
   if(price <= 0.0)
   {
      noteOut = "[price_invalid_for_margin]";
      return false;
   }
   ENUM_ORDER_TYPE orderType = (action == "BUY" ? ORDER_TYPE_BUY : ORDER_TYPE_SELL);
   double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   if(freeMargin <= 0.0)
   {
      noteOut = "[free_margin<=0]";
      return false;
   }
   double safetyPct = InpMarginSafetyPercent;
   if(safetyPct <= 0.0 || safetyPct > 100.0)
      safetyPct = 98.0;
   double freeMarginBudget = freeMargin * (safetyPct / 100.0); // keep a safety buffer for spread changes.
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double balanceBudget = DBL_MAX;
   if(InpMarginPercentOfBalance > 0.0 && balance > 0.0)
      balanceBudget = balance * (InpMarginPercentOfBalance / 100.0);
   double marginBudget = MathMin(freeMarginBudget, balanceBudget);
   if(!MathIsValidNumber(marginBudget) || marginBudget <= 0.0)
      marginBudget = freeMarginBudget;
   g_ackMarginBudget = marginBudget;

   double vMin = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double vStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if(vMin <= 0.0) vMin = 0.01;
   if(vStep <= 0.0) vStep = 0.01;

   double v = volumeIn;
   string normNote = "";
   if(!NormalizeVolumeForSymbol(symbol, v, v, normNote))
   {
      noteOut = "[margin_norm_failed]";
      return false;
   }

   double marginReq = 0.0;
   if(OrderCalcMargin(orderType, symbol, v, price, marginReq) && marginReq > 0.0 && marginReq <= marginBudget)
   {
      volumeOut = v;
      return true;
   }

   int maxIters = (int)MathCeil((v - vMin) / vStep) + 5;
   if(maxIters < 1) maxIters = 1;
   for(int i = 0; i < maxIters; ++i)
   {
      v -= vStep;
      if(v < vMin - 1e-10)
         break;
      string n2 = "";
      if(!NormalizeVolumeForSymbol(symbol, v, v, n2))
         continue;
      if(OrderCalcMargin(orderType, symbol, v, price, marginReq) && marginReq > 0.0 && marginReq <= marginBudget)
      {
         volumeOut = v;
         noteOut = "[margin_fit budget=" + DoubleToString(marginBudget, 2)
                   + " free=" + DoubleToString(freeMargin, 2)
                   + " req=" + DoubleToString(marginReq, 2) + "]";
         return true;
      }
   }

   double minReq = 0.0;
   OrderCalcMargin(orderType, symbol, vMin, price, minReq);
   noteOut = "[no_affordable_volume budget=" + DoubleToString(marginBudget, 2)
             + " free=" + DoubleToString(freeMargin, 2)
             + " req@min=" + DoubleToString(minReq, 2) + "]";
   return false;
}

bool ComputeMarginPercentVolume(const string action,
                                const string symbol,
                                const double marginPct,
                                double &volumeOut,
                                string &noteOut)
{
   noteOut = "";
   volumeOut = 0.0;
   if(!(action == "BUY" || action == "SELL"))
   {
      noteOut = "[unsupported_action_for_margin_sizing]";
      return false;
   }
   if(marginPct <= 0.0)
   {
      noteOut = "[margin_pct<=0]";
      return false;
   }

   MqlTick tick;
   if(!SymbolInfoTick(symbol, tick))
   {
      noteOut = "[tick_unavailable]";
      return false;
   }
   double price = (action == "BUY" ? tick.ask : tick.bid);
   if(price <= 0.0)
   {
      noteOut = "[price_invalid]";
      return false;
   }

   double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   if(freeMargin <= 0.0 || balance <= 0.0)
   {
      noteOut = "[account_margin_or_balance_invalid]";
      return false;
   }

   double safetyPct = InpMarginSafetyPercent;
   if(safetyPct <= 0.0 || safetyPct > 100.0)
      safetyPct = 98.0;
   double freeBudget = freeMargin * (safetyPct / 100.0);
   double balanceBudget = balance * (marginPct / 100.0);
   double budget = MathMin(freeBudget, balanceBudget);
   if(!MathIsValidNumber(budget) || budget <= 0.0)
   {
      noteOut = "[budget_invalid]";
      return false;
   }
   g_ackMarginBudget = budget;

   double vMin = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double vMax = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double vStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if(vMin <= 0.0) vMin = 0.01;
   if(vMax <= 0.0) vMax = 100.0;
   if(vStep <= 0.0) vStep = 0.01;

   ENUM_ORDER_TYPE orderType = (action == "BUY" ? ORDER_TYPE_BUY : ORDER_TYPE_SELL);
   double minReq = 0.0;
   if(!OrderCalcMargin(orderType, symbol, vMin, price, minReq) || minReq <= 0.0)
   {
      noteOut = "[min_margin_calc_failed]";
      return false;
   }
   if(minReq > budget)
   {
      noteOut = "[budget_below_minlot budget=" + DoubleToString(budget, 2)
                + " req@min=" + DoubleToString(minReq, 2) + "]";
      return false;
   }

   double est = vMin * (budget / minReq);
   if(est < vMin) est = vMin;
   if(est > vMax) est = vMax;
   string n0 = "";
   if(!NormalizeVolumeForSymbol(symbol, est, est, n0))
   {
      noteOut = "[est_norm_failed]";
      return false;
   }

   double v = est;
   double req = 0.0;
   int maxIters = (int)MathCeil((v - vMin) / vStep) + 5;
   if(maxIters < 1) maxIters = 1;
   for(int i = 0; i < maxIters; ++i)
   {
      if(OrderCalcMargin(orderType, symbol, v, price, req) && req > 0.0 && req <= budget)
      {
         volumeOut = v;
         noteOut = "[margin_pct_sized pct=" + DoubleToString(marginPct, 2)
                   + "% budget=" + DoubleToString(budget, 2)
                   + " req=" + DoubleToString(req, 2) + "]";
         return true;
      }
      v -= vStep;
      if(v < vMin - 1e-10)
         break;
      string n2 = "";
      if(!NormalizeVolumeForSymbol(symbol, v, v, n2))
         continue;
   }

   noteOut = "[margin_pct_fit_failed budget=" + DoubleToString(budget, 2)
             + " req@min=" + DoubleToString(minReq, 2) + "]";
   return false;
}

string IsoTime(datetime t)
{
   if(t <= 0) return "";
   MqlDateTime dt;
   // We use STRUCT to avoid TimeToString locale issues.
   // Note: We assume broker time or UTC depending on server expectation.
   // Usually, it's safest to send as is if server handles broker offset,
   // but Z implies UTC.
   TimeToStruct(t, dt);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ", dt.year, dt.mon, dt.day, dt.hour, dt.min, dt.sec);
}

void RemoteLog(string msg, string level = "INFO")
{
   Print(msg); // Always print locally to terminal
   if(InpDisableRemoteLog)
      return;

   string body = "{";
   body += "\"account_id\":\"" + IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN)) + "\",";
   body += "\"level\":\"" + JsonEscape(level) + "\",";
   body += "\"message\":\"" + JsonEscape(msg) + "\"";
   body += "}";

   HttpPostJson(BuildApiUrl("/mt5/ea/log-v2"), body);
}

void Ack(const string signalId, const string status, const string ticket, const string err)
{
   string openTimeIso = "";
   string closeTimeIso = "";
   ulong ptk = StringToInteger(ticket);

   if(ptk > 0)
   {
      if(PositionSelectByTicket(ptk))
         openTimeIso = IsoTime((datetime)PositionGetInteger(POSITION_TIME));
      else if(HistorySelectByPosition(ptk))
      {
         int totalDeals = HistoryDealsTotal();
         for(int i=0; i<totalDeals; i++)
         {
            ulong deal = HistoryDealGetTicket(i);
            if(HistoryDealGetInteger(deal, DEAL_ENTRY) == DEAL_ENTRY_IN)
            {
               openTimeIso = IsoTime((datetime)HistoryDealGetInteger(deal, DEAL_TIME));
               break;
            }
         }
      }
   }

   string s = status;
   StringToUpper(s);
   if(s == "CLOSED" || s == "TP" || s == "SL")
      closeTimeIso = IsoTime(TimeCurrent());

   string ackNote = "action=" + g_ackAction
                    + " symbol=" + g_ackSymbol
                    + " reqVol=" + DoubleToString(g_ackReqVolume, 4)
                    + " usedVol=" + DoubleToString(g_ackUsedVolume, 4)
                    + " reqSL=" + DoubleToString(g_ackReqSl, 8)
                    + " reqTP=" + DoubleToString(g_ackReqTp, 8)
                    + " usedSL=" + DoubleToString(g_ackUsedSl, 8)
                    + " usedTP=" + DoubleToString(g_ackUsedTp, 8)
                    + " marginReq=" + DoubleToString(g_ackMarginReq, 2)
                    + " marginBudget=" + DoubleToString(g_ackMarginBudget, 2)
                    + " freeMargin=" + DoubleToString(g_ackFreeMargin, 2)
                    + " bal=" + DoubleToString(g_ackBalance, 2)
                    + " eq=" + DoubleToString(g_ackEquity, 2);
   if(StringLen(g_ackVolumeNote) > 0) ackNote += " volNote=" + g_ackVolumeNote;
   if(StringLen(g_ackStopNote) > 0) ackNote += " stopNote=" + g_ackStopNote;
   string body = "{";
   body += "\"account_id\":\"" + IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN)) + "\",";
   body += "\"signal_id\":\"" + JsonEscape(signalId) + "\",";
   body += "\"status\":\"" + JsonEscape(status) + "\",";
   body += "\"execution_status\":\"" + JsonEscape(status) + "\",";
   body += "\"ticket\":\"" + JsonEscape(ticket) + "\",";
   body += "\"broker_trade_id\":\"" + JsonEscape(ticket) + "\",";
   body += "\"error\":\"" + JsonEscape(err) + "\",";
   body += "\"result\":\"" + JsonEscape(IntegerToString(g_ackRetcode)) + "\",";
   body += "\"message\":\"" + JsonEscape(g_ackRetmsg) + "\",";
   body += "\"note\":\"" + JsonEscape(ackNote) + "\",";
   body += "\"action\":\"" + JsonEscape(g_ackAction) + "\",";
   body += "\"symbol\":\"" + JsonEscape(g_ackSymbol) + "\",";
   body += "\"opened_at\":\"" + openTimeIso + "\",";
   body += "\"closed_at\":\"" + closeTimeIso + "\",";
   body += "\"requested_volume\":" + DoubleToString(g_ackReqVolume, 4) + ",";
   body += "\"used_volume\":" + DoubleToString(g_ackUsedVolume, 4) + ",";
   body += "\"requested_sl\":" + DoubleToString(g_ackReqSl, 8) + ",";
   body += "\"requested_tp\":" + DoubleToString(g_ackReqTp, 8) + ",";
   body += "\"used_sl\":" + DoubleToString(g_ackUsedSl, 8) + ",";
   body += "\"used_tp\":" + DoubleToString(g_ackUsedTp, 8) + ",";
   body += "\"entry_price_exec\":" + DoubleToString(g_ackEntryExec, 8) + ",";
   body += "\"margin_req\":" + DoubleToString(g_ackMarginReq, 2) + ",";
   body += "\"margin_budget\":" + DoubleToString(g_ackMarginBudget, 2) + ",";
   body += "\"free_margin\":" + DoubleToString(g_ackFreeMargin, 2) + ",";
   body += "\"balance\":" + DoubleToString(g_ackBalance, 2) + ",";
   body += "\"equity\":" + DoubleToString(g_ackEquity, 2) + ",";
   body += "\"pip_value_per_lot\":" + DoubleToString(g_ackPipValuePerLot, 4) + ",";
   body += "\"sl_pips\":" + DoubleToString(g_ackSlPips, 2) + ",";
   body += "\"tp_pips\":" + DoubleToString(g_ackTpPips, 2) + ",";
   body += "\"risk_money_actual\":" + DoubleToString(g_ackRiskMoneyActual, 2) + ",";
   body += "\"reward_money_planned\":" + DoubleToString(g_ackRewardMoneyPlanned, 4) + ",";
   if(g_ackHasPnlRealized)
      body += "\"pnl_money_realized\":" + DoubleToString(g_ackPnlRealized, 2) + ",";
   else
      body += "\"pnl_money_realized\":null,";
   body += "\"signal_ts\":" + IntegerToString((int)g_ackSignalTs) + ",";
   body += "\"exec_ts\":" + IntegerToString((int)g_ackExecTs);
   body += "}";

   int n = ArraySize(g_ackQSignalId);
   ArrayResize(g_ackQSignalId, n + 1);
   ArrayResize(g_ackQStatus, n+1);
   ArrayResize(g_ackQTicket, n+1);
   ArrayResize(g_ackQError, n+1);
   ArrayResize(g_ackQBody, n+1);
   ArrayResize(g_ackQRetryCount, n+1);

   g_ackQSignalId[n] = signalId;
   g_ackQStatus[n] = status;
   g_ackQTicket[n] = ticket;
   g_ackQError[n] = err;
   g_ackQBody[n] = body;
   g_ackQRetryCount[n] = 0;

   Print("Queued Ack status=", status, " id=", signalId, " ticket=", ticket);
}

void ProcessAckQueue()
{
   int n = ArraySize(g_ackQSignalId);
   if(n == 0) return;

   int w = 0;
   for(int i=0; i<n; i++)
   {
      string signalId = g_ackQSignalId[i];
      string tradeId = "";
      string leaseToken = "";

      // Try to find V2 context for this signal
      for(int j=0; j<ArraySize(g_tradeIdMapSignalId); j++) {
         if(g_tradeIdMapSignalId[j] == signalId) {
            tradeId = g_tradeIdMapValue[j];
            break;
         }
      }
      for(int j=0; j<ArraySize(g_leaseTokenMapSignalId); j++) {
         if(g_leaseTokenMapSignalId[j] == signalId) {
            leaseToken = g_leaseTokenMapValue[j];
            break;
         }
      }

      string url = BuildApiUrl("/v2/broker/ack");

      string body = g_ackQBody[i];
      // For v2 ack, trade_id + lease_token are required.
      if(tradeId != "" && StringFind(body, "\"trade_id\"") < 0) {
         body = StringSubstr(body, 0, StringLen(body)-1) + ",\"trade_id\":\"" + JsonEscape(tradeId) + "\"}";
      }
      if(leaseToken != "" && StringFind(body, "\"lease_token\"") < 0) {
         body = StringSubstr(body, 0, StringLen(body)-1) + ",\"lease_token\":\"" + JsonEscape(leaseToken) + "\"}";
      }

      // If missing v2 context, fallback to legacy endpoint instead of blocking the queue
      if(tradeId == "" || leaseToken == "") {
         url = BuildApiUrl("/mt5/ea/ack");
      }

      if(HttpPostJson(url, body))
      {
         RemoteLog("Reliable Ack SENT OK: status=" + g_ackQStatus[i] + " id=" + signalId + " url=" + url);
         continue;
      }

      g_ackQRetryCount[i]++;
      if(g_ackQRetryCount[i] < 100) // Keep trying
      {
         if(w != i)
         {
            g_ackQSignalId[w] = g_ackQSignalId[i];
            g_ackQStatus[w] = g_ackQStatus[i];
            g_ackQTicket[w] = g_ackQTicket[i];
            g_ackQError[w] = g_ackQError[i];
            g_ackQBody[w] = g_ackQBody[i];
            g_ackQRetryCount[w] = g_ackQRetryCount[i];
         }
         w++;
      }
      else {
         RemoteLog("Reliable Ack GAVE UP: status=" + g_ackQStatus[i] + " id=" + g_ackQSignalId[i], "ERROR");
      }
   }
   ArrayResize(g_ackQSignalId, w);
   ArrayResize(g_ackQStatus, w);
   ArrayResize(g_ackQTicket, w);
   ArrayResize(g_ackQError, w);
   ArrayResize(g_ackQBody, w);
   ArrayResize(g_ackQRetryCount, w);
}

void CloseBySymbol(const string symbol)
{
   for(int i = PositionsTotal() - 1; i >= 0; --i)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      string ps = PositionGetString(POSITION_SYMBOL);
      if(ps != symbol) continue;
      trade.PositionClose(ticket);
   }
}

void NormalizeStopsForMarket(const string action,
                             const string symbol,
                             double &sl,
                             double &tp,
                             string &adjustNote)
{
   adjustNote = "";
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if(point <= 0.0)
      point = 0.00001;

   double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
   if(bid <= 0.0 || ask <= 0.0)
   {
      MqlTick tick;
      if(SymbolInfoTick(symbol, tick))
      {
         bid = tick.bid;
         ask = tick.ask;
      }
   }
   if(bid <= 0.0 || ask <= 0.0)
      return;

   int stopsLevelPts = (int)SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   int freezeLevelPts = (int)SymbolInfoInteger(symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   int baseMinPts = MathMax(MathMax(0, stopsLevelPts), MathMax(0, freezeLevelPts));
   int extraPts = MathMax(0, InpStopBufferPts);
   double minDist = (baseMinPts + extraPts) * point;

   if(action == "BUY")
   {
      // BUY: SL must be below bid by at least min distance, TP above ask by at least min distance.
      if(sl > 0.0 && sl >= (bid - minDist))
      {
         sl = bid - minDist;
         adjustNote += "[SL adjusted]";
      }
      if(tp > 0.0 && tp <= (ask + minDist))
      {
         tp = ask + minDist;
         adjustNote += "[TP adjusted]";
      }
   }
   else if(action == "SELL")
   {
      // SELL: SL must be above ask by at least min distance, TP below bid by at least min distance.
      if(sl > 0.0 && sl <= (ask + minDist))
      {
         sl = ask + minDist;
         adjustNote += "[SL adjusted]";
      }
      if(tp > 0.0 && tp >= (bid - minDist))
      {
         tp = bid - minDist;
         adjustNote += "[TP adjusted]";
      }
   }

   if(sl > 0.0)
      sl = NormalizeDouble(sl, digits);
   if(tp > 0.0)
      tp = NormalizeDouble(tp, digits);
}

bool ApplyStopsAfterOpen(const ulong posTicket,
                         const string action,
                         const string symbol,
                         const double slIn,
                         const double tpIn,
                         string &infoOut)
{
   infoOut = "";
   if(slIn <= 0.0 && tpIn <= 0.0)
   {
      infoOut = "no stops requested";
      return true;
   }

   double sl = slIn;
   double tp = tpIn;
   string adjustNote = "";
   NormalizeStopsForMarket(action, symbol, sl, tp, adjustNote);
   if(sl <= 0.0 && tp <= 0.0)
   {
      infoOut = "stops skipped after normalize";
      return false;
   }

   // Position can appear with a tiny delay in tester/live; retry briefly.
   bool found = false;
   ulong ticketUse = posTicket;
   for(int i = 0; i < 10; ++i)
   {
      if(ticketUse > 0 && PositionSelectByTicket(ticketUse))
      {
         found = true;
         break;
      }
      if(PositionSelect(symbol))
      {
         found = true;
         break;
      }
      if(ticketUse == 0)
         FindLatestPositionTicket(symbol, InpMagic, ticketUse);
      Sleep(100);
   }
   if(!found)
   {
      infoOut = "position not found for modify";
      return false;
   }

   bool ok = false;
   if(ticketUse > 0)
      ok = trade.PositionModify(ticketUse, sl > 0.0 ? sl : 0.0, tp > 0.0 ? tp : 0.0);
   else
      ok = trade.PositionModify(symbol, sl > 0.0 ? sl : 0.0, tp > 0.0 ? tp : 0.0);
   if(!ok)
   {
      infoOut = "PositionModify retcode=" + IntegerToString((int)trade.ResultRetcode()) + " msg=" + trade.ResultRetcodeDescription();
      return false;
   }

   infoOut = "stops set" + (StringLen(adjustNote) > 0 ? (" " + adjustNote) : "");
   return true;
}

bool ExecuteSignal(const string signalId,
                   const string actionRaw,
                   const string symbolRaw,
                   const string comment,
                   const double volume,
                   const double riskPct,
                   const double riskMoney,
                   const double entry,
                   const string orderTypeRaw,
                   const double sl,
                   const double tp,
                   const datetime signalTs,
                   string &ticketOut,
                   string &errOut)
{
   ticketOut = "";
   errOut = "";
   g_dbgLastSignalId = signalId;
   g_dbgLastSymbol = symbolRaw;
   g_dbgLastError = "";
   g_dbgLastTime = TimeCurrent();
   g_ackAction = actionRaw;
   g_ackSymbol = symbolRaw;
   g_ackVolumeNote = "";
   g_ackStopNote = "";
   g_ackReqVolume = volume;
   g_ackUsedVolume = volume;
   g_ackReqSl = sl;
   g_ackReqTp = tp;
   g_ackUsedSl = sl;
   g_ackUsedTp = tp;
   g_ackEntryExec = 0.0;
   g_ackMarginReq = 0.0;
   g_ackFreeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   g_ackBalance = AccountInfoDouble(ACCOUNT_BALANCE);
   g_ackMarginBudget = 0.0;
   if(InpMarginPercentOfBalance > 0.0 && g_ackBalance > 0.0)
      g_ackMarginBudget = g_ackBalance * (InpMarginPercentOfBalance / 100.0);
   g_ackEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   g_ackPnlRealized = 0.0;
   g_ackHasPnlRealized = false;
   g_ackSignalTs = signalTs;
   g_ackExecTs = TimeCurrent();
   g_ackRetcode = 0;
   g_ackRetmsg = "";

   // --- INITIAL TELEMETRY CALCULATION (DO THIS FIRST SO WE HAVE DATA EVEN ON ERRORS) ---
   g_ackPipValuePerLot = 0;
   g_ackSlPips = 0;
   g_ackTpPips = 0;
   g_ackRiskMoneyActual = 0;
   g_ackRewardMoneyPlanned = 0;

   double entryRef = (entry > 0.0) ? entry : ((actionRaw=="BUY") ? SymbolInfoDouble(symbolRaw, SYMBOL_ASK) : SymbolInfoDouble(symbolRaw, SYMBOL_BID));
   if(entryRef <= 0.0) entryRef = 1.0; // fallback if no prices

   double pps = SymbolInfoDouble(symbolRaw, SYMBOL_POINT);
   double pV = 0;
   if(pps > 0.0)
   {
      double profitOnePip = 0;
      if(OrderCalcProfit(actionRaw=="BUY"?ORDER_TYPE_BUY:ORDER_TYPE_SELL, symbolRaw, 1.0, entryRef, entryRef + pps, profitOnePip))
         pV = MathAbs(profitOnePip);
   }
   g_ackPipValuePerLot = pV;

   if(pps > 0.0)
   {
      double slDist = (sl > 0.0) ? MathAbs(entryRef - sl) : 0.0;
      double tpDist = (tp > 0.0) ? MathAbs(tp - entryRef) : 0.0;
      g_ackSlPips = slDist / pps;
      g_ackTpPips = tpDist / pps;
   }
   g_ackRiskMoneyActual = volume * g_ackPipValuePerLot * g_ackSlPips;
   g_ackRewardMoneyPlanned = volume * g_ackPipValuePerLot * g_ackTpPips;
   // -----------------------------------------------------------------------------------

   string action = actionRaw;
   StringToUpper(action);
   string orderType = NormalizeOrderType(orderTypeRaw);
   g_dbgLastAction = action;
   g_ackAction = action;

   if(StringLen(signalId) == 0 || StringLen(action) == 0)
   {
      errOut = "Missing signal_id/action";
      g_dbgLastStatus = "INVALID";
      g_dbgLastError = errOut;
      RefreshDebugPanel();
      return false;
   }

   if(IsDuplicateSignal(signalId))
   {
      errOut = "Duplicate signal_id ignored: " + signalId;
      Print(errOut);
      g_dbgLastStatus = "DUPLICATE_IGNORED";
      g_dbgLastError = errOut;
      RefreshDebugPanel();
      return false;
   }

   if(IsExpiredSignal(signalTs))
   {
      datetime nowUtc = TimeGMT();
      long ageSec = (long)(nowUtc - signalTs);
      errOut = "Expired signal ignored: " + signalId +
               " ageSec=" + IntegerToString((int)ageSec) +
               " maxAgeSec=" + IntegerToString(InpMaxSignalAgeSeconds) +
               " nowUtc=" + TimeToString(nowUtc, TIME_DATE | TIME_SECONDS) +
               " signalTs=" + TimeToString(signalTs, TIME_DATE | TIME_SECONDS);
      Print(errOut);
      RememberSignal(signalId);
      g_dbgLastStatus = "EXPIRED_IGNORED";
      g_dbgLastError = errOut;
      RefreshDebugPanel();
      return false;
   }

   string symbol = "";
   bool symbolOk = ResolveSymbol(symbolRaw, symbol);
   if(!symbolOk)
   {
      if(InpStrictSymbolResolve)
      {
         errOut = "Symbol not found, ignored: " + symbolRaw;
         Print(errOut);
         RememberSignal(signalId);
         g_dbgLastStatus = "SYMBOL_IGNORED";
         g_dbgLastError = errOut;
         RefreshDebugPanel();
         return false;
      }
      symbol = _Symbol;
      Print("Symbol not found, fallback to chart symbol: ", symbolRaw, " -> ", symbol);
   }
   g_dbgLastSymbol = symbol;
   g_ackSymbol = symbol;

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpDeviationPts);

   double slUse = sl;
   double tpUse = tp;
   string stopAdjustNote = "";
   NormalizeStopsForMarket(action, symbol, slUse, tpUse, stopAdjustNote);
   if(StringLen(stopAdjustNote) > 0)
   {
      Print("Stops adjusted for ", signalId, " ", symbol, " ", action, " ", stopAdjustNote,
            " (input sl=", DoubleToString(sl, 8), ", tp=", DoubleToString(tp, 8),
            " => used sl=", DoubleToString(slUse, 8), ", tp=", DoubleToString(tpUse, 8), ")");
   }
   g_ackStopNote = stopAdjustNote;
   g_ackUsedSl = slUse;
   g_ackUsedTp = tpUse;

   bool ok = false;
   double volumeUse = volume;
   string volumeNote = "";
   if(action == "BUY" || action == "SELL")
   {
      if(InpUseMarginPercentSizing)
      {
         double marginPctVol = 0.0;
         string marginPctNote = "";
         if(ComputeMarginPercentVolume(action, symbol, InpMarginPercentOfBalance, marginPctVol, marginPctNote))
         {
            volumeUse = marginPctVol;
            volumeNote = marginPctNote;
         }
         else if(InpUseRiskPercentSizing)
         {
            double riskVol = 0.0;
            string riskNote = "";
            if(ComputeRiskBasedVolume(action, symbol, entry, slUse, riskPct, riskMoney, riskVol, riskNote))
            {
               volumeUse = riskVol;
               volumeNote = "[margin_pct_fallback_risk] " + marginPctNote + " " + riskNote;
            }
            else
            {
               volumeUse = InpFallbackFixedLot;
               volumeNote = "[margin_pct_fallback_fixed] " + marginPctNote + " " + riskNote;
            }
         }
         else
         {
            volumeUse = InpFallbackFixedLot;
            volumeNote = "[margin_pct_fallback_fixed] " + marginPctNote;
         }
      }
      else if(InpUseRiskPercentSizing)
      {
         double riskVol = 0.0;
         string riskNote = "";
         if(ComputeRiskBasedVolume(action, symbol, entry, slUse, riskPct, riskMoney, riskVol, riskNote))
         {
            volumeUse = riskVol;
            volumeNote = riskNote;
         }
         else
         {
            if(StringFind(riskNote, "[rejected]") >= 0)
            {
               errOut = "rejected " + riskNote;
               g_dbgLastStatus = "REJECTED";
               g_dbgLastError = errOut;
               RefreshDebugPanel();
               return false;
            }
            volumeUse = InpFallbackFixedLot;
            volumeNote = "[risk_fallback_fixed_lot] " + riskNote;
         }
      }
   }
   string normNote = "";
   if(!NormalizeVolumeForSymbol(symbol, volumeUse, volumeUse, normNote, true))
   {
      if(StringFind(normNote, "[rejected]") >= 0)
      {
         errOut = "rejected " + normNote;
         g_dbgLastStatus = "REJECTED";
         g_dbgLastError = errOut;
         RefreshDebugPanel();
         return false;
      }
      errOut = "Invalid volume for symbol: " + symbol + " input=" + DoubleToString(volumeUse, 4) + " note=" + normNote;
      g_dbgLastStatus = "INVALID_VOLUME";
      g_dbgLastError = errOut;
      RefreshDebugPanel();
      return false;
   }
   if(StringLen(normNote) > 0)
   {
      if(StringLen(volumeNote) > 0) volumeNote += " ";
      volumeNote += normNote;
   }
   g_ackVolumeNote = volumeNote;
   if(volumeUse != volume || StringLen(volumeNote) > 0)
   {
      Print("Volume adjusted for ", signalId, " ", symbol,
            " input=", DoubleToString(volume, 4),
            " -> used=", DoubleToString(volumeUse, 4),
            " ", volumeNote);
   }
   if(action == "BUY" || action == "SELL")
   {
      double marginVolume = volumeUse;
      string marginNote = "";
      if(!FitVolumeToFreeMargin(action, symbol, volumeUse, marginVolume, marginNote))
      {
         string precheckNote = "[margin_precheck_fail] " + marginNote;
         if(InpHardFailOnMarginPrecheck)
         {
            errOut = "retcode=10019 msg=not enough money " + marginNote;
            g_dbgLastStatus = "NO_MONEY_PRECHECK";
            g_dbgLastError = errOut;
            RefreshDebugPanel();
            return false;
         }

         double tryMinVol = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
         if(tryMinVol <= 0.0) tryMinVol = 0.01;
         string minNormNote = "";
         if(!NormalizeVolumeForSymbol(symbol, tryMinVol, tryMinVol, minNormNote))
         {
            errOut = "retcode=10019 msg=not enough money " + marginNote + " [min_lot_norm_failed]";
            g_dbgLastStatus = "NO_MONEY_PRECHECK";
            g_dbgLastError = errOut;
            RefreshDebugPanel();
            return false;
         }

         Print("Margin precheck failed for ", signalId, " ", symbol,
               " -> still trying broker once with min lot ",
               DoubleToString(tryMinVol, 4), " ", precheckNote);
         volumeUse = tryMinVol;
         if(StringLen(volumeNote) > 0) volumeNote += " ";
         volumeNote += precheckNote;
         if(StringLen(minNormNote) > 0) volumeNote += " " + minNormNote;
      }
      else if(marginVolume != volumeUse || StringLen(marginNote) > 0)
      {
         Print("Margin-fit volume for ", signalId, " ", symbol,
               " used=", DoubleToString(volumeUse, 4),
               " -> fit=", DoubleToString(marginVolume, 4), " ", marginNote);
         volumeUse = marginVolume;
         if(StringLen(marginNote) > 0)
         {
            if(StringLen(volumeNote) > 0) volumeNote += " ";
            volumeNote += marginNote;
         }
      }
   }
   g_ackVolumeNote = volumeNote;
   g_ackUsedVolume = volumeUse;
   if(action == "BUY" || action == "SELL")
   {
      MqlTick t;
      if(SymbolInfoTick(symbol, t))
      {
         double px = (action == "BUY" ? t.ask : t.bid);
         double mr = 0.0;
         if(OrderCalcMargin((action == "BUY" ? ORDER_TYPE_BUY : ORDER_TYPE_SELL), symbol, volumeUse, px, mr))
            g_ackMarginReq = mr;
      }
   }

   // Telemetry already populated at top of function.
   bool usedMarketExecution = false;
   string tradeComment = signalId;
   if(StringLen(tradeComment) > 31)
      tradeComment = StringSubstr(tradeComment, StringLen(tradeComment) - 31);

   if(action == "BUY" || action == "SELL")
   {
      bool useMarket = (orderType == "market");
      MqlTick t;
      if(!SymbolInfoTick(symbol, t))
      {
         errOut = "tick_unavailable_for_execution";
         g_dbgLastStatus = "EXEC_TICK_MISSING";
         g_dbgLastError = errOut;
         RefreshDebugPanel();
         return false;
      }

      double ask = t.ask;
      double bid = t.bid;
      int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
      if(digits < 0) digits = 5;
      double entryUse = entry;
      if(entryUse > 0.0)
         entryUse = NormalizeDouble(entryUse, digits);
      if(entryUse <= 0.0 && orderType != "market")
      {
         useMarket = true;
         if(StringLen(volumeNote) > 0) volumeNote += " ";
         volumeNote += "[pending_missing_entry->market]";
      }

      if(useMarket)
      {
         usedMarketExecution = true;
         if(action == "BUY")
            ok = trade.Buy(volumeUse, symbol, 0.0, 0.0, 0.0, tradeComment);
         else
            ok = trade.Sell(volumeUse, symbol, 0.0, 0.0, 0.0, tradeComment);
      }
      else
      {
         string pendingKind = ResolvePendingKind(action, orderType, entryUse, ask, bid);
         if(orderType != pendingKind)
            Print("Order type adjusted id=", signalId, " action=", action, " requested=", orderType, " resolved=", pendingKind);
         if(pendingKind == "limit")
         {
            if(action == "BUY")
               ok = trade.BuyLimit(volumeUse, entryUse, symbol, slUse > 0.0 ? slUse : 0.0, tpUse > 0.0 ? tpUse : 0.0, ORDER_TIME_GTC, 0, tradeComment);
            else
               ok = trade.SellLimit(volumeUse, entryUse, symbol, slUse > 0.0 ? slUse : 0.0, tpUse > 0.0 ? tpUse : 0.0, ORDER_TIME_GTC, 0, tradeComment);
         }
         else
         {
            if(action == "BUY")
               ok = trade.BuyStop(volumeUse, entryUse, symbol, slUse > 0.0 ? slUse : 0.0, tpUse > 0.0 ? tpUse : 0.0, ORDER_TIME_GTC, 0, tradeComment);
            else
               ok = trade.SellStop(volumeUse, entryUse, symbol, slUse > 0.0 ? slUse : 0.0, tpUse > 0.0 ? tpUse : 0.0, ORDER_TIME_GTC, 0, tradeComment);
         }
         if(StringLen(volumeNote) > 0) volumeNote += " ";
         volumeNote += "[exec=" + pendingKind + "]";
      }
      g_ackVolumeNote = volumeNote;
   }
   else if(action == "CLOSE")
   {
      CloseBySymbol(symbol);
      ok = true;
   }
   else
   {
      errOut = "Unsupported action: " + action;
      RememberSignal(signalId);
      g_dbgLastStatus = "UNSUPPORTED_ACTION";
      g_dbgLastError = errOut;
      RefreshDebugPanel();
      return false;
   }

   if(!ok)
   {
      uint rc = trade.ResultRetcode();
      g_ackRetcode = (int)rc;
      g_ackRetmsg = trade.ResultRetcodeDescription();
      // Broker rejected stops (10016). Retry market order without SL/TP.
      if((action == "BUY" || action == "SELL") && usedMarketExecution && rc == TRADE_RETCODE_INVALID_STOPS)
      {
         Print("Invalid stops for ", signalId, " -> retry without SL/TP");
         if(action == "BUY")
            ok = trade.Buy(volumeUse, symbol, 0.0, 0.0, 0.0, tradeComment);
         else
            ok = trade.Sell(volumeUse, symbol, 0.0, 0.0, 0.0, tradeComment);
      }
      // Broker rejected for insufficient margin (10019). Retry with lower affordable volume.
      if((action == "BUY" || action == "SELL") && usedMarketExecution && !ok && rc == TRADE_RETCODE_NO_MONEY)
      {
         double reducedVol = volumeUse;
         string marginRetryNote = "";
         if(FitVolumeToFreeMargin(action, symbol, volumeUse - SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP), reducedVol, marginRetryNote)
            && reducedVol > 0.0 && reducedVol < volumeUse)
         {
            Print("NO_MONEY retry with reduced volume for ", signalId, " ", symbol,
                  " ", DoubleToString(volumeUse, 4), " -> ", DoubleToString(reducedVol, 4),
                  " ", marginRetryNote);
            if(action == "BUY")
               ok = trade.Buy(reducedVol, symbol, 0.0, 0.0, 0.0, tradeComment);
            else
               ok = trade.Sell(reducedVol, symbol, 0.0, 0.0, 0.0, tradeComment);
            if(ok)
               volumeUse = reducedVol;
         }
      }

      if(!ok)
      {
         g_ackRetcode = (int)trade.ResultRetcode();
         g_ackRetmsg = trade.ResultRetcodeDescription();
         errOut = "retcode=" + IntegerToString((int)trade.ResultRetcode()) + " msg=" + trade.ResultRetcodeDescription();
         g_dbgLastStatus = "ORDER_FAILED";
         g_dbgLastError = errOut;
         RefreshDebugPanel();
         return false;
      }
   }

   if(action == "BUY" || action == "SELL")
   {
      if(usedMarketExecution)
      {
         ulong posTicket = 0;
         FindLatestPositionTicket(symbol, InpMagic, posTicket);
         string stopInfo = "";
         bool stopOk = ApplyStopsAfterOpen(posTicket, action, symbol, slUse, tpUse, stopInfo);
         if(!stopOk)
         {
            Print("Post-open stops skipped/failed for ", signalId, " ", symbol, " ", action, ": ", stopInfo);
            if(StringLen(g_dbgLastError) == 0)
               g_dbgLastError = stopInfo;
            EnqueueStopRetry(signalId, posTicket, action, symbol, slUse, tpUse);
         }
         else if(StringLen(stopInfo) > 0)
         {
            Print("Post-open stops for ", signalId, ": ", stopInfo);
         }

         if(posTicket == 0)
         {
            ulong fromOrder = (ulong)trade.ResultOrder();
            if(fromOrder > 0)
               posTicket = fromOrder;
            if(posTicket == 0)
               FindLatestPositionTicket(symbol, InpMagic, posTicket);
         }
         if(posTicket > 0)
            MapPositionSignal(posTicket, signalId);
         RegisterVirtualGuard(signalId, posTicket, action, symbol, slUse, tpUse);
      }
      else
      {
         ulong orderTicket = (ulong)trade.ResultOrder();
         if(orderTicket > 0)
         {
            MapOrderSignal(orderTicket, signalId);
            Print("Pending order placed id=", signalId,
                  " orderTicket=", IntegerToString((long)orderTicket),
                  " symbol=", symbol,
                  " action=", action,
                  " volume=", DoubleToString(volumeUse, 4));
         }
      }
   }

   ticketOut = IntegerToString((int)trade.ResultOrder());
   g_ackRetcode = (int)trade.ResultRetcode();
   g_ackRetmsg = trade.ResultRetcodeDescription();
   g_ackExecTs = TimeCurrent();
   if(action == "BUY" || action == "SELL")
   {
      ulong ptk = 0;
      FindLatestPositionTicket(symbol, InpMagic, ptk);
      if(ptk > 0 && PositionSelectByTicket(ptk))
         g_ackEntryExec = PositionGetDouble(POSITION_PRICE_OPEN);
   }
   RememberSignal(signalId);
    g_dbgLastStatus = "EXECUTED_OK";
    g_dbgLastError = "";
    RefreshDebugPanel();
   return true;
}

bool LoadBacktestSignals()
{
   ArrayResize(g_btTime, 0);
   ArrayResize(g_btSignalId, 0);
   ArrayResize(g_btAction, 0);
   ArrayResize(g_btSymbol, 0);
   ArrayResize(g_btNote, 0);
   ArrayResize(g_btVolume, 0);
   ArrayResize(g_btSl, 0);
   ArrayResize(g_btTp, 0);
   g_btCursor = 0;

   int h = FileOpen(InpBacktestFileCommon, FILE_READ | FILE_CSV | FILE_COMMON | FILE_ANSI, ';');
   if(h == INVALID_HANDLE)
   {
      Print("Backtest file open failed: ", InpBacktestFileCommon, " err=", GetLastError());
      return false;
   }

   if(InpBacktestHasHeader)
   {
      for(int i = 0; i < 8 && !FileIsEnding(h); ++i)
         FileReadString(h);
   }

   while(!FileIsEnding(h))
   {
      string tsRaw = FileReadString(h);
      if(FileIsEnding(h) && StringLen(tsRaw) == 0)
         break;
      string signalId = FileReadString(h);
      string action = FileReadString(h);
      string symbol = FileReadString(h);
      string volumeRaw = FileReadString(h);
      string slRaw = FileReadString(h);
      string tpRaw = FileReadString(h);
      string note = FileReadString(h);

      datetime ts = ParseSignalTime(tsRaw);
      if(ts <= 0 || StringLen(signalId) == 0 || StringLen(action) == 0)
         continue;

      int n = ArraySize(g_btTime);
      ArrayResize(g_btTime, n + 1);
      ArrayResize(g_btSignalId, n + 1);
      ArrayResize(g_btAction, n + 1);
      ArrayResize(g_btSymbol, n + 1);
      ArrayResize(g_btNote, n + 1);
      ArrayResize(g_btVolume, n + 1);
      ArrayResize(g_btSl, n + 1);
      ArrayResize(g_btTp, n + 1);

      g_btTime[n] = ts;
      g_btSignalId[n] = signalId;
      g_btAction[n] = action;
      g_btSymbol[n] = symbol;
      g_btNote[n] = note;
      g_btVolume[n] = StringToDouble(volumeRaw);
      g_btSl[n] = StringToDouble(slRaw);
      g_btTp[n] = StringToDouble(tpRaw);
   }

   FileClose(h);
   Print("Backtest signals loaded: ", ArraySize(g_btTime), " from Common/Files/", InpBacktestFileCommon);
   return ArraySize(g_btTime) > 0;
}

void ProcessBacktestQueue()
{
   if(!g_btLoaded)
   {
      g_dbgLastStatus = "BT_NOT_LOADED";
      RefreshDebugPanel();
      return;
   }

   datetime nowTs = TimeCurrent();
   while(g_btCursor < ArraySize(g_btTime) && g_btTime[g_btCursor] <= nowTs)
   {
      string ticket;
      string err;
      bool ok = ExecuteSignal(g_btSignalId[g_btCursor],
                              g_btAction[g_btCursor],
                              g_btSymbol[g_btCursor],
                              g_btNote[g_btCursor],
                              g_btVolume[g_btCursor],
                              g_btVolume[g_btCursor], // riskPct
                              0.0,                    // riskMoney
                              0.0,
                              "market",
                              g_btSl[g_btCursor],
                              g_btTp[g_btCursor],
                              g_btTime[g_btCursor],
                              ticket,
                              err);
      if(!ok)
         Print("Backtest signal failed id=", g_btSignalId[g_btCursor], " err=", err);
      ++g_btCursor;
   }
   RefreshDebugPanel();
}

void OnTimer()
{
   if(InpBacktestMode)
      return;

   ProcessAckQueue();
   ProcessStopRetryQueue();
   ProcessVirtualGuards();

   datetime now = TimeCurrent();

   // Periodic state reconciliation (PUSH ACTIVE) - every 60s
   if(now - g_syncLastTime >= 60)
   {
      SyncWithVps();
      g_syncLastTime = now;
   }

   // Periodic History Sync (PUSH CLOSED) - every 5 minutes
   if(now - g_syncHistoryLastTime >= 300)
   {
      SyncClosedHistory();
      g_syncHistoryLastTime = now;
   }

   string url = BuildApiUrl("/mt5/ea/pull?account=" + IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN)));
   string resp;
   if(!HttpGet(url, resp))
   {
      g_lastPullCode = g_lastHttpCode;
      g_lastPullSummary = "FAIL " + g_lastHttpMethod + " " + SanitizeOneLine(g_lastHttpUrl, 64) + " | " + g_lastHttpError;
      g_lastPullPayload = g_lastPullSummary;
      g_lastPullUpdate = TimeCurrent();
      RefreshDebugPanel();
      return;
   }

   g_lastPullCode = g_lastHttpCode;
   g_lastPullPayload = SanitizeOneLine(resp, 220);
   g_lastPullUpdate = TimeCurrent();

   if(StringFind(resp, "\"items\":[]") >= 0 || StringFind(resp, "\"items\":null") >= 0)
   {
      g_lastPullSummary = "OK no queued trades";
      RefreshDebugPanel();
      return;
   }

    // Handle Unified Task Object
    string taskType = JsonGetString(resp, "type");
    if(taskType == "") taskType = "OPEN"; // Fallback for old signals

    string leaseToken = JsonGetString(resp, "lease_token");
    string tradeId = JsonGetString(resp, "trade_id");
    string signalId = JsonGetString(resp, "signal_id");
    if(signalId == "") signalId = tradeId;
    if(signalId == "") signalId = JsonGetString(resp, "task_id");

    // Track V2 context
    if(signalId != "" && leaseToken != "") {
       int nL = ArraySize(g_leaseTokenMapSignalId);
       ArrayResize(g_leaseTokenMapSignalId, nL+1);
       ArrayResize(g_leaseTokenMapValue, nL+1);
       g_leaseTokenMapSignalId[nL] = signalId;
       g_leaseTokenMapValue[nL] = leaseToken;
    }

    string action   = JsonGetString(resp, "action");
    string symbolIn = JsonGetString(resp, "symbol");
    string comment  = JsonGetString(resp, "note");
    ulong  ticketNum = (ulong)JsonGetNumber(resp, "ticket", 0);
    double volume   = JsonGetNumber(resp, "volume", 0.0);
    double riskPct  = JsonGetNumber(resp, "risk_pct", 0.0);
    if(riskPct <= 0.0) riskPct = volume;
    double riskMoney = JsonGetNumber(resp, "risk_money", 0.0);
    double entry    = JsonGetNumber(resp, "entry", 0.0);
    double sl       = JsonGetNumber(resp, "sl", 0.0);
    double tp       = JsonGetNumber(resp, "tp", 0.0);
    string orderType = JsonGetString(resp, "order_type");
    if(orderType == "") orderType = "market";
    
    string rawJson = JsonGetString(resp, "raw_json");
    if(rawJson != "") ParsePartialTps(signalId, rawJson);

    g_lastPullSummary = "TASK=" + taskType + " ID=" + signalId + " " + action + " " + symbolIn;

    bool ok = false;
    string err = "";
    string outTicket = "";

    if(taskType == "OPEN") {
       ok = ExecuteSignal(signalId, action, symbolIn, comment, volume, riskPct, riskMoney, entry, orderType, sl, tp, 0, outTicket, err);
       if(ok) {
          string initialStatus = (orderType == "market") ? "START" : "PLACED";
          Ack(signalId, initialStatus, outTicket, "exec_ok_" + orderType);
       } else {
          Ack(signalId, (StringFind(err, "Expired") == 0) ? "EXPIRED" : "FAIL", "", err);
       }
    }
    else if(taskType == "MODIFY") {
       if(ticketNum > 0) {
          ok = trade.PositionModify(ticketNum, sl, tp);
          if(ok) Ack(signalId, "OPEN", IntegerToString((int)ticketNum), "modify_ok");
          else Ack(signalId, "ERROR", IntegerToString((int)ticketNum), "modify_fail");
       }
    }
    else if(taskType == "CLOSE") {
       if(ticketNum > 0) {
          ok = trade.PositionClose(ticketNum);
          if(ok) Ack(signalId, "CLOSED", IntegerToString((int)ticketNum), "close_ok");
          else Ack(signalId, "ERROR", IntegerToString((int)ticketNum), "close_fail");
       }
    }
    else if(taskType == "CANCEL") {
       if(ticketNum > 0) {
          ok = trade.OrderDelete(ticketNum);
          if(ok) Ack(signalId, "CANCELLED", IntegerToString((int)ticketNum), "cancel_ok");
          else Ack(signalId, "ERROR", IntegerToString((int)ticketNum), "cancel_fail");
       }
    }

    RefreshDebugPanel();
}

void SyncClosedHistory()
{
   // Increased window to 7 days for more robust auditing
   if(!HistorySelect(TimeCurrent() - 86400 * 7, TimeCurrent()))
      return;

   int total = HistoryDealsTotal();
   string updates = "";
   int count = 0;

   for(int i = total - 1; i >= 0; i--)
   {
      ulong ticket = HistoryDealGetTicket(i);
      long entryType = HistoryDealGetInteger(ticket, DEAL_ENTRY);

      // Include DEAL_ENTRY_OUT_BY for hedging accounts or close-by operations
      if(entryType != DEAL_ENTRY_OUT && entryType != DEAL_ENTRY_OUT_BY)
         continue;

      long posId = HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
      long orderId = HistoryDealGetInteger(ticket, DEAL_ORDER);
      double pnl = HistoryDealGetDouble(ticket, DEAL_PROFIT) + HistoryDealGetDouble(ticket, DEAL_COMMISSION) + HistoryDealGetDouble(ticket, DEAL_SWAP);
      datetime time = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      string sym = HistoryDealGetString(ticket, DEAL_SYMBOL);
      double vol = HistoryDealGetDouble(ticket, DEAL_VOLUME);
      string sid = HistoryDealGetString(ticket, DEAL_COMMENT);
      if(StringLen(sid) == 0 && orderId > 0 && HistoryOrderSelect((ulong)orderId))
         sid = HistoryOrderGetString((ulong)orderId, ORDER_COMMENT);

      ENUM_DEAL_REASON reason = (ENUM_DEAL_REASON)HistoryDealGetInteger(ticket, DEAL_REASON);
      string closeStatus = "CLOSED";
      if(reason == DEAL_REASON_TP)
         closeStatus = "TP";
      else if(reason == DEAL_REASON_SL || reason == DEAL_REASON_SO)
         closeStatus = "SL";
      else if(reason == DEAL_REASON_CLIENT || reason == DEAL_REASON_EXPERT || reason == DEAL_REASON_MOBILE)
         closeStatus = "CANCEL";

      if(updates != "") updates += ",";
      updates += "{";
      updates += "\"signal_id\":\"" + JsonEscape(sid) + "\",";
      updates += "\"ticket\":\"" + IntegerToString(posId) + "\",";
      updates += "\"position_ticket\":\"" + IntegerToString(posId) + "\",";
      updates += "\"deal_ticket\":\"" + IntegerToString((long)ticket) + "\",";
      updates += "\"order_ticket\":\"" + IntegerToString(orderId) + "\",";
      updates += "\"pnl\":" + DoubleToString(pnl, 2) + ",";
      updates += "\"status\":\"" + JsonEscape(closeStatus) + "\",";
      updates += "\"close_time\":" + IntegerToString((long)time) + ",";
      updates += "\"symbol\":\"" + JsonEscape(sym) + "\",";
      updates += "\"volume\":" + DoubleToString(vol, 2);
      updates += "}";
      count++;
      if(count >= 100) break; // Increased batch size to 100
   }

   if(count > 0)
   {
      string body = "{\"account_id\":\"" + IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN)) + "\",\"updates\":[" + updates + "]}";
      HttpPostJson(BuildApiUrl("/v2/ea/trades/sync-bulk"), body);
   }
}

void OnTick()
{
   if(InpBacktestMode)
      ProcessBacktestQueue();
   
   if(InpMgtStrategy != STRATEGY_NONE)
      ManageBrokerPositions();
}

//+------------------------------------------------------------------+
//| Management Logic: The Hand                                       |
//+------------------------------------------------------------------+
void ManageBrokerPositions()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0 && PositionSelectByTicket(ticket))
      {
         long magic = PositionGetInteger(POSITION_MAGIC);
         if(magic != InpMagic) continue; // Only manage our trades

         string symbol = PositionGetString(POSITION_SYMBOL);
         double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
         double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
         double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
         double digits = SymbolInfoInteger(symbol, SYMBOL_DIGITS);
         double pipSize = (digits == 3 || digits == 5) ? point * 10 : point;
         
         if(bid <= 0 || ask <= 0 || pipSize <= 0) continue;

         double entry = PositionGetDouble(POSITION_PRICE_OPEN);
         long type = PositionGetInteger(POSITION_TYPE);
         double currentPrice = (type == POSITION_TYPE_BUY) ? bid : ask;
         double sl = PositionGetDouble(POSITION_SL);
         double tp = PositionGetDouble(POSITION_TP);
         
         double pips = (type == POSITION_TYPE_BUY) 
            ? (currentPrice - entry) / pipSize 
            : (entry - currentPrice) / pipSize;

         bool modified = false;
         double newSl = sl;

         // 1. Break Even
         if(InpMgtStrategy == STRATEGY_BE || InpMgtStrategy == STRATEGY_BOTH)
         {
            if(pips >= InpMgtBE_Trigger_Pips)
            {
               double targetSL = (type == POSITION_TYPE_BUY) 
                  ? entry + (InpMgtBE_Offset_Pips * pipSize)
                  : entry - (InpMgtBE_Offset_Pips * pipSize);

               // Only move SL forward
               bool needsMove = false;
               if(sl == 0) needsMove = true;
               else if(type == POSITION_TYPE_BUY && sl < targetSL - (0.1 * pipSize)) needsMove = true;
               else if(type == POSITION_TYPE_SELL && sl > targetSL + (0.1 * pipSize)) needsMove = true;

               if(needsMove)
               {
                  newSl = targetSL;
                  modified = true;
                  Print("[BE] Moving SL to Entry+", InpMgtBE_Offset_Pips, " pips for ", symbol, " ", ticket);
               }
            }
         }

         // 2. Trailing Stop (Only if BE didn't just trigger or if already past BE)
         if(!modified && (InpMgtStrategy == STRATEGY_TRAIL || InpMgtStrategy == STRATEGY_BOTH))
         {
            if(pips >= InpMgtTrail_Start_Pips)
            {
               double targetSL = (type == POSITION_TYPE_BUY)
                  ? currentPrice - (InpMgtTrail_Start_Pips * pipSize)
                  : currentPrice + (InpMgtTrail_Start_Pips * pipSize);

               bool shouldMove = false;
               if(sl == 0) shouldMove = true;
               else
               {
                  double currentDiff = (type == POSITION_TYPE_BUY)
                     ? (targetSL - sl) / pipSize
                     : (sl - targetSL) / pipSize;
                  
                  if(currentDiff >= InpMgtTrail_Step_Pips) shouldMove = true;
               }

               if(shouldMove)
               {
                  newSl = targetSL;
                  modified = true;
                  Print("[Trail] Moving SL to ", DoubleToString(newSl, (int)digits), " for ", symbol, " ", ticket);
               }
            }
         }

         if(modified)
         {
            if(!trade.PositionModify(ticket, NormalizeDouble(newSl, (int)digits), NormalizeDouble(tp, (int)digits)))
            {
               Print("[Mgt] Modify failed: ", GetLastError());
            }
         }

         // 3. Partial TPs
         string sid = PositionGetString(POSITION_COMMENT);
         if(sid != "")
         {
            for(int j = 0; j < ArraySize(g_partialTargets); j++)
            {
               if(g_partialTargets[j].sid == sid && !g_partialTargets[j].done)
               {
                  bool hit = (type == POSITION_TYPE_BUY) ? (bid >= g_partialTargets[j].price) : (ask <= g_partialTargets[j].price);
                  if(hit)
                  {
                     double currentVol = PositionGetDouble(POSITION_VOLUME);
                     double closeVol = NormalizeDouble(currentVol * (g_partialTargets[j].pct / 100.0), 2);
                     double minVol = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
                     
                     if(closeVol >= minVol && currentVol - closeVol >= minVol)
                     {
                        if(trade.PositionClosePartial(ticket, closeVol))
                        {
                           g_partialTargets[j].done = true;
                           Print("[Partial] Closed ", closeVol, " lots (", g_partialTargets[j].pct, "%) for ", symbol, " ", ticket);
                        }
                     }
                     else if(currentVol > 0)
                     {
                        // If too small for partial, just mark as done to avoid noise
                        g_partialTargets[j].done = true;
                        Print("[Partial] Skipped ", ticket, " (Volume too small for partial)");
                     }
                  }
               }
            }
         }
      }
   }
}

void OnTradeTransaction(const MqlTradeTransaction& trans,
                        const MqlTradeRequest& request,
                        const MqlTradeResult& result)
{
   if(!InpEnableTradeEventAck || InpBacktestMode)
      return;

   // Track Pending / Cancelled Orders
   if(trans.type == TRADE_TRANSACTION_ORDER_ADD)
   {
      ulong orderTicket = trans.order;
      if(orderTicket > 0 && OrderSelect(orderTicket))
      {
         long magic = OrderGetInteger(ORDER_MAGIC);
         if(magic == InpMagic)
         {
            string signalId = "";
            int ordIdx = -1;
            GetSignalIdByOrderTicket(orderTicket, signalId, ordIdx);
            if(StringLen(signalId) == 0) signalId = OrderGetString(ORDER_COMMENT);

            if(StringLen(signalId) > 0)
            {
               g_ackSymbol = OrderGetString(ORDER_SYMBOL);
               ENUM_ORDER_TYPE ot = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
               g_ackAction = (ot == ORDER_TYPE_BUY_LIMIT || ot == ORDER_TYPE_BUY_STOP) ? "BUY" : "SELL";
               g_ackExecTs = TimeCurrent();
               g_ackFreeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
               g_ackBalance = AccountInfoDouble(ACCOUNT_BALANCE);
               g_ackEquity = AccountInfoDouble(ACCOUNT_EQUITY);
               g_ackHasPnlRealized = false;

               Ack(signalId, "PLACED", IntegerToString((long)orderTicket), "order_placed");
            }
         }
      }
      return;
   }
   else if(trans.type == TRADE_TRANSACTION_ORDER_DELETE)
   {
      ulong orderTicket = trans.order;
      if(orderTicket > 0 && HistoryOrderSelect(orderTicket))
      {
         long magic = HistoryOrderGetInteger(orderTicket, ORDER_MAGIC);
         if(magic == InpMagic)
         {
            string signalId = "";
            int ordIdx = -1;
            GetSignalIdByOrderTicket(orderTicket, signalId, ordIdx);
            if(StringLen(signalId) == 0) signalId = HistoryOrderGetString(orderTicket, ORDER_COMMENT);

            if(StringLen(signalId) > 0)
            {
               g_ackSymbol = HistoryOrderGetString(orderTicket, ORDER_SYMBOL);
               ENUM_ORDER_TYPE ot = (ENUM_ORDER_TYPE)HistoryOrderGetInteger(orderTicket, ORDER_TYPE);
               g_ackAction = (ot == ORDER_TYPE_BUY_LIMIT || ot == ORDER_TYPE_BUY_STOP || ot == ORDER_TYPE_BUY) ? "BUY" : "SELL";
               g_ackExecTs = TimeCurrent();
               g_ackFreeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
               g_ackBalance = AccountInfoDouble(ACCOUNT_BALANCE);
               g_ackEquity = AccountInfoDouble(ACCOUNT_EQUITY);
               g_ackHasPnlRealized = false;

               ENUM_ORDER_STATE state = (ENUM_ORDER_STATE)HistoryOrderGetInteger(orderTicket, ORDER_STATE);
               if(state == ORDER_STATE_CANCELED || state == ORDER_STATE_EXPIRED || state == ORDER_STATE_REJECTED)
               {
                  Ack(signalId, state == ORDER_STATE_EXPIRED ? "EXPIRED" : "CANCEL", IntegerToString((long)orderTicket), "order_removed");
                  if(ordIdx >= 0) RemoveOrderMapAt(ordIdx);
               }
            }
         }
      }
      return;
   }

   if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
      return;
   if(trans.deal == 0 || !HistoryDealSelect(trans.deal))
      return;

   long magic = HistoryDealGetInteger(trans.deal, DEAL_MAGIC);
   if(magic != InpMagic)
      return;

   ENUM_DEAL_ENTRY entryType = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
   ENUM_DEAL_REASON reason = (ENUM_DEAL_REASON)HistoryDealGetInteger(trans.deal, DEAL_REASON);
   ENUM_DEAL_TYPE dealType = (ENUM_DEAL_TYPE)HistoryDealGetInteger(trans.deal, DEAL_TYPE);
   ulong positionTicket = (ulong)HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID);
   ulong orderTicket = (ulong)HistoryDealGetInteger(trans.deal, DEAL_ORDER);
   string symbol = HistoryDealGetString(trans.deal, DEAL_SYMBOL);
   string dealComment = HistoryDealGetString(trans.deal, DEAL_COMMENT);

   string signalId = "";
   int posIdx = -1;
   int ordIdx = -1;
   GetSignalIdByPositionTicket(positionTicket, signalId, posIdx);
   if(StringLen(signalId) == 0)
      GetSignalIdByOrderTicket(orderTicket, signalId, ordIdx);
   if(StringLen(signalId) == 0 && orderTicket > 0 && HistoryOrderSelect(orderTicket))
      signalId = HistoryOrderGetString(orderTicket, ORDER_COMMENT);
   if(StringLen(signalId) == 0)
      signalId = dealComment;
   if(StringLen(signalId) == 0)
      return;

   g_ackSymbol = symbol;
   g_ackAction = (dealType == DEAL_TYPE_BUY) ? "BUY" : "SELL";
   g_ackRetcode = 0;
   g_ackRetmsg = "";
   g_ackExecTs = TimeCurrent();
   g_ackFreeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   g_ackBalance = AccountInfoDouble(ACCOUNT_BALANCE);
   g_ackEquity = AccountInfoDouble(ACCOUNT_EQUITY);

   if(entryType == DEAL_ENTRY_IN)
   {
      if(positionTicket > 0)
         MapPositionSignal(positionTicket, signalId);
      int p2 = -1;
      string tmp = "";
      if(GetSignalIdByPositionTicket(positionTicket, tmp, p2))
      {
         if(g_posMapOpenedAckSent[p2])
            return;
         g_posMapOpenedAckSent[p2] = true;
      }
      if(ordIdx >= 0)
         RemoveOrderMapAt(ordIdx);
      g_ackHasPnlRealized = false;
      g_ackPnlRealized = 0.0;
      Ack(signalId, "START", IntegerToString((long)positionTicket), "entry_filled");
      return;
   }

   if(!(entryType == DEAL_ENTRY_OUT || entryType == DEAL_ENTRY_OUT_BY))
      return;

   // Ignore partial closes: wait until position is fully gone.
   if(positionTicket > 0 && PositionSelectByTicket(positionTicket))
      return;

   string status = "FAIL";
   if(reason == DEAL_REASON_TP)
      status = "TP";
   else if(reason == DEAL_REASON_SL || reason == DEAL_REASON_SO)
      status = "SL";
   else if(reason == DEAL_REASON_CLIENT || reason == DEAL_REASON_EXPERT || reason == DEAL_REASON_MOBILE)
      status = "CANCEL";

   double pnl = HistoryDealGetDouble(trans.deal, DEAL_PROFIT)
                + HistoryDealGetDouble(trans.deal, DEAL_SWAP)
                + HistoryDealGetDouble(trans.deal, DEAL_COMMISSION);
   g_ackPnlRealized = pnl;
   g_ackHasPnlRealized = true;

   string reasonMsg = "close_reason=" + IntegerToString((int)reason)
                      + " deal=" + IntegerToString((int)trans.deal)
                      + " order=" + IntegerToString((long)orderTicket);
   Ack(signalId, status, IntegerToString((long)positionTicket), reasonMsg);

   if(posIdx >= 0)
      RemovePositionMapAt(posIdx);
   if(ordIdx >= 0)
      RemoveOrderMapAt(ordIdx);
   CleanupVirtualGuardByTicket(positionTicket);
}

string g_lastStateHash = "";

void SyncWithVps()
{
   string posUpdates = "";
   string ordUpdates = "";
   string closedUpdates = "";
   int posCount = 0;
   int ordCount = 0;
   int closedCount = 0;
   datetime maxClosedDealTime = g_lastClosedDealSyncTime;

   // 1. Positions
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0 && PositionSelectByTicket(ticket))
      {
         long magic = PositionGetInteger(POSITION_MAGIC);
         if(magic == InpMagic)
         {
            string sid = "";
            int idx = -1;
            GetSignalIdByPositionTicket(ticket, sid, idx);
            if(sid == "") sid = PositionGetString(POSITION_COMMENT);
            if(sid != "")
            {
               string sym = PositionGetString(POSITION_SYMBOL);
               double pnl = PositionGetDouble(POSITION_PROFIT);
               double swap = PositionGetDouble(POSITION_SWAP);
               double comm = PositionGetDouble(POSITION_COMMISSION);
               double vol = PositionGetDouble(POSITION_VOLUME);
               double sl = PositionGetDouble(POSITION_SL);
               double tp = PositionGetDouble(POSITION_TP);
               double priceOpen = PositionGetDouble(POSITION_PRICE_OPEN);
               double priceCurrent = PositionGetDouble(POSITION_PRICE_CURRENT);
               
               double pips = 0;
               double point = SymbolInfoDouble(sym, SYMBOL_POINT);
               if(point > 0) {
                  pips = MathAbs(priceCurrent - priceOpen) / point;
                  if (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) {
                     if (priceCurrent < priceOpen) pips = -pips;
                  } else {
                     if (priceCurrent > priceOpen) pips = -pips;
                  }
                  double digits = SymbolInfoInteger(sym, SYMBOL_DIGITS);
                  if(digits == 3 || digits == 5) pips /= 10.0;
               }

               if(posCount > 0) posUpdates += ",";
               posUpdates += "{";
               posUpdates += "\"signal_id\":\"" + JsonEscape(sid) + "\",";
               posUpdates += "\"status\":\"START\",";
               posUpdates += "\"ticket\":\"" + IntegerToString((long)ticket) + "\",";
               posUpdates += "\"symbol\":\"" + JsonEscape(sym) + "\",";
               posUpdates += "\"type\":\"MARKET\",";
               posUpdates += "\"lots\":" + DoubleToString(vol, 2) + ",";
               posUpdates += "\"volume\":" + DoubleToString(vol, 2) + ",";
               posUpdates += "\"entry\":" + DoubleToString(priceOpen, 5) + ",";
               posUpdates += "\"pnl\":" + DoubleToString(pnl, 2) + ",";
               posUpdates += "\"pips\":" + DoubleToString(pips, 1) + ",";
               posUpdates += "\"commission\":" + DoubleToString(comm, 2) + ",";
               posUpdates += "\"swap\":" + DoubleToString(swap, 2) + ",";
               posUpdates += "\"sl\":" + DoubleToString(sl, 5) + ",";
               posUpdates += "\"tp\":" + DoubleToString(tp, 5) + ",";
               posUpdates += "\"opened_at\":\"" + IsoTime((datetime)PositionGetInteger(POSITION_TIME)) + "\"";
               posUpdates += "}";
               posCount++;
            }
         }
      }
   }

   // 2. Orders
   for(int i = 0; i < OrdersTotal(); i++)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket > 0 && OrderSelect(ticket))
      {
         long magic = OrderGetInteger(ORDER_MAGIC);
         if(magic == InpMagic)
         {
            string sid = "";
            int idx = -1;
            GetSignalIdByOrderTicket(ticket, sid, idx);
            if(sid == "") sid = OrderGetString(ORDER_COMMENT);
            if(sid != "")
            {
               string sym = OrderGetString(ORDER_SYMBOL);
               double vol = OrderGetDouble(ORDER_VOLUME_INITIAL);
               double price = OrderGetDouble(ORDER_PRICE_OPEN);
               double sl = OrderGetDouble(ORDER_SL);
               double tp = OrderGetDouble(ORDER_TP);
               
               double pnl_tp = 0;
               double pnl_sl = 0;
               double margin = 0;
               ENUM_ORDER_TYPE ordType = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
               if(tp > 0) OrderCalcProfit(ordType, sym, vol, price, tp, pnl_tp);
               if(sl > 0) OrderCalcProfit(ordType, sym, vol, price, sl, pnl_sl);
               OrderCalcMargin(ordType, sym, vol, price, margin);

               if(ordCount > 0) ordUpdates += ",";
               ordUpdates += "{";
               ordUpdates += "\"signal_id\":\"" + JsonEscape(sid) + "\",";
               ordUpdates += "\"status\":\"PLACED\",";
               ordUpdates += "\"ticket\":\"" + IntegerToString((long)ticket) + "\",";
               ordUpdates += "\"symbol\":\"" + JsonEscape(sym) + "\",";
               ordUpdates += "\"lots\":" + DoubleToString(vol, 2) + ",";
               ordUpdates += "\"volume\":" + DoubleToString(vol, 2) + ",";
               ordUpdates += "\"type\":\"" + EnumToString(ordType) + "\",";
               ordUpdates += "\"entry\":" + DoubleToString(price, 5) + ",";
               ordUpdates += "\"target_price\":" + DoubleToString(price, 5) + ",";
               ordUpdates += "\"sl\":" + DoubleToString(sl, 5) + ",";
               ordUpdates += "\"tp\":" + DoubleToString(tp, 5) + ",";
               ordUpdates += "\"margin\":" + DoubleToString(margin, 2) + ",";
               ordUpdates += "\"pnl_tp\":" + DoubleToString(pnl_tp, 2) + ",";
               ordUpdates += "\"pnl_sl\":" + DoubleToString(pnl_sl, 2) + ",";
               ordUpdates += "\"pnl\":0";
               ordUpdates += "}";
               ordCount++;
            }
         }
      }
   }

   // 3. Recently closed deals (manual close + TP/SL realized pnl)
   datetime fromTs = g_lastClosedDealSyncTime;
   if(fromTs <= 0) fromTs = TimeCurrent() - 3600; // bootstrap window
   datetime toTs = TimeCurrent();
   if(HistorySelect(fromTs, toTs))
   {
      int dealsTotal = HistoryDealsTotal();
      for(int i = 0; i < dealsTotal; i++)
      {
         ulong dealTicket = HistoryDealGetTicket(i);
         if(dealTicket == 0 || !HistoryDealSelect(dealTicket))
            continue;

         long magic = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
         if(magic != InpMagic)
            continue;

         ENUM_DEAL_ENTRY entryType = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
         if(!(entryType == DEAL_ENTRY_OUT || entryType == DEAL_ENTRY_OUT_BY))
            continue;

         datetime dealTime = (datetime)HistoryDealGetInteger(dealTicket, DEAL_TIME);
         if(dealTime <= g_lastClosedDealSyncTime)
            continue;

         ulong posTicket = (ulong)HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
         ulong orderTicket = (ulong)HistoryDealGetInteger(dealTicket, DEAL_ORDER);
         if(posTicket == 0)
            continue;

         string sid = "";
         int idx = -1;
         GetSignalIdByPositionTicket(posTicket, sid, idx);
         if(sid == "")
            sid = HistoryDealGetString(dealTicket, DEAL_COMMENT);

         ENUM_DEAL_REASON reason = (ENUM_DEAL_REASON)HistoryDealGetInteger(dealTicket, DEAL_REASON);
         string closeStatus = "CLOSED";
         if(reason == DEAL_REASON_TP)
            closeStatus = "TP";
         else if(reason == DEAL_REASON_SL || reason == DEAL_REASON_SO)
            closeStatus = "SL";
         else if(reason == DEAL_REASON_CLIENT || reason == DEAL_REASON_EXPERT || reason == DEAL_REASON_MOBILE)
            closeStatus = "CANCEL";

         double pnl = HistoryDealGetDouble(dealTicket, DEAL_PROFIT)
                      + HistoryDealGetDouble(dealTicket, DEAL_SWAP)
                      + HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);

         if(closedCount > 0) closedUpdates += ",";
         closedUpdates += "{";
         closedUpdates += "\"signal_id\":\"" + JsonEscape(sid) + "\",";
         closedUpdates += "\"status\":\"" + JsonEscape(closeStatus) + "\",";
         closedUpdates += "\"ticket\":\"" + IntegerToString((long)posTicket) + "\",";
         closedUpdates += "\"position_ticket\":\"" + IntegerToString((long)posTicket) + "\",";
         closedUpdates += "\"deal_ticket\":\"" + IntegerToString((long)dealTicket) + "\",";
         closedUpdates += "\"order_ticket\":\"" + IntegerToString((long)orderTicket) + "\",";
         closedUpdates += "\"pnl\":" + DoubleToString(pnl, 2) + ",";
         closedUpdates += "\"closed_at\":\"" + IsoTime(dealTime) + "\"";
         closedUpdates += "}";
         closedCount++;

         if(dealTime > maxClosedDealTime)
            maxClosedDealTime = dealTime;
      }
   }

   string stateHash = posUpdates + "|" + ordUpdates + "|" + closedUpdates;

   // [STATE DETECTION] If total state hasn't changed, skip webhook
   if(stateHash == g_lastStateHash) {
      g_lastSyncPayload = "STABLE (No changes)";
      g_lastSyncCode = 0;
      g_lastSyncSummary = "SKIP stable (no changes)";
      g_lastSyncUpdate = TimeCurrent();
      RefreshDebugPanel();
      return;
   }
   g_lastStateHash = stateHash;

   // 4. Symbol Metrics (for active symbols)
   string symMetrics = "";
   int symCount = 0;
   string trackedSymbols[];
   ArrayResize(trackedSymbols, 0);
   
   // Add current chart symbol
   ArrayResize(trackedSymbols, 1);
   trackedSymbols[0] = Symbol();
   
   // Add symbols from positions
   for(int i=0; i<PositionsTotal(); i++) {
      if(PositionSelectByTicket(PositionGetTicket(i))) {
         string s = PositionGetString(POSITION_SYMBOL);
         bool exists = false;
         for(int j=0; j<ArraySize(trackedSymbols); j++) if(trackedSymbols[j] == s) { exists=true; break; }
         if(!exists) {
            int n = ArraySize(trackedSymbols);
            ArrayResize(trackedSymbols, n+1);
            trackedSymbols[n] = s;
         }
      }
   }
   
   for(int i=0; i<ArraySize(trackedSymbols); i++) {
      string s = trackedSymbols[i];
      double pipVal = SymbolInfoDouble(s, SYMBOL_TRADE_TICK_VALUE); // approximation
      double spread = SymbolInfoInteger(s, SYMBOL_SPREAD);
      double minVol = SymbolInfoDouble(s, SYMBOL_VOLUME_MIN);
      double stepVol = SymbolInfoDouble(s, SYMBOL_VOLUME_STEP);
      double point = SymbolInfoDouble(s, SYMBOL_POINT);
      int digits = (int)SymbolInfoInteger(s, SYMBOL_DIGITS);
      double pipSize = (digits == 3 || digits == 5) ? point * 10 : point;
      
      if(symCount > 0) symMetrics += ",";
      symMetrics += "{";
      symMetrics += "\"symbol\":\"" + JsonEscape(s) + "\",";
      symMetrics += "\"pip_value\":" + DoubleToString(pipVal, 5) + ",";
      symMetrics += "\"spread\":" + DoubleToString(spread, 1) + ",";
      symMetrics += "\"min_vol\":" + DoubleToString(minVol, 2) + ",";
      symMetrics += "\"step_vol\":" + DoubleToString(stepVol, 2) + ",";
      symMetrics += "\"pip_size\":" + DoubleToString(pipSize, 8) + ",";
      symMetrics += "\"digits\":" + IntegerToString(digits);
      symMetrics += "}";
      symCount++;
   }

   string body = "{";
   body += "\"account_id\":\"" + IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN)) + "\",";
   body += "\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   body += "\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",";
   body += "\"margin\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN), 2) + ",";
   body += "\"free_margin\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) + ",";
   body += "\"broker_name\":\"" + JsonEscape(AccountInfoString(ACCOUNT_COMPANY)) + "\",";
   body += "\"leverage\":" + IntegerToString((int)AccountInfoInteger(ACCOUNT_LEVERAGE)) + ",";
   body += "\"positions\":[" + posUpdates + "],";
   body += "\"orders\":[" + ordUpdates + "],";
   body += "\"closed\":[" + closedUpdates + "],";
   body += "\"symbol_metrics\":[" + symMetrics + "]";
   body += "}";

   string url = BuildApiUrl("/mt5/ea/sync-v2");
   string resp = "";
   if(HttpPostJsonWithResponse(url, body, resp))
   {
      g_lastSyncCode = g_lastHttpCode;
      int synced = (int)JsonGetNumber(resp, "synced", -1);
      int matched = (int)JsonGetNumber(resp, "matched", -1);
      int received = (int)JsonGetNumber(resp, "received", -1);
      g_lastSyncSummary = "OK pushed pos=" + IntegerToString(posCount) + " ord=" + IntegerToString(ordCount) + " closed=" + IntegerToString(closedCount);
      if(synced >= 0 || matched >= 0 || received >= 0)
      {
         g_lastSyncSummary += " | synced=" + IntegerToString(synced) +
                              " matched=" + IntegerToString(matched) +
                              " recv=" + IntegerToString(received);
      }
      g_lastSyncPayload = "V2 OK: " + SanitizeOneLine(resp, 150);
      if(maxClosedDealTime > g_lastClosedDealSyncTime)
         g_lastClosedDealSyncTime = maxClosedDealTime;
   }
   else
   {
      g_lastSyncCode = g_lastHttpCode;
      g_lastSyncSummary = "FAIL " + g_lastHttpMethod + " " + SanitizeOneLine(g_lastHttpUrl, 64) + " | " + g_lastHttpError;
      g_lastSyncPayload = "V2 FAIL: " + SanitizeOneLine(resp, 150);
      g_lastStateHash = "";
   }
   g_lastSyncUpdate = TimeCurrent();
   RefreshDebugPanel();
}

int OnInit()
{
   LoadMappings();
   if(InpBacktestMode)
   {
      g_btLoaded = LoadBacktestSignals();
      if(!g_btLoaded)
      {
         Print("Backtest mode enabled but no valid signals loaded.");
         return(INIT_FAILED);
      }
      Print("TVBridgeEA backtest mode initialized.");
      Print("TVBridgeEA build: ", EA_BUILD_VERSION);
      g_dbgLastStatus = "BT_READY";
      g_dbgLastTime = TimeCurrent();
      RefreshDebugPanel();
      return(INIT_SUCCEEDED);
   }

   EventSetTimer(MathMax(InpPollSeconds, 1));
   Print("TVBridgeEA initialized. Add URL to MT5 WebRequest allow-list: ", InpServerBaseUrl);
   RemoteLog("EA initialized. Build=" + EA_BUILD_VERSION + " Account=" + IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN)));
   Print("TVBridgeEA build: ", EA_BUILD_VERSION);
   Print("TVBridgeEA auth: key=", ApiKeyMask(), " hint=", ApiKeyHint());
   g_dbgLastStatus = "LIVE_READY";
   g_dbgLastTime = TimeCurrent();
   RefreshDebugPanel();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(InpShowDebugPanel)
      Comment("");
}
