from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP, ROUND_UP
import math


EUR_CENT = Decimal("0.01")


@dataclass(frozen=True)
class PricingBreakdown:
    price: Decimal
    payout: Decimal
    platform: Decimal
    stripe_fee: Decimal

    def as_dict(self) -> dict:
        # JSON-friendly (floats with 2 decimals).
        return {
            "price": float(self.price),
            "payout": float(self.payout),
            "platform": float(self.platform),
            "stripe_fee": float(self.stripe_fee),
        }


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    # Lightweight haversine (meters).
    r = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dl / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def _zone_multiplier(lat: float, lng: float) -> Decimal:
    """
    Simple zone model:
    - closer to the city center => higher demand => higher multiplier.
    """
    # Palermo center (matches default map view in frontend).
    center_lat = 38.1157
    center_lng = 13.3615
    d_m = _haversine_m(lat, lng, center_lat, center_lng)

    if d_m <= 2000:
        return Decimal("1.30")
    if d_m <= 5000:
        return Decimal("1.15")
    return Decimal("1.00")


def _time_multiplier(dt: datetime) -> Decimal:
    """
    Simple time/day model (demand-based):
    - weekday peak commute: higher
    - weekend: slightly higher
    - late night: slightly lower
    """
    weekday = dt.weekday()  # 0=Mon..6=Sun
    hour = dt.hour

    is_weekend = weekday >= 5
    if is_weekend:
        if 10 <= hour <= 13 or 18 <= hour <= 22:
            return Decimal("1.20")
        return Decimal("1.10")

    # Weekday
    if 8 <= hour <= 10 or 17 <= hour <= 19:
        return Decimal("1.25")
    if 0 <= hour <= 6:
        return Decimal("0.90")
    return Decimal("1.00")


def _stripe_fee(price: Decimal) -> Decimal:
    # Stripe fee: 1.4% + €0.25
    fee = (price * Decimal("0.014")) + Decimal("0.25")
    return fee.quantize(EUR_CENT, rounding=ROUND_HALF_UP)


def _ceil_to_cent(amount: Decimal) -> Decimal:
    return amount.quantize(EUR_CENT, rounding=ROUND_UP)


def calculate_final_price(lat: float, lng: float, dt: datetime) -> dict:
    """
    Dynamic pricing engine with Stripe-aware guarantees.

    Rules:
    - base_price = 1.20
    - price = base_price * zone_multiplier * time_multiplier
    - minimum price: 1.20
    - stripe fee: 1.4% + 0.25
    - guaranteed net >= 0.90 (payout 0.70 + platform 0.20)

    Returns:
    { price, payout: 0.70, platform: 0.20, stripe_fee }
    """
    base_price = Decimal("1.20")
    payout = Decimal("0.70")
    platform = Decimal("0.20")
    min_net = payout + platform  # 0.90

    zm = _zone_multiplier(float(lat), float(lng))
    tm = _time_multiplier(dt)

    price = base_price * zm * tm
    if price < base_price:
        price = base_price

    # Ensure Stripe + guarantees are covered:
    # net = price - (price*0.014 + 0.25) = price*(1-0.014) - 0.25
    # net >= min_net  =>  price >= (min_net + 0.25) / 0.986
    required = (min_net + Decimal("0.25")) / Decimal("0.986")
    if price < required:
        price = required

    # Charge amounts in cents; round UP so guarantees always hold.
    price = _ceil_to_cent(price)
    fee = _stripe_fee(price)

    # Final safety: if rounding changed economics, bump by 1 cent until net is OK.
    # (This should almost never loop, but it's safe and bounded.)
    for _ in range(20):
        net = price - fee
        if net >= min_net:
            break
        price = price + EUR_CENT
        fee = _stripe_fee(price)

    breakdown = PricingBreakdown(price=price, payout=payout, platform=platform, stripe_fee=fee)
    return breakdown.as_dict()

