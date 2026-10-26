---
sidebar_position: 11
title: Webhooks
---

# Webhooks

:::danger Not yet available
**Nothing is sent to your `callback_url` today.** The delivery worker is written and tested but nothing runs it, and the endpoints for reading and replaying events are not registered either. See [the status board](./intro).
:::

The delivery format, event names, signature header and retry schedule now exist in the server, and they are documented in full on the [Events](./events) page: the payload, the `Kakitu-Signature` header and how to verify it, the retry schedule, and the at-least-once contract your receiver has to be built for.

This page is the part that happens before any of that: where deliveries go, and the secret that signs them.

## What exists today

- You can store a `callback_url` on your merchant. It is validated now (https, public, punycode for non-ASCII hostnames) so that a bad one fails at registration. See [Merchants](./merchants#callback-urls).
- When an operator approves your merchant, a **webhook secret** is issued. It signs every delivery.

## The webhook secret is shown once

The secret is shown **once, at approval**, and it is **never retrievable afterwards**. It is not in `GET /v1/merchants/me`, and no endpoint returns it or anything derived from it. Why: a secret that can be read back over an API is not a secret.

Store it in a secret manager the moment you receive it. If you lose it, an operator has to issue a new one; write to kakitu@kakitu.org.

A merchant cannot be approved without a secret, and a delivery is never sent without one: an unsigned delivery is one you could not tell from a forgery, so there is no "just this once".

## Until delivery ships

Poll [`GET /v1/charges`](./collections) once charges are available. Build the receiver against [Events](./events) — that page is read from the server's code, not from an assumed format.
