from __future__ import annotations

import os
import socket
import smtplib
import time
from email.message import EmailMessage


def smtp_configured() -> bool:
    return bool(os.getenv("SMTP_HOST"))


def _create_ipv4_connection(host: str, port: int, timeout: float) -> socket.socket:
    last_error: OSError | None = None
    for res in socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM):
        af, socktype, proto, _, sa = res
        sock = socket.socket(af, socktype, proto)
        sock.settimeout(timeout)
        try:
            sock.connect(sa)
            return sock
        except OSError as e:
            last_error = e
            try:
                sock.close()
            except Exception:
                pass
    if last_error:
        raise last_error
    raise OSError("Could not resolve SMTP host")


class _IPv4SMTPMixin:
    def _get_socket(self, host: str, port: int, timeout: float):  # type: ignore[override]
        return _create_ipv4_connection(host, port, timeout)


class IPv4SMTP(_IPv4SMTPMixin, smtplib.SMTP):
    pass


class IPv4SMTP_SSL(_IPv4SMTPMixin, smtplib.SMTP_SSL):
    pass


def send_email(*, to_email: str, subject: str, body_text: str) -> None:
    """Send a plain-text email via SMTP using environment variables.

    Required env vars:
    - SMTP_HOST

    Optional:
    - SMTP_PORT (default 587)
    - SMTP_PORTS (comma-separated list, e.g. "587,465"; overrides SMTP_PORT)
    - SMTP_USER
    - SMTP_PASSWORD (or SMTP_PASS)
    - SMTP_FROM (default SMTP_USER or no-reply@localhost)
    - SMTP_USE_TLS (default 1)
    - SMTP_USE_SSL (default 0; auto-enabled when port is 465 if unset)
    - SMTP_FORCE_IPV4 (default 1 on Railway, else 0)
    - SMTP_TIMEOUT (seconds, default 20)
    - SMTP_CONNECT_RETRIES (default 2)
    - SMTP_RETRY_BACKOFF_SECONDS (default 1)
    - SMTP_DEBUG (default 0)
    """

    host = os.getenv("SMTP_HOST")
    if not host:
        raise RuntimeError("SMTP_HOST not configured")

    # Ports: either a fallback list SMTP_PORTS, or SMTP_PORT.
    # Backward-compat: allow SMTP_PORT to be comma-separated (e.g. "587,465").
    ports_env = os.getenv("SMTP_PORTS")
    if ports_env:
        ports: list[int] = []
        for raw in ports_env.split(","):
            raw = raw.strip()
            if not raw:
                continue
            ports.append(int(raw))
        if not ports:
            raise RuntimeError("SMTP_PORTS is set but empty")
    else:
        raw_port = os.getenv("SMTP_PORT", "587").strip()
        if "," in raw_port:
            ports = [int(p.strip()) for p in raw_port.split(",") if p.strip()]
            if not ports:
                raise RuntimeError("SMTP_PORT is set but empty")
        else:
            ports = [int(raw_port)]

    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD") or os.getenv("SMTP_PASS")
    from_email = os.getenv("SMTP_FROM") or user or "no-reply@localhost"

    use_tls_default = os.getenv("SMTP_USE_TLS", "1") == "1"
    use_ssl_env = os.getenv("SMTP_USE_SSL")
    force_ipv4 = os.getenv("SMTP_FORCE_IPV4", "1" if os.getenv("RAILWAY_ENVIRONMENT") else "0") == "1"

    msg = EmailMessage()
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body_text)

    smtp_timeout = float(os.getenv("SMTP_TIMEOUT", "20"))
    connect_retries = int(os.getenv("SMTP_CONNECT_RETRIES", "2"))
    backoff_seconds = float(os.getenv("SMTP_RETRY_BACKOFF_SECONDS", "1"))
    debug = os.getenv("SMTP_DEBUG", "0") == "1"

    if debug:
        try:
            infos = socket.getaddrinfo(host, ports[0], 0, socket.SOCK_STREAM)
            addrs = sorted({info[4][0] for info in infos if info and info[4]})
            print(
                f"📧 SMTP_DEBUG: host={host} resolved_addrs={addrs} ports={ports} "
                f"timeout={smtp_timeout}s force_ipv4={force_ipv4}"
            )
        except Exception as e:
            print(f"📧 SMTP_DEBUG: could not resolve host={host}: {type(e).__name__}: {e}")

    last_error: Exception | None = None

    def _attempt_send(port: int) -> None:
        nonlocal last_error
        # If SMTP_USE_SSL is explicitly set, respect it; otherwise default SSL on port 465.
        use_ssl = (use_ssl_env == "1") if use_ssl_env is not None else (port == 465)
        use_tls = use_tls_default and (not use_ssl)

        server: smtplib.SMTP
        if use_ssl:
            server = (IPv4SMTP_SSL if force_ipv4 else smtplib.SMTP_SSL)(host, port, timeout=smtp_timeout)
        else:
            server = (IPv4SMTP if force_ipv4 else smtplib.SMTP)(host, port, timeout=smtp_timeout)

        try:
            step = "ehlo"
            server.ehlo()
            if use_tls:
                step = "starttls"
                server.starttls()
                step = "ehlo_after_starttls"
                server.ehlo()

            if user and password:
                step = "login"
                server.login(user, password)

            step = "send_message"
            server.send_message(msg)
        except Exception as e:
            last_error = e
            raise RuntimeError(
                f"SMTP step failed: step={locals().get('step', 'connect')} host={host} port={port} "
                f"use_ssl={use_ssl} use_tls={use_tls} timeout={smtp_timeout}s error={type(e).__name__}: {e}"
            ) from e
        finally:
            try:
                server.quit()
            except Exception:
                pass

    # Try ports sequentially; retry each port a few times.
    for port in ports:
        for attempt in range(1, connect_retries + 1):
            try:
                _attempt_send(port)
                return
            except (socket.timeout, TimeoutError, smtplib.SMTPServerDisconnected, OSError, RuntimeError) as e:
                last_error = e
                print(
                    "⚠️  SMTP send attempt failed: "
                    f"host={host} port={port} attempt={attempt}/{connect_retries} "
                    f"timeout={smtp_timeout}s force_ipv4={force_ipv4} error={type(e).__name__}: {e}"
                )
                if attempt < connect_retries:
                    time.sleep(backoff_seconds)
            except Exception as e:
                # Non-retryable error (auth, TLS, etc.)
                last_error = e
                raise

    raise RuntimeError(
        "SMTP send failed after retries. "
        f"host={host} ports={ports} timeout={smtp_timeout}s force_ipv4={force_ipv4}. "
        f"Last error: {type(last_error).__name__}: {last_error}"
    )
