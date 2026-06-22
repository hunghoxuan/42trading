from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
from typing import Any

try:
    import MetaTrader5 as mt5  # type: ignore
except Exception:  # pragma: no cover
    mt5 = None


class MT5ConnectorError(RuntimeError):
    pass


def mt5_runtime_status() -> dict[str, Any]:
    return {
        "available": mt5 is not None,
        "library": "MetaTrader5",
        "reason": None if mt5 is not None else "MetaTrader5 package is not installed or unavailable on this machine.",
    }


def _coerce_login(value: Any) -> int | None:
    if value in (None, ""):
        return None
    return int(value)


def _coerce_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


class MT5Connector:
    def __init__(self, login=None, password=None, server=None):
        self.login = _coerce_login(login if login is not None else os.environ.get("MT5_LOGIN"))
        self.password = password if password is not None else os.environ.get("MT5_PASSWORD")
        self.server = server if server is not None else os.environ.get("MT5_SERVER")
        self.terminal_path = os.environ.get("MT5_TERMINAL_PATH")
        self.terminal_portable = _coerce_bool(os.environ.get("MT5_TERMINAL_PORTABLE"), default=False)

    def ensure_session(self) -> bool:
        if mt5 is None:
            raise MT5ConnectorError("MetaTrader5 runtime is unavailable. Install the MetaTrader5 Python package on a Windows MT5 host.")
        kwargs: dict[str, Any] = {}
        if self.terminal_path:
            kwargs["path"] = self.terminal_path
        if self.terminal_portable:
            kwargs["portable"] = True
        if not mt5.initialize(**kwargs):
            raise MT5ConnectorError(f"MT5 initialize failed: {mt5.last_error()}")
        if self.login is not None:
            login_kwargs: dict[str, Any] = {"login": self.login}
            if self.password:
                login_kwargs["password"] = self.password
            if self.server:
                login_kwargs["server"] = self.server
            if not mt5.login(**login_kwargs):
                raise MT5ConnectorError(f"MT5 login failed: {mt5.last_error()}")
            account_info = mt5.account_info()
            if account_info is None:
                raise MT5ConnectorError(f"MT5 account_info failed after login: {mt5.last_error()}")
            self._assert_expected_account(self._asdict(account_info))
        return True

    def disconnect(self):
        if mt5 is not None:
            mt5.shutdown()

    def get_execution_readiness(self) -> dict[str, Any]:
        self.ensure_session()
        terminal_info = mt5.terminal_info()
        if terminal_info is None:
            raise MT5ConnectorError(f"MT5 terminal_info failed: {mt5.last_error()}")
        account_info = mt5.account_info()
        if account_info is None:
            raise MT5ConnectorError(f"MT5 account_info failed: {mt5.last_error()}")
        terminal_raw = self._asdict(terminal_info)
        account_raw = self._asdict(account_info)
        blockers: list[dict[str, Any]] = []
        if terminal_raw.get("trade_allowed") is False:
            blockers.append({
                "code": "TERMINAL_AUTOTRADING_DISABLED",
                "message": "MT5 terminal reports trade_allowed=false. Enable AutoTrading in the execution terminal.",
                "origin": "terminal",
            })
        if terminal_raw.get("tradeapi_disabled") is True:
            blockers.append({
                "code": "TERMINAL_API_DISABLED",
                "message": "MT5 terminal reports tradeapi_disabled=true. Allow external Python/API trading in MT5 settings.",
                "origin": "terminal",
            })
        if account_raw.get("trade_allowed") is False:
            blockers.append({
                "code": "ACCOUNT_TRADE_DISABLED",
                "message": "Broker account reports trade_allowed=false.",
                "origin": "account",
            })
        return {
            "ready": len(blockers) == 0,
            "message": blockers[0]["message"] if blockers else "MT5 terminal and account are ready.",
            "failureCode": blockers[0]["code"] if blockers else None,
            "blockers": blockers,
            "terminal": {
                "connected": self._optional_bool(terminal_raw.get("connected")),
                "tradeAllowed": self._optional_bool(terminal_raw.get("trade_allowed")),
                "tradeApiDisabled": self._optional_bool(terminal_raw.get("tradeapi_disabled")),
                "dllsAllowed": self._optional_bool(terminal_raw.get("dlls_allowed")),
                "path": self._string_or_none(terminal_raw.get("path")),
                "dataPath": self._string_or_none(terminal_raw.get("data_path")),
                "rawBrokerJson": terminal_raw,
            },
            "account": {
                "login": self._string_or_none(account_raw.get("login")) or self._string_or_none(self.login),
                "server": self._string_or_none(account_raw.get("server")) or self._string_or_none(self.server),
                "tradeAllowed": self._optional_bool(account_raw.get("trade_allowed")),
                "tradeExpert": self._optional_bool(account_raw.get("trade_expert")),
                "rawBrokerJson": account_raw,
            },
            "evaluatedAt": self._iso(datetime.now(timezone.utc)),
        }

    def get_account_summary(self) -> dict[str, Any]:
        self.ensure_session()
        info = mt5.account_info()
        if info is None:
            raise MT5ConnectorError(f"MT5 account_info failed: {mt5.last_error()}")
        raw = self._asdict(info)
        return {
            "login": str(raw.get("login") or self.login or ""),
            "server": str(raw.get("server") or self.server or ""),
            "balance": self._float(raw.get("balance")),
            "equity": self._float(raw.get("equity")),
            "margin": self._float(raw.get("margin")),
            "freeMargin": self._float(raw.get("margin_free")),
            "marginLevel": self._optional_float(raw.get("margin_level")),
            "unrealizedPnl": self._float(raw.get("profit")),
            "realizedPnlDay": self._calculate_realized_pnl_day(),
            "currency": raw.get("currency"),
            "leverage": int(raw["leverage"]) if raw.get("leverage") is not None else None,
            "brokerTime": self._iso(datetime.now(timezone.utc)),
            "rawBrokerJson": raw,
        }

    def get_positions(self) -> list[dict[str, Any]]:
        self.ensure_session()
        rows = mt5.positions_get() or []
        positions: list[dict[str, Any]] = []
        for row in rows:
            raw = self._asdict(row)
            positions.append({
                "brokerPositionId": str(raw.get("ticket")),
                "brokerOrderId": self._string_or_none(raw.get("identifier")),
                "symbol": raw.get("symbol"),
                "side": "SHORT" if raw.get("type") == mt5.POSITION_TYPE_SELL else "LONG",
                "volume": self._float(raw.get("volume")),
                "openPrice": self._float(raw.get("price_open")),
                "stopLoss": self._optional_float(raw.get("sl")),
                "takeProfit": self._optional_float(raw.get("tp")),
                "currentPrice": self._optional_float(raw.get("price_current")),
                "swap": self._float(raw.get("swap")),
                "commission": self._float(raw.get("commission")),
                "unrealizedPnl": self._float(raw.get("profit")),
                "openedAt": self._timestamp_to_iso(raw.get("time")),
                "rawBrokerJson": raw,
            })
        return positions

    def get_orders(self) -> list[dict[str, Any]]:
        self.ensure_session()
        rows = mt5.orders_get() or []
        orders: list[dict[str, Any]] = []
        for row in rows:
            raw = self._asdict(row)
            filled_volume = self._float(raw.get("volume_initial")) - self._float(raw.get("volume_current"))
            orders.append({
                "brokerOrderId": str(raw.get("ticket")),
                "relatedPositionBrokerId": self._string_or_none(raw.get("position_id")),
                "symbol": raw.get("symbol"),
                "side": self._order_side(raw.get("type")),
                "orderType": self._order_type_label(raw.get("type")),
                "requestedVolume": self._float(raw.get("volume_initial")),
                "filledVolume": filled_volume,
                "price": self._optional_float(raw.get("price_open")),
                "stopLoss": self._optional_float(raw.get("sl")),
                "takeProfit": self._optional_float(raw.get("tp")),
                "status": self._string_or_none(raw.get("state")) or "PENDING",
                "createdAt": self._timestamp_to_iso(raw.get("time_setup")),
                "expiresAt": self._timestamp_to_iso(raw.get("time_expiration")),
                "rawBrokerJson": raw,
            })
        return orders

    def get_deals(self, limit: int = 50) -> list[dict[str, Any]]:
        self.ensure_session()
        date_to = datetime.now(timezone.utc)
        date_from = date_to - timedelta(days=30)
        rows = mt5.history_deals_get(date_from, date_to) or []
        deals: list[dict[str, Any]] = []
        for row in sorted(rows, key=lambda item: getattr(item, "time", 0), reverse=True)[: max(1, limit)]:
            raw = self._asdict(row)
            deals.append({
                "brokerDealId": str(raw.get("ticket")),
                "brokerOrderId": self._string_or_none(raw.get("order")),
                "brokerPositionId": self._string_or_none(raw.get("position_id")),
                "symbol": raw.get("symbol"),
                "side": self._deal_side(raw.get("type")),
                "entryType": self._string_or_none(raw.get("entry")),
                "volume": self._float(raw.get("volume")),
                "price": self._optional_float(raw.get("price")),
                "commission": self._float(raw.get("commission")),
                "swap": self._float(raw.get("swap")),
                "profit": self._float(raw.get("profit")),
                "executedAt": self._timestamp_to_iso(raw.get("time")),
                "comment": self._string_or_none(raw.get("comment")),
                "rawBrokerJson": raw,
            })
        return deals

    def get_quote(self, symbol: str) -> dict[str, Any]:
        self.ensure_session()
        self._ensure_symbol(symbol)
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            raise MT5ConnectorError(f"MT5 symbol_info_tick failed for {symbol}: {mt5.last_error()}")
        raw = self._asdict(tick)
        return {
            "symbol": symbol,
            "bid": self._optional_float(raw.get("bid")),
            "ask": self._optional_float(raw.get("ask")),
            "last": self._optional_float(raw.get("last")),
            "brokerTime": self._timestamp_to_iso(raw.get("time")),
            "rawBrokerJson": raw,
        }

    def _ensure_symbol(self, symbol: str):
        info = mt5.symbol_info(symbol)
        if info is None:
            raise MT5ConnectorError(f"Unknown MT5 symbol: {symbol}")
        if not getattr(info, "visible", False):
            if not mt5.symbol_select(symbol, True):
                raise MT5ConnectorError(f"Unable to select MT5 symbol: {symbol}")

    def _calculate_realized_pnl_day(self) -> float:
        date_to = datetime.now(timezone.utc)
        date_from = datetime(date_to.year, date_to.month, date_to.day, tzinfo=timezone.utc)
        rows = mt5.history_deals_get(date_from, date_to) or []
        total = 0.0
        for row in rows:
            raw = self._asdict(row)
            total += self._float(raw.get("profit"))
            total += self._float(raw.get("commission"))
            total += self._float(raw.get("swap"))
        return total

    def _assert_expected_account(self, account_raw: dict[str, Any]):
        if self.login is not None and int(account_raw.get("login") or 0) != int(self.login):
            raise MT5ConnectorError("unexpected account after login")
        if self.server and str(account_raw.get("server") or "") != str(self.server):
            raise MT5ConnectorError("unexpected account after login")

    def _asdict(self, value: Any) -> dict[str, Any]:
        if value is None:
            return {}
        if isinstance(value, dict):
            return value
        if hasattr(value, "_asdict"):
            return dict(value._asdict())
        return {k: getattr(value, k) for k in dir(value) if not k.startswith("_") and not callable(getattr(value, k))}

    def _float(self, value: Any) -> float:
        try:
            if value in (None, ""):
                return 0.0
            return float(value)
        except Exception:
            return 0.0

    def _optional_float(self, value: Any) -> float | None:
        if value in (None, ""):
            return None
        try:
            return float(value)
        except Exception:
            return None

    def _optional_bool(self, value: Any) -> bool | None:
        if value is None:
            return None
        return bool(value)

    def _string_or_none(self, value: Any) -> str | None:
        if value in (None, ""):
            return None
        return str(value)

    def _timestamp_to_iso(self, value: Any) -> str | None:
        if value in (None, "", 0):
            return None
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
        except Exception:
            return None

    def _iso(self, value: datetime) -> str:
        return value.astimezone(timezone.utc).isoformat()

    def _order_side(self, order_type: Any) -> str | None:
        sell_types = {
            getattr(mt5, "ORDER_TYPE_SELL", None),
            getattr(mt5, "ORDER_TYPE_SELL_LIMIT", None),
            getattr(mt5, "ORDER_TYPE_SELL_STOP", None),
            getattr(mt5, "ORDER_TYPE_SELL_STOP_LIMIT", None),
        }
        buy_types = {
            getattr(mt5, "ORDER_TYPE_BUY", None),
            getattr(mt5, "ORDER_TYPE_BUY_LIMIT", None),
            getattr(mt5, "ORDER_TYPE_BUY_STOP", None),
            getattr(mt5, "ORDER_TYPE_BUY_STOP_LIMIT", None),
        }
        if order_type in sell_types:
            return "SHORT"
        if order_type in buy_types:
            return "LONG"
        return None

    def _deal_side(self, deal_type: Any) -> str | None:
        if deal_type == getattr(mt5, "DEAL_TYPE_SELL", None):
            return "SHORT"
        if deal_type == getattr(mt5, "DEAL_TYPE_BUY", None):
            return "LONG"
        return None

    def _order_type_label(self, order_type: Any) -> str:
        labels = {
            getattr(mt5, "ORDER_TYPE_BUY", None): "BUY_MARKET",
            getattr(mt5, "ORDER_TYPE_SELL", None): "SELL_MARKET",
            getattr(mt5, "ORDER_TYPE_BUY_LIMIT", None): "BUY_LIMIT",
            getattr(mt5, "ORDER_TYPE_SELL_LIMIT", None): "SELL_LIMIT",
            getattr(mt5, "ORDER_TYPE_BUY_STOP", None): "BUY_STOP",
            getattr(mt5, "ORDER_TYPE_SELL_STOP", None): "SELL_STOP",
            getattr(mt5, "ORDER_TYPE_BUY_STOP_LIMIT", None): "BUY_STOP_LIMIT",
            getattr(mt5, "ORDER_TYPE_SELL_STOP_LIMIT", None): "SELL_STOP_LIMIT",
        }
        return labels.get(order_type, str(order_type or "UNKNOWN"))
