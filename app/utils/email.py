from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage


def smtp_configured() -> bool:
    return bool(os.getenv("SMTP_HOST"))


def send_email(*, to_email: str, subject: str, body_text: str) -> None:
    """Send a plain-text email via SMTP using environment variables.

    Required env vars:
    - SMTP_HOST

    Optional:
    - SMTP_PORT (default 587)
    - SMTP_USER
    - SMTP_PASSWORD
    - SMTP_FROM (default SMTP_USER or no-reply@localhost)
    - SMTP_USE_TLS (default 1)
    - SMTP_USE_SSL (default 0)
    """

    host = os.getenv("SMTP_HOST")
    if not host:
        raise RuntimeError("SMTP_HOST not configured")

    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    from_email = os.getenv("SMTP_FROM") or user or "no-reply@localhost"

    use_tls = os.getenv("SMTP_USE_TLS", "1") == "1"
    use_ssl = os.getenv("SMTP_USE_SSL", "0") == "1"

    msg = EmailMessage()
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body_text)

    if use_ssl:
        server: smtplib.SMTP = smtplib.SMTP_SSL(host, port, timeout=20)
    else:
        server = smtplib.SMTP(host, port, timeout=20)

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
