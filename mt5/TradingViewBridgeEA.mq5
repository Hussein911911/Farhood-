#property strict
#property version   "2.00"
#property description "Polls a tenant-scoped PostgreSQL bridge and executes demo-account market orders."

input string InpBaseUrl            = "http://127.0.0.1:3000";
input string InpExpectedAccountNumber = ""; // Must match the MT5 account row used to create this bridge.
input string InpExpectedBrokerServer = "";
input string InpBridgeKey          = ""; // One-time bridge_key returned by POST /api/v1/mt5-accounts.
input string InpBridgeId           = ""; // bridge_id returned by POST /api/v1/mt5-accounts.
input long   InpMagic               = 26100801;
input int    InpDeviationPoints     = 20;
input int    InpServerWaitMs        = 20000;
input int    InpHttpTimeoutMs       = 30000;
input int    InpStateSyncSeconds    = 15;
input bool   InpAllowLiveAccount    = false; // Explicit opt-in; keep false for all demo verification.
input bool   InpLogDetails          = true;

struct TradeOutcome
  {
   bool   success;
   uint   retcode;
   ulong  order;
   ulong  deal;
   double price;
   double executedLot;
   double profitLoss;
   string profitLossCurrency;
   string message;
  };

string g_baseUrl = "";
bool   g_polling = false;
ulong  g_lastPositionSyncMs = 0;

void SyncOpenPositions();

bool IsValidBridgeId(const string value)
  {
   if(StringLen(value) != 36)
      return false;
   for(int index = 0; index < 36; index++)
     {
      ushort character = StringGetCharacter(value, index);
      if(index == 8 || index == 13 || index == 18 || index == 23)
        {
         if(character != '-')
            return false;
         continue;
        }
      bool isHex = (character >= '0' && character <= '9')
                || (character >= 'a' && character <= 'f')
                || (character >= 'A' && character <= 'F');
      if(!isHex)
         return false;
     }
   return true;
  }

int OnInit()
  {
   if(StringLen(InpBridgeKey) < 24)
     {
      Print("TradingViewBridgeEA: InpBridgeKey from the MT5 account setup is required.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(StringLen(InpExpectedAccountNumber) < 1 || StringLen(InpExpectedBrokerServer) < 1)
     {
      Print("TradingViewBridgeEA: set the expected account number and broker server from the account setup response.");
      return INIT_PARAMETERS_INCORRECT;
     }
   string expectedLogin = InpExpectedAccountNumber;
   StringTrimLeft(expectedLogin);
   StringTrimRight(expectedLogin);
   string currentLogin = IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   string currentServer = AccountInfoString(ACCOUNT_SERVER);
   if(currentLogin != expectedLogin || currentServer != InpExpectedBrokerServer)
     {
      Print("TradingViewBridgeEA: terminal account mismatch. Logged in as ", currentLogin,
            " @ ", currentServer, "; expected ", expectedLogin, " @ ", InpExpectedBrokerServer,
            ". EA will not poll/execute commands.");
      return INIT_PARAMETERS_INCORRECT;
     }
   ENUM_ACCOUNT_TRADE_MODE accountMode = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(!InpAllowLiveAccount && accountMode != ACCOUNT_TRADE_MODE_DEMO)
     {
      Print("TradingViewBridgeEA: non-demo account detected. Set InpAllowLiveAccount only after a deliberate production review.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(StringLen(InpBaseUrl) < 8
      || (StringFind(InpBaseUrl, "http://") != 0 && StringFind(InpBaseUrl, "https://") != 0))
     {
      Print("TradingViewBridgeEA: InpBaseUrl must start with http:// or https://.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpMagic <= 0 || InpDeviationPoints < 0)
     {
      Print("TradingViewBridgeEA: InpMagic must be positive and InpDeviationPoints cannot be negative.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(!IsValidBridgeId(InpBridgeId) || InpServerWaitMs < 0 || InpServerWaitMs > 25000)
     {
      Print("TradingViewBridgeEA: set a safe InpBridgeId and InpServerWaitMs between 0 and 25000.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpHttpTimeoutMs <= InpServerWaitMs || InpHttpTimeoutMs <= 0)
     {
      Print("TradingViewBridgeEA: InpHttpTimeoutMs should be greater than InpServerWaitMs.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpStateSyncSeconds < 5 || InpStateSyncSeconds > 300)
     {
      Print("TradingViewBridgeEA: InpStateSyncSeconds must be between 5 and 300.");
      return INIT_PARAMETERS_INCORRECT;
     }

   g_baseUrl = InpBaseUrl;
   if(StringSubstr(g_baseUrl, StringLen(g_baseUrl) - 1, 1) == "/")
      g_baseUrl = StringSubstr(g_baseUrl, 0, StringLen(g_baseUrl) - 1);

   EventSetTimer(1);
   Print("TradingViewBridgeEA started. Add ", g_baseUrl,
         " to MT5: Tools > Options > Expert Advisors > Allow WebRequest.");
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
  }

void OnTimer()
  {
   if(g_polling)
      return;
   g_polling = true;
   ulong nowMs = GetTickCount64();
   if(g_lastPositionSyncMs == 0 || nowMs - g_lastPositionSyncMs >= (ulong)InpStateSyncSeconds * 1000)
     {
      g_lastPositionSyncMs = nowMs;
      SyncOpenPositions();
     }
   PollForCommand();
   g_polling = false;
  }

int HttpCall(const string method, const string path, const string body,
             char &response[], string &responseHeaders)
  {
   char data[];
   if(StringLen(body) > 0)
     {
      int bytes = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
      if(bytes > 0)
         ArrayResize(data, bytes - 1); // WebRequest needs the UTF-8 bytes, not StringToCharArray's trailing NUL.
     }
   else
      ArrayResize(data, 0);

   string headers = "Authorization: Bearer " + InpBridgeKey + "\r\n";
   headers += "X-Bridge-ID: " + InpBridgeId + "\r\n";
   if(method == "POST")
      headers += "Content-Type: application/json\r\n";

   ResetLastError();
   return WebRequest(method, g_baseUrl + path, headers, InpHttpTimeoutMs,
                     data, response, responseHeaders);
  }

void PollForCommand()
  {
   int waitMs = (int)MathMax(0, MathMin(25000, InpServerWaitMs));
   string path = StringFormat("/api/v1/mt5/commands/next?wait_ms=%d", waitMs);
   char response[];
   string responseHeaders = "";
   int httpStatus = HttpCall("GET", path, "", response, responseHeaders);

   if(httpStatus == -1)
     {
      Print("TradingViewBridgeEA: WebRequest failed; error=", GetLastError(),
            ". Check the server, URL allow-list, and bridge key.");
      return;
     }
   if(httpStatus == 204)
      return;
   if(httpStatus != 200)
     {
      Print("TradingViewBridgeEA: command poll returned HTTP ", httpStatus,
            "; response=", ResponseText(response));
      return;
     }

   string commandJson = ResponseText(response);
   if(InpLogDetails)
      Print("TradingViewBridgeEA: received command: ", commandJson);
   HandleCommand(commandJson);
  }

string ResponseText(const char &bytes[])
  {
   int count = ArraySize(bytes);
   while(count > 0 && bytes[count - 1] == 0)
      count--;
   return CharArrayToString(bytes, 0, count, CP_UTF8);
  }

int JsonValueStart(const string json, const string key)
  {
   string quotedKey = "\"" + key + "\"";
   int keyAt = StringFind(json, quotedKey);
   if(keyAt < 0)
      return -1;
   int colonAt = StringFind(json, ":", keyAt + StringLen(quotedKey));
   if(colonAt < 0)
      return -1;
   int valueAt = colonAt + 1;
   int length = StringLen(json);
   while(valueAt < length)
     {
      ushort character = StringGetCharacter(json, valueAt);
      if(character != ' ' && character != '\t' && character != '\r' && character != '\n')
         break;
      valueAt++;
     }
   return valueAt;
  }

string JsonGetString(const string json, const string key)
  {
   int valueAt = JsonValueStart(json, key);
   if(valueAt < 0 || StringGetCharacter(json, valueAt) != '"')
      return "";

   string value = "";
   bool escaped = false;
   for(int index = valueAt + 1; index < StringLen(json); index++)
     {
      ushort character = StringGetCharacter(json, index);
      if(escaped)
        {
         if(character == 'n') value += "\n";
         else if(character == 'r') value += "\r";
         else if(character == 't') value += "\t";
         else value += StringSubstr(json, index, 1);
         escaped = false;
         continue;
        }
      if(character == '\\')
        {
         escaped = true;
         continue;
        }
      if(character == '"')
         return value;
      value += StringSubstr(json, index, 1);
     }
   return "";
  }

string JsonGetRaw(const string json, const string key)
  {
   int valueAt = JsonValueStart(json, key);
   if(valueAt < 0)
      return "";
   int endAt = valueAt;
   while(endAt < StringLen(json))
     {
      ushort character = StringGetCharacter(json, endAt);
      if(character == ',' || character == '}' || character == ']')
         break;
      endAt++;
     }
   string value = StringSubstr(json, valueAt, endAt - valueAt);
   StringTrimLeft(value);
   StringTrimRight(value);
   return value;
  }

double JsonGetNumber(const string json, const string key)
  {
   string raw = JsonGetRaw(json, key);
   if(raw == "" || raw == "null")
      return 0.0;
   return StringToDouble(raw);
  }

string JsonEscape(const string value)
  {
   string escaped = "";
   for(int index = 0; index < StringLen(value); index++)
     {
      ushort character = StringGetCharacter(value, index);
      if(character == '"') escaped += "\\\"";
      else if(character == '\\') escaped += "\\\\";
      else if(character == '\n') escaped += "\\n";
      else if(character == '\r') escaped += "\\r";
      else if(character == '\t') escaped += "\\t";
      else if(character < 32) escaped += " ";
      else escaped += StringSubstr(value, index, 1);
     }
   return escaped;
  }

void SyncOpenPositions()
  {
   string body = "{\"positions\":[";
   int count = 0;
   for(int index = PositionsTotal() - 1; index >= 0; index--)
     {
      ulong ticket = PositionGetTicket(index);
      if(ticket == 0 || !PositionSelectByTicket(ticket))
         continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic)
         continue;
      if(count >= 100)
        {
         Print("TradingViewBridgeEA: more than 100 managed positions; dashboard snapshot skipped to avoid a partial state.");
         return;
        }

      string symbol = PositionGetString(POSITION_SYMBOL);
      string side = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "BUY" : "SELL";
      double volume = PositionGetDouble(POSITION_VOLUME);
      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      double currentPnl = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      long magicNumber = PositionGetInteger(POSITION_MAGIC);
      long openedAt = PositionGetInteger(POSITION_TIME);
      if(count > 0)
         body += ",";
      body += StringFormat(
         "{\"ticket\":\"%I64u\",\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%s,\"open_price\":%s,\"current_pnl\":%s,\"currency\":\"%s\",\"magic_number\":%I64d,\"opened_at\":%I64d}",
         ticket, JsonEscape(symbol), side, DoubleToString(volume, 4), DoubleToString(openPrice, 8),
         DoubleToString(currentPnl, 2), JsonEscape(AccountInfoString(ACCOUNT_CURRENCY)), magicNumber, openedAt);
      count++;
     }
   body += "]}";

   char response[];
   string responseHeaders = "";
   int httpStatus = HttpCall("POST", "/api/v1/mt5/positions/sync", body, response, responseHeaders);
   if(httpStatus != 200)
      Print("TradingViewBridgeEA: position snapshot returned HTTP ", httpStatus,
            "; response=", ResponseText(response), "; error=", GetLastError());
   else if(InpLogDetails)
      Print("TradingViewBridgeEA: synchronized ", count, " managed open position(s) for the dashboard.");
  }

void ResetOutcome(TradeOutcome &outcome)
  {
   outcome.success = false;
   outcome.retcode = 0;
   outcome.order = 0;
   outcome.deal = 0;
   outcome.price = 0.0;
   outcome.executedLot = 0.0;
   outcome.profitLoss = 0.0;
   outcome.profitLossCurrency = AccountInfoString(ACCOUNT_CURRENCY);
   outcome.message = "";
  }

bool IsAcceptedRetcode(const uint retcode)
  {
   return retcode == TRADE_RETCODE_DONE
       || retcode == TRADE_RETCODE_DONE_PARTIAL
       || retcode == TRADE_RETCODE_PLACED;
  }

bool TradingAvailable(string &reason)
  {
   if(!TerminalInfoInteger(TERMINAL_CONNECTED))
     {
      reason = "MT5 terminal is disconnected from the broker";
      return false;
     }
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)
      || !MQLInfoInteger(MQL_TRADE_ALLOWED)
      || !AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))
     {
      reason = "Trading is disabled; enable Algo Trading and check account permissions";
      return false;
     }
   return true;
  }

ENUM_ORDER_TYPE_FILLING FillingMode(const string symbol)
  {
   long flags = SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);
   if((flags & SYMBOL_FILLING_IOC) != 0)
      return ORDER_FILLING_IOC;
   if((flags & SYMBOL_FILLING_FOK) != 0)
      return ORDER_FILLING_FOK;
   return ORDER_FILLING_RETURN;
  }

bool ValidVolume(const string symbol, const double volume, string &reason)
  {
   double minimum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maximum = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if(step <= 0.0 || volume < minimum - 1e-8 || volume > maximum + 1e-8)
     {
      reason = StringFormat("lot %.8f is outside broker range [%.8f, %.8f]", volume, minimum, maximum);
      return false;
     }
   double steps = volume / step;
   if(MathAbs(steps - MathRound(steps)) > 1e-6)
     {
      reason = StringFormat("lot %.8f is not aligned to broker volume step %.8f", volume, step);
      return false;
     }
   return true;
  }

double AlignPriceToTick(const string symbol, const double price)
  {
   double tickSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(tickSize <= 0.0)
      tickSize = point;
   if(tickSize > 0.0)
      return NormalizeDouble(MathRound(price / tickSize) * tickSize, digits);
   return NormalizeDouble(price, digits);
  }

bool BuildStops(const string symbol, const string action, const double entryPrice,
                const double stopLossValue, const string stopLossType,
                const double takeProfitValue, const string takeProfitType,
                double &stopLossPrice, double &takeProfitPrice, string &reason)
  {
   stopLossPrice = 0.0;
   takeProfitPrice = 0.0;
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double pipSize = point * ((digits == 3 || digits == 5) ? 10.0 : 1.0);
   double tickSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickSize <= 0.0)
      tickSize = point;

   if(stopLossValue > 0.0)
     {
      if(stopLossType == "pips")
         stopLossPrice = action == "BUY" ? entryPrice - stopLossValue * pipSize : entryPrice + stopLossValue * pipSize;
      else if(stopLossType == "price")
         stopLossPrice = stopLossValue;
      else
        {
         reason = "unsupported stop_loss_type";
         return false;
        }
      stopLossPrice = AlignPriceToTick(symbol, stopLossPrice);
     }

   if(takeProfitValue > 0.0)
     {
      if(takeProfitType == "pips")
         takeProfitPrice = action == "BUY" ? entryPrice + takeProfitValue * pipSize : entryPrice - takeProfitValue * pipSize;
      else if(takeProfitType == "price")
         takeProfitPrice = takeProfitValue;
      else
        {
         reason = "unsupported take_profit_type";
         return false;
        }
      takeProfitPrice = AlignPriceToTick(symbol, takeProfitPrice);
     }

   long stopsLevel = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minimumDistance = (double)stopsLevel * point;
   if(stopLossPrice > 0.0)
     {
      bool correctSide = action == "BUY" ? stopLossPrice < entryPrice : stopLossPrice > entryPrice;
      if(!correctSide)
        {
         reason = "stop_loss is on the wrong side of the market price";
         return false;
        }
      if(minimumDistance > 0.0 && MathAbs(entryPrice - stopLossPrice) + tickSize * 0.25 < minimumDistance)
        {
         reason = "stop_loss is inside the broker's minimum stops distance";
         return false;
        }
     }
   if(takeProfitPrice > 0.0)
     {
      bool correctSide = action == "BUY" ? takeProfitPrice > entryPrice : takeProfitPrice < entryPrice;
      if(!correctSide)
        {
         reason = "take_profit is on the wrong side of the market price";
         return false;
        }
      if(minimumDistance > 0.0 && MathAbs(entryPrice - takeProfitPrice) + tickSize * 0.25 < minimumDistance)
        {
         reason = "take_profit is inside the broker's minimum stops distance";
         return false;
        }
     }
   return true;
  }

string CommandComment(const string id, const string action)
  {
   string prefix = action == "CLOSE" ? "TV:C" : "TV:";
   int remaining = 31 - StringLen(prefix);
   return prefix + StringSubstr(id, 0, remaining);
  }

void ExecuteOpen(const string id, const string action, const string symbol,
                 const double volume, const double stopLossValue,
                 const string stopLossType, const double takeProfitValue,
                 const string takeProfitType, TradeOutcome &outcome)
  {
   ResetOutcome(outcome);
   string reason = "";
   if(!TradingAvailable(reason))
     {
      outcome.message = reason;
      return;
     }
   if(!SymbolSelect(symbol, true))
     {
      outcome.message = "MT5 could not select symbol " + symbol + "; check SYMBOL_MAP and Market Watch";
      return;
     }
   if(!ValidVolume(symbol, volume, reason))
     {
      outcome.message = reason;
      return;
     }

   MqlTick tick;
   if(!SymbolInfoTick(symbol, tick))
     {
      outcome.message = "No current quote for " + symbol;
      return;
     }
   double marketPrice = action == "BUY" ? tick.ask : tick.bid;
   double sl = 0.0;
   double tp = 0.0;
   if(!BuildStops(symbol, action, marketPrice, stopLossValue, stopLossType,
                  takeProfitValue, takeProfitType, sl, tp, reason))
     {
      outcome.message = reason;
      return;
     }

   MqlTradeRequest request = {};
   MqlTradeResult result = {};
   request.action = TRADE_ACTION_DEAL;
   request.symbol = symbol;
   request.volume = volume;
   request.type = action == "BUY" ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   request.price = marketPrice;
   request.sl = sl;
   request.tp = tp;
   request.deviation = InpDeviationPoints;
   request.magic = InpMagic;
   request.type_filling = FillingMode(symbol);
   request.comment = CommandComment(id, action);

   ResetLastError();
   bool sent = OrderSend(request, result);
   outcome.retcode = result.retcode;
   outcome.order = result.order;
   outcome.deal = result.deal;
   outcome.price = result.price;
   if(result.deal > 0)
      outcome.executedLot = result.volume > 0.0 ? result.volume : volume;
   outcome.success = sent && IsAcceptedRetcode(result.retcode);
   if(outcome.success)
      outcome.message = result.comment == "" ? "Market order accepted by broker" : result.comment;
   else if(result.comment != "")
      outcome.message = StringFormat("OrderSend rejected (retcode %u): %s", result.retcode, result.comment);
   else
      outcome.message = StringFormat("OrderSend failed (retcode %u, terminal error %d)", result.retcode, GetLastError());
  }

double RealizedDealNet(const ulong dealTicket)
  {
   if(dealTicket == 0)
      return 0.0;
   datetime endTime = TimeCurrent() + 60;
   if(!HistorySelect(endTime - 86400, endTime))
      return 0.0;
   if(!HistoryDealSelect(dealTicket))
      return 0.0;
   return HistoryDealGetDouble(dealTicket, DEAL_PROFIT)
        + HistoryDealGetDouble(dealTicket, DEAL_SWAP)
        + HistoryDealGetDouble(dealTicket, DEAL_COMMISSION)
        + HistoryDealGetDouble(dealTicket, DEAL_FEE);
  }

void ExecuteClose(const string id, const string symbol, TradeOutcome &outcome)
  {
   ResetOutcome(outcome);
   string reason = "";
   if(!TradingAvailable(reason))
     {
      outcome.message = reason;
      return;
     }
   if(!SymbolSelect(symbol, true))
     {
      outcome.message = "MT5 could not select symbol " + symbol + "; check SYMBOL_MAP and Market Watch";
      return;
     }

   int matched = 0;
   int closed = 0;
   string failures = "";
   for(int index = PositionsTotal() - 1; index >= 0; index--)
     {
      ulong ticket = PositionGetTicket(index);
      if(ticket == 0 || !PositionSelectByTicket(ticket))
         continue;
      if(PositionGetString(POSITION_SYMBOL) != symbol)
         continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic)
         continue;

      matched++;
      ENUM_POSITION_TYPE positionType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      double volume = PositionGetDouble(POSITION_VOLUME);
      MqlTick tick;
      if(!SymbolInfoTick(symbol, tick))
        {
         failures += StringFormat("ticket %I64u: no current quote; ", ticket);
         continue;
        }

      MqlTradeRequest request = {};
      MqlTradeResult result = {};
      request.action = TRADE_ACTION_DEAL;
      request.position = ticket;
      request.symbol = symbol;
      request.volume = volume;
      request.type = positionType == POSITION_TYPE_BUY ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
      request.price = positionType == POSITION_TYPE_BUY ? tick.bid : tick.ask;
      request.deviation = InpDeviationPoints;
      request.magic = InpMagic;
      request.type_filling = FillingMode(symbol);
      request.comment = CommandComment(id, "CLOSE");

      ResetLastError();
      bool sent = OrderSend(request, result);
      if(sent && IsAcceptedRetcode(result.retcode))
        {
         closed++;
         outcome.retcode = result.retcode;
         outcome.order = result.order;
         outcome.deal = result.deal;
         outcome.price = result.price;
         if(result.deal > 0)
           {
            outcome.executedLot += result.volume > 0.0 ? result.volume : volume;
            outcome.profitLoss += RealizedDealNet(result.deal);
           }
        }
      else
        {
         failures += StringFormat("ticket %I64u retcode %u (%s); ", ticket, result.retcode, result.comment);
         outcome.retcode = result.retcode;
        }
     }

   if(matched == 0)
     {
      outcome.success = true;
      outcome.retcode = TRADE_RETCODE_DONE;
      outcome.message = "No open position for this symbol and EA magic number";
      return;
     }

   outcome.success = (closed == matched);
   if(outcome.success)
      outcome.message = StringFormat("Accepted close request(s) for %d matching position(s) on %s", closed, symbol);
   else
      outcome.message = StringFormat("Accepted %d of %d close request(s); %s", closed, matched, failures);
  }

void ExecutePanicClose(const string id, TradeOutcome &outcome)
  {
   ResetOutcome(outcome);
   string reason = "";
   if(!TradingAvailable(reason))
     {
      outcome.message = reason;
      return;
     }

   int matched = 0;
   int fullyClosed = 0;
   string failures = "";
   for(int index = PositionsTotal() - 1; index >= 0; index--)
     {
      ulong ticket = PositionGetTicket(index);
      if(ticket == 0 || !PositionSelectByTicket(ticket))
         continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic)
         continue;

      matched++;
      string symbol = PositionGetString(POSITION_SYMBOL);
      if(!SymbolSelect(symbol, true))
        {
         failures += StringFormat("ticket %I64u: cannot select %s; ", ticket, symbol);
         continue;
        }
      ENUM_POSITION_TYPE positionType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      double volume = PositionGetDouble(POSITION_VOLUME);
      MqlTick tick;
      if(!SymbolInfoTick(symbol, tick))
        {
         failures += StringFormat("ticket %I64u: no current quote; ", ticket);
         continue;
        }

      MqlTradeRequest request = {};
      MqlTradeResult result = {};
      request.action = TRADE_ACTION_DEAL;
      request.position = ticket;
      request.symbol = symbol;
      request.volume = volume;
      request.type = positionType == POSITION_TYPE_BUY ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
      request.price = positionType == POSITION_TYPE_BUY ? tick.bid : tick.ask;
      request.deviation = InpDeviationPoints;
      request.magic = InpMagic;
      request.type_filling = FillingMode(symbol);
      request.comment = CommandComment(id, "PANIC");

      ResetLastError();
      bool sent = OrderSend(request, result);
      if(sent && IsAcceptedRetcode(result.retcode))
        {
         outcome.retcode = result.retcode;
         outcome.order = result.order;
         outcome.deal = result.deal;
         outcome.price = result.price;
         if(result.deal > 0)
           {
            outcome.executedLot += result.volume > 0.0 ? result.volume : volume;
            outcome.profitLoss += RealizedDealNet(result.deal);
           }
         if(!PositionSelectByTicket(ticket))
            fullyClosed++;
         else
            failures += StringFormat("ticket %I64u remains open after a partial close; ", ticket);
        }
      else
        {
         failures += StringFormat("ticket %I64u retcode %u (%s); ", ticket, result.retcode, result.comment);
         outcome.retcode = result.retcode;
        }
     }

   if(matched == 0)
     {
      outcome.success = true;
      outcome.retcode = TRADE_RETCODE_DONE;
      outcome.message = "No open positions managed by this EA magic number";
      return;
     }

   outcome.success = (fullyClosed == matched);
   if(outcome.success)
      outcome.message = StringFormat("Panic close accepted for all %d EA-managed position(s)", fullyClosed);
   else
      outcome.message = StringFormat("Panic close completed for %d of %d position(s); %s", fullyClosed, matched, failures);
  }

string DedupeVariableName(const string id)
  {
   return "TVBridge_" + StringSubstr(id, 0, 45);
  }

bool SendResult(const string id, const string leaseToken, const TradeOutcome &outcome)
  {
   string successText = outcome.success ? "true" : "false";
   string priceText = outcome.price > 0.0 ? DoubleToString(outcome.price, 8) : "null";
   string body = "{\"lease_token\":\"" + JsonEscape(leaseToken) + "\",\"success\":" + successText;
   body += ",\"retcode\":" + IntegerToString((int)outcome.retcode);
   body += ",\"order\":\"" + StringFormat("%I64u", outcome.order) + "\"";
   body += ",\"deal\":\"" + StringFormat("%I64u", outcome.deal) + "\"";
   body += ",\"price\":" + priceText;
   body += ",\"executed_lot\":" + DoubleToString(outcome.executedLot, 4);
   body += ",\"profit_loss\":" + DoubleToString(outcome.profitLoss, 2);
   body += ",\"profit_loss_currency\":\"" + JsonEscape(outcome.profitLossCurrency) + "\"";
   body += ",\"message\":\"" + JsonEscape(outcome.message) + "\"}";

   char response[];
   string responseHeaders = "";
   string path = "/api/v1/mt5/commands/" + id + "/result";
   int httpStatus = HttpCall("POST", path, body, response, responseHeaders);
   if(httpStatus != 200)
      Print("TradingViewBridgeEA: result acknowledgement failed for ", id,
            "; HTTP ", httpStatus, "; response=", ResponseText(response),
            "; error=", GetLastError());
   else if(InpLogDetails)
      Print("TradingViewBridgeEA: execution result acknowledged for ", id,
            " (success=", outcome.success, ", retcode=", outcome.retcode, ").");
   return httpStatus == 200;
  }

void HandleCommand(const string commandJson)
  {
   string id = JsonGetString(commandJson, "id");
   string leaseToken = JsonGetString(commandJson, "lease_token");
   string action = JsonGetString(commandJson, "action");
   string symbol = JsonGetString(commandJson, "symbol");
   if(id == "" || leaseToken == "")
     {
      Print("TradingViewBridgeEA: invalid command JSON; id or lease_token is missing.");
      return;
     }

   string dedupeName = DedupeVariableName(id);
   if(GlobalVariableCheck(dedupeName))
     {
      TradeOutcome duplicate;
      ResetOutcome(duplicate);
      duplicate.success = true;
      duplicate.retcode = TRADE_RETCODE_DONE;
      duplicate.message = "Duplicate command already processed by this terminal; not resent to broker";
      bool duplicateAcknowledged = SendResult(id, leaseToken, duplicate);
      if(action == "PANIC" && duplicateAcknowledged)
         ExpertRemove();
      return;
     }

   TradeOutcome outcome;
   if(action == "BUY" || action == "SELL")
     {
      ExecuteOpen(id, action, symbol, JsonGetNumber(commandJson, "lot"),
                  JsonGetNumber(commandJson, "stop_loss"), JsonGetString(commandJson, "stop_loss_type"),
                  JsonGetNumber(commandJson, "take_profit"), JsonGetString(commandJson, "take_profit_type"),
                  outcome);
     }
   else if(action == "CLOSE")
      ExecuteClose(id, symbol, outcome);
   else if(action == "PANIC")
      ExecutePanicClose(id, outcome);
   else
     {
      ResetOutcome(outcome);
      outcome.message = "Unsupported action: " + action;
     }

   // Persist successful executions before the HTTP acknowledgement so a redelivered
   // command after a network interruption is not sent to the broker a second time.
   if(outcome.success)
     {
      GlobalVariableSet(dedupeName, (double)TimeCurrent());
      GlobalVariablesFlush();
     }
   if(InpLogDetails || !outcome.success)
      Print("TradingViewBridgeEA: ", action, " ", symbol, " => ", outcome.success,
            "; retcode=", outcome.retcode, "; ", outcome.message);
   bool acknowledged = SendResult(id, leaseToken, outcome);
   if(action == "PANIC" && outcome.success && acknowledged)
     {
      Print("TradingViewBridgeEA: panic command acknowledged; removing EA from chart.");
      ExpertRemove();
     }
  }
