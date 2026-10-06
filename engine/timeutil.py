"""Eastern Time helpers that work with or without the zoneinfo database (the DST rule is built in as a fallback)."""
import datetime
UTC = datetime.timezone.utc
try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York"); ET.utcoffset(datetime.datetime(2026, 1, 1))
except Exception:                                   # pragma: no cover  (no tzdata installed)
    class _ET(datetime.tzinfo):
        def _dst(self, dt):
            y = dt.year
            d = datetime.date(y, 3, 8); d += datetime.timedelta(days=(6 - d.weekday()) % 7)      # 2nd Sunday of March
            e = datetime.date(y, 11, 1); e += datetime.timedelta(days=(6 - e.weekday()) % 7)     # 1st Sunday of November
            s = datetime.datetime(y, 3, d.day, 2); en = datetime.datetime(y, 11, e.day, 2)
            return s <= dt.replace(tzinfo=None) < en
        def utcoffset(self, dt): return datetime.timedelta(hours=-4 if self._dst(dt) else -5)
        def dst(self, dt): return datetime.timedelta(hours=1 if self._dst(dt) else 0)
        def tzname(self, dt): return "EDT" if self._dst(dt) else "EST"
        def fromutc(self, dt):
            n = dt.replace(tzinfo=None)
            off = -4 if self._dst(n - datetime.timedelta(hours=4)) else -5
            return (n + datetime.timedelta(hours=off)).replace(tzinfo=self)
    ET = _ET()

def parse_iso(s):
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))

def to_et(dt): return dt.astimezone(ET)

def et_date_of(iso):
    """ET calendar date of an ISO timestamp"""
    return parse_iso(iso).astimezone(ET).date()

def today_et(now_utc):
    return now_utc.astimezone(ET).date()
