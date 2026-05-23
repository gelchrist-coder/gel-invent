from app.main import app, _ensure_critical_auth_schema_sync

# Run critical schema migrations synchronously at cold-start so the first
# request never hits a missing-column error (e.g. business_location).
try:
    _ensure_critical_auth_schema_sync()
except Exception as _e:
    import sys
    print(f"[api/index.py] Schema sync warning: {_e}", file=sys.stderr)

# Vercel looks for an ASGI callable named "app".
