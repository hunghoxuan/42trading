import logging
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover
    load_dotenv = None

from bridge_server import start_bridge_server

SERVICE_DIR = Path(__file__).resolve().parent
if load_dotenv:
    load_dotenv(SERVICE_DIR / ".env", override=False)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)


def main():
    host = os.environ.get("MT5_BRIDGE_HOST", "127.0.0.1")
    port = int(os.environ.get("MT5_BRIDGE_PORT", "3002"))
    logger.info("Starting mt5-python-bridge on http://%s:%s", host, port)
    server = start_bridge_server()
    try:
        server.serve_forever()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Shutting down mt5-python-bridge...")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
