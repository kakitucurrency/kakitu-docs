"""Kakitu Python SDK. Request signing is automatic: build a client and call it."""
from . import errors
from .client import DEFAULT_BASE_URL, Kakitu
from .errors import *  # noqa: F401,F403
from .models import (
    CHARGE_STATUSES, EVENT_STATUSES, EVENT_TYPES, ORDER_STATUSES, PAYOUT_STATES,
    PAYOUT_TERMINAL_STATES, Balances, Charge, EIP712Domain, Event, Limits, Merchant, Order,
    Payout, PayoutLimits, PayoutQuote, Quote, Transfer,
)
from .pagination import Page, auto_paginate
from .webhooks import WebhookVerificationError, verify_webhook

__version__ = "0.1.0"
__all__ = [
    "Kakitu", "DEFAULT_BASE_URL", "errors",
    # models
    "Merchant", "Charge", "Transfer", "Balances", "Order", "Limits", "PayoutLimits", "Quote",
    "Event", "Payout", "PayoutQuote", "EIP712Domain",
    # closed sets
    "CHARGE_STATUSES", "ORDER_STATUSES", "EVENT_TYPES", "EVENT_STATUSES", "PAYOUT_STATES",
    "PAYOUT_TERMINAL_STATES",
    # pagination
    "Page", "auto_paginate",
    # webhooks
    "verify_webhook", "WebhookVerificationError",
]
