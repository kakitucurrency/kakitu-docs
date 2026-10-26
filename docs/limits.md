---
sidebar_position: 10
title: Limits
---

# Limits

## GET /v1/limits

The current withdrawal band: the smallest and largest payout that will be accepted. Signed request, no body, no `Idempotency-Key`.

```json
HTTP 200
{
  "withdrawal": {
    "min_kes": 200,
    "max_kes": 60000,
    "source": "live"
  },
  "max_staleness_seconds": 300,
  "note": "The withdrawal band is cached and refreshed about every five minutes, so after the payout route is switched it can be up to five minutes out of date. A quote, not this band, is what decides whether an amount is accepted."
}
```

## `source` says whether the band is real

| `source` | Meaning |
|---|---|
| `live` | The band was read from the payout route itself. These are the real numbers. |
| `estimated` | The payout route has not answered, so these are our configured fallback. Treat them as a guide. |

We publish the fallback rather than an error, because an app that can show a customer *roughly* what is allowed is more useful than one that shows nothing. But we label it, because a guess presented as a fact is worse than both.

## `max_staleness_seconds` is a promise, not a timestamp

It is **the longest this band can be behind the payout route** — not how old this particular answer is.

The band is cached and refreshed on a timer. If an operator switches the payout route, the cache can describe the previous one until the next refresh. `max_staleness_seconds` is that refresh interval, read from the same setting that drives the refresh, so it cannot quietly promise a freshness nobody is maintaining.

Today it is `300`. Do not hardcode that: read it. If an operator widens the refresh interval, this number widens with it, and code that assumed five minutes would be wrong without anything looking broken.

## The band does not decide anything

**A [quote](./quotes) decides whether an amount is accepted. This band does not.**

Use it to shape a form — to grey out an obviously impossible amount, or to tell someone the rough range before they type. Do not use it to promise that a particular amount will go through, and do not treat a quote that disagrees with it as a bug. The quote is live; this is a cache.

## Errors

| `code` | HTTP | When |
|---|---|---|
| `unauthorized` | 401 | The request was not signed. |
| `rail_unavailable` | 503 | The band is unavailable. Retry shortly. |

## Limits this endpoint does not cover

It publishes the **withdrawal** band and nothing else. These live elsewhere:

| Limit | Where |
|---|---|
| Your daily collection cap and per-charge maximum | `daily_cap_kes` and `per_charge_max_kes` in [`GET /v1/merchants/me`](./merchants) |
| The largest single [transfer](./transfers) | `relay_max_per_tx_kes` in `GET /config` |
| Requests per minute, prompts per payer, charges per minute | [Rate limits](./rate-limits) |
