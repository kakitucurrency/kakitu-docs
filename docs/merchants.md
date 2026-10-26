---
sidebar_position: 4
title: Merchants
---

# Merchants

A merchant is a business that collects money. It is identified by the wallet address that signs the request, and that same address is where its collections are paid. Both endpoints below are live.

## States

| `state` | Meaning |
|---|---|
| `pending` | Registered, not reviewed. Collections are refused. |
| `approved` | An operator reviewed and approved it. Collections can work. |
| `rejected` | An operator declined it. |
| `suspended` | An operator stopped it. Collections are refused. |

You cannot change `state` yourself. See [Going live](./going-live).

### If an operator entered you by hand

An operator can create a merchant from an address you give them — for a business that has no developer, so the paperwork can be done before anyone writes code. That row is created `pending`, with your details already filled in.

**It cannot be approved until a correctly signed request from that address reaches `POST /v1/merchants`.** So you still have to make one signed call, even though your details are already there. Send the registration as below; it will update the existing row rather than create a second one.

That gate is not bureaucracy. The address is where your money is paid, **on chain**. An operator typing it proves the characters were typed — not that you hold the key, and not that the address is right. If it is wrong by one character, or it is a wallet you cannot spend from, every payment you ever take is gone and there is nobody to ask for it back. A signed request is the only thing that proves the key is yours. It approves nothing by itself; it only clears the way for the operator's decision.

## POST /v1/merchants

Registers the signing wallet as a merchant, or updates its details. Signed request; no `Idempotency-Key` is needed because registration does not move money.

If you have not written the signing code yet, **[register in your browser](/signup)** instead: it generates a key, signs this request and submits it. It calls this same endpoint with the same rules, so everything below still applies.

| Field | Type | Rules |
|---|---|---|
| `business_name` | string, required | 1 to 100 characters. No control, invisible or text-direction characters (they would be rendered in a payer's M-Pesa prompt). |
| `contact_email` | string, required | A plain address such as `a@b.co`. `Name <a@b.co>` is refused. At most 254 characters. |
| `contact_phone` | string, optional | At most 20 characters: digits, `+`, spaces and hyphens only. |
| `callback_url` | string, optional | See [callback URLs](#callback-urls). |

The body is limited to 16 KiB (`request_too_large`, 413).

**Unknown fields are refused** with `invalid_request`, and the message names the field. A misspelt key fails loudly instead of being ignored. The exception is a small set of fields you must never set: `state`, `webhook_secret`, `daily_cap_kes`, `per_charge_max_kes`, `address`, `reviewed_by`, `review_note`. If you send one it is accepted and **dropped**, and the answer shows the real stored state. A client that sends `"state":"approved"` gets `201` with `"state":"pending"`.

Response: `201` for a first registration, `200` for an update. The body is the merchant record:

```json
{
  "address": "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
  "business_name": "Mama Njeri Groceries",
  "contact_email": "njeri@example.com",
  "contact_phone": "",
  "callback_url": "",
  "state": "pending",
  "daily_cap_kes": 0,
  "per_charge_max_kes": 0
}
```

`daily_cap_kes` and `per_charge_max_kes` are set by an operator. `0` means no per-merchant value has been set, and the platform default then applies. The webhook secret is never in this record.

### Clearing and leaving fields alone

For `contact_phone` and `callback_url` there are three cases, and they differ:

| You send | Result |
|---|---|
| the field absent | Stored value is **unchanged** |
| `null` | Stored value is **unchanged** |
| `""` (empty string) | Stored value is **cleared** |
| a value | Stored value is replaced |

Why: an omitted or misspelt field must never silently wipe a webhook URL and stop deliveries with nobody told. To clear, say so explicitly with `""`.

### business_name is frozen

Once a merchant is past `pending`, `business_name` cannot be changed through the API. A request with a different name is refused with `409 merchant_name_frozen` and **nothing in that request is saved**. Why: the payer reads this name in the M-Pesa prompt when deciding whether to type a PIN, so it is fixed after vetting. A rename needs an operator: write to kakitu@kakitu.org.

Resubmitting the **same** name with new contact details is fine.

In the rare race where an operator approves you between our check and our write, you also get `merchant_name_frozen`, but your other fields were saved, and the message says so.

### Callback URLs

`callback_url` is where webhooks will be delivered (see [Webhooks](./webhooks)). It is validated at registration, so a bad one fails now rather than silently later. It must be:

- `https`, on port 443, at most 512 characters, no credentials in the URL, no whitespace.
- **Public.** Loopback, private, link-local and other reserved addresses are refused, as are `localhost`, `.local`, `.internal`, `.lan` and similar names, and wildcard-DNS names such as `nip.io` that resolve to private addresses. The reason is that webhooks are fetched by our servers, and a private target would let a callback URL point us at internal systems.
- **ASCII in the hostname.** A non-ASCII hostname is refused. Give it in **punycode**: `https://xn--exmple-cua.com/hook`, not `https://exämple.com/hook`. Why: the same name can be written in visually identical ways, and we validate what we will actually connect to.

Failures return `invalid_request` with a message saying which rule was broken.

## GET /v1/merchants/me

Returns the merchant record for the signing wallet. No body.

- `200`: the record above.
- `404 merchant_not_registered`: this wallet has not registered.

Use it to read your `state`, which is how you know you have been approved.
