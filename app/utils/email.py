from __future__ import annotations

import os
import socket
import smtplib
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
    - SMTP_USER
    - SMTP_PASSWORD (or SMTP_PASS)
    - SMTP_FROM (default SMTP_USER or no-reply@localhost)
    - SMTP_USE_TLS (default 1)
    - SMTP_USE_SSL (default 0)
    - SMTP_FORCE_IPV4 (default 1 on Railway, else 0)
    """

    host = os.getenv("SMTP_HOST")
    if not host:
        raise RuntimeError("SMTP_HOST not configured")

    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD") or os.getenv("SMTP_PASS")
    from_email = os.getenv("SMTP_FROM") or user or "no-reply@localhost"

    use_tls = os.getenv("SMTP_USE_TLS", "1") == "1"
    use_ssl = os.getenv("SMTP_USE_SSL", "0") == "1"
    force_ipv4 = os.getenv("SMTP_FORCE_IPV4", "1" if os.getenv("RAILWAY_ENVIRONMENT") else "0") == "1"

    msg = EmailMessage()
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body_text)

    smtp_timeout = 20
    if use_ssl:
        server: smtplib.SMTP = (IPv4SMTP_SSL if force_ipv4 else smtplib.SMTP_SSL)(host, port, timeout=smtp_timeout)
    else:
        server = (IPv4SMTP if force_ipv4 else smtplib.SMTP)(host, port, timeout=smtp_timeout)

    try:
        server.ehlo()
        if use_tls and not use_ssl:
            server.starttls()
            server.ehlo()

        if user and password:
            server.login(user, password)

        server.send_message(msg)
    finally:
        try:
            server.quit()
        except Exception:
            pass
