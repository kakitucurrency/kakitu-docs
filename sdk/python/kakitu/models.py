from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Merchant:
    """A merchant record (``GET /v1/merchants/me``). ``state`` starts as ``"pending"``."""
    address: str
    business_name: str
    contact_email: str
    contact_phone: str
    callback_url: str
    state: str
    daily_cap_kes: int
    per_charge_max_kes: int

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Merchant":
        return cls(
            address=d["address"], business_name=d["business_name"],
            contact_email=d.get("contact_email", ""), contact_phone=d.get("contact_phone", ""),
            callback_url=d.get("callback_url", ""), state=d["state"],
            daily_cap_kes=int(d.get("daily_cap_kes", 0)), per_charge_max_kes=int(d.get("per_charge_max_kes", 0)),
        )


#: Charge statuses (charge/status.go): pending, prompted, paid, settled, failed, expired, cancelled.
CHARGE_STATUSES = ("pending", "prompted", "paid", "settled", "failed", "expired", "cancelled")


@dataclass(frozen=True)
class Charge:
    """NOT YET AVAILABLE. The response shape is not final; ``raw`` holds the full JSON."""
    id: str
    status: str
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Charge":
        return cls(id=str(d.get("id", "")), status=str(d.get("status", "")), raw=d)
