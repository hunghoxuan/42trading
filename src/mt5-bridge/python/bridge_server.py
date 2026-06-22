from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
from typing import Any, Callable
from urllib.parse import urlparse

from mt5_connector import MT5Connector, MT5ConnectorError, mt5_runtime_status

logger = logging.getLogger(__name__)


class TradingBridgeServer(ThreadingHTTPServer):
    def __init__(self, server_address, handler_cls):
        super().__init__(server_address, handler_cls)


class TradingBridgeRequestHandler(BaseHTTPRequestHandler):
    server: TradingBridgeServer

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path not in {"/health", "/ready", "/bridge/health"}:
            self._send_json(404, self._error("NOT_FOUND", f"Unknown endpoint: {parsed.path}"))
            return
        runtime = mt5_runtime_status()
        self._send_json(
            200,
            {
                "ok": True,
                "service": "mt5-python-bridge",
                "status": "ok" if runtime["available"] else "degraded",
                "version": os.environ.get("MT5_PYTHON_BRIDGE_VERSION", "read-bridge-2026-06-11"),
                "host": os.environ.get("MT5_BRIDGE_HOST", "127.0.0.1"),
                "port": int(os.environ.get("MT5_BRIDGE_PORT", "3002")),
                "auth": {
                    "required": bool(self._bridge_api_key()),
                    "header": "x-bridge-key",
                },
                "runtime": runtime,
                "capabilities": {
                    "account_reads": True,
                    "trade_execution": False,
                    "market_data": True,
                },
            },
        )

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            if not self._has_valid_auth():
                self._send_json(401, self._error("INVALID_BRIDGE_KEY", "Invalid bridge API key"))
                return
            body = self._read_json()
            payload = self._dispatch(parsed.path, body)
            self._send_json(200, {"ok": True, "data": payload})
        except ValueError as exc:
            self._send_json(400, self._error("INVALID_REQUEST", str(exc)))
        except MT5ConnectorError as exc:
            self._send_json(502, self._error("MT5_BRIDGE_FAILED", str(exc)))
        except Exception as exc:  # pragma: no cover
            logger.exception("Unhandled bridge error")
            self._send_json(500, self._error("BRIDGE_INTERNAL_ERROR", str(exc)))

    def log_message(self, fmt: str, *args):
        logger.info("bridge %s", fmt % args)

    def _dispatch(self, path: str, body: dict[str, Any]):
        connector = self._build_connector(body)
        handlers: dict[str, Callable[[MT5Connector, dict[str, Any]], Any]] = {
            "/bridge/account/summary": lambda current, _: current.get_account_summary(),
            "/bridge/account/readiness": lambda current, _: current.get_execution_readiness(),
            "/bridge/account/positions": lambda current, _: current.get_positions(),
            "/bridge/account/orders": lambda current, _: current.get_orders(),
            "/bridge/account/deals": lambda current, payload: current.get_deals(limit=int(payload.get("limit") or 50)),
            "/bridge/market/quote": lambda current, payload: current.get_quote(symbol=self._required_string(payload, "symbol")),
        }
        if path not in handlers:
            raise ValueError(f"Unknown bridge endpoint: {path}")
        return handlers[path](connector, body)

    def _build_connector(self, body: dict[str, Any]) -> MT5Connector:
        login = body.get("mt5Login")
        password = body.get("mt5Password")
        server = body.get("mt5Server")
        if not login or not password or not server:
            raise ValueError("mt5Login, mt5Password, and mt5Server are required.")
        return MT5Connector(login=login, password=password, server=server)

    def _read_json(self) -> dict[str, Any]:
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            return {}
        body = self.rfile.read(int(raw_length))
        if not body:
            return {}
        parsed = json.loads(body.decode("utf-8"))
        if not isinstance(parsed, dict):
            raise ValueError("JSON request body must be an object.")
        return parsed

    def _send_json(self, status_code: int, payload: dict[str, Any]):
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code: str, message: str) -> dict[str, Any]:
        return {"ok": False, "error": {"code": code, "message": message}}

    def _required_string(self, body: dict[str, Any], key: str) -> str:
        value = body.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{key} is required.")
        return value.strip()

    def _bridge_api_key(self) -> str:
        return str(os.environ.get("MT5_PYTHON_BRIDGE_API_KEY", "")).strip()

    def _has_valid_auth(self) -> bool:
        api_key = self._bridge_api_key()
        if not api_key:
            return True
        header_key = str(self.headers.get("x-bridge-key", "")).strip()
        if header_key and header_key == api_key:
            return True
        auth = str(self.headers.get("authorization", "")).strip()
        return auth.lower().startswith("bearer ") and auth[7:].strip() == api_key


def start_bridge_server() -> TradingBridgeServer:
    host = os.environ.get("MT5_BRIDGE_HOST", "127.0.0.1")
    port = int(os.environ.get("MT5_BRIDGE_PORT", "3002"))
    server = TradingBridgeServer((host, port), TradingBridgeRequestHandler)
    logger.info("MT5 bridge listening on http://%s:%s", host, port)
    return server
