"""
In-memory TTL cache with background refresh.
Replaces Apps Script CacheService + scheduledMasterReportRefresh trigger.
"""

import threading
import time
import logging
from datetime import datetime
from typing import Any, Optional

logger = logging.getLogger(__name__)

MASTER_CACHE_KEY = "master_report_raw"
MASTER_CACHE_TTL = 600  # 10 minutes


class TTLCache:
    """Thread-safe in-memory cache with per-key TTL."""

    def __init__(self):
        self._store: dict = {}
        self._lock = threading.RLock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expire_at, stored_at = entry
            if time.time() > expire_at:
                del self._store[key]
                return None
            return value

    def set(self, key: str, value: Any, ttl: int = 600):
        with self._lock:
            self._store[key] = (value, time.time() + ttl, time.time())

    def age(self, key: str) -> Optional[int]:
        """Return seconds since the key was stored, or None if missing/expired."""
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            _, expire_at, stored_at = entry
            if time.time() > expire_at:
                return None
            return int(time.time() - stored_at)

    def delete(self, key: str):
        with self._lock:
            self._store.pop(key, None)

    def clear(self):
        with self._lock:
            self._store.clear()


# Singleton cache instance
cache = TTLCache()

# Refresh lock so concurrent requests don't all hit Sheets at once
_refresh_lock = threading.Lock()
_is_refreshing = False


def load_master_report_cache(force: bool = False) -> dict:
    """
    Return cached Master_Report data, loading from Sheets if necessary.
    Returns dict with keys: headers, rows, row_count, last_updated, cache_age, from_cache
    """
    global _is_refreshing

    cached = cache.get(MASTER_CACHE_KEY)
    if cached and not force:
        age = cache.age(MASTER_CACHE_KEY) or 0
        cached["cache_age"] = age
        cached["from_cache"] = True
        logger.debug(f"[CACHE HIT] master_report age={age}s")
        return cached

    # Only one thread refreshes at a time
    with _refresh_lock:
        # Double-check after acquiring lock
        cached = cache.get(MASTER_CACHE_KEY)
        if cached and not force:
            age = cache.age(MASTER_CACHE_KEY) or 0
            cached["cache_age"] = age
            cached["from_cache"] = True
            return cached

        logger.info("[CACHE MISS] Loading Master_Report from Google Sheets...")
        from sheets_client import read_master_report  # lazy import to avoid circular

        raw = read_master_report()
        if not raw:
            logger.warning("Master_Report returned empty data")
            return {"headers": [], "rows": [], "row_count": 0,
                    "last_updated": datetime.utcnow().isoformat(),
                    "cache_age": 0, "from_cache": False}

        headers = [str(h).strip() for h in raw[0]]
        rows = raw[1:]

        result = {
            "headers": headers,
            "rows": rows,
            "row_count": len(rows),
            "last_updated": datetime.utcnow().isoformat(),
            "cache_age": 0,
            "from_cache": False,
        }

        cache.set(MASTER_CACHE_KEY, result, ttl=MASTER_CACHE_TTL)
        logger.info(f"[CACHE SET] master_report — {len(rows)} rows stored")
        return result


def start_background_refresh(interval_seconds: int = 300):
    """
    Start a background thread that refreshes the master cache every N seconds.
    Replaces the Apps Script scheduledMasterReportRefresh time-driven trigger.
    """

    def _refresh_loop():
        logger.info(f"[BG REFRESH] Started — interval={interval_seconds}s")
        while True:
            time.sleep(interval_seconds)
            try:
                logger.info("[BG REFRESH] Refreshing master_report cache...")
                load_master_report_cache(force=True)
                logger.info("[BG REFRESH] Done")
            except Exception as e:
                logger.error(f"[BG REFRESH] Error: {e}")

    t = threading.Thread(target=_refresh_loop, daemon=True)
    t.start()
    logger.info("[BG REFRESH] Thread started")
