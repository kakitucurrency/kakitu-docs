---
sidebar_position: 6
title: Webhooks
---

# Webhooks

:::danger Not yet available
**Webhook delivery is not implemented.** Nothing is sent to your `callback_url` today. The delivery format, event names, signature header and retry schedule are not defined in the server yet, so they are not documented here. Inventing them would repeat the mistake that got the last docs withdrawn. They will be published with the feature.
:::

## What exists today

- You can store a `callback_url` on your merchant. It is validated now (https, public, punycode for non-ASCII hostnames) so that a bad one fails at registration. See [Merchants](./merchants#callback-urls).
- When an operator approves your merchant, a **webhook secret** is issued. It will be used to sign deliveries.

## The webhook secret is shown once

The secret is shown **once, at approval**, and it is **never retrievable afterwards**. It is not in `GET /v1/merchants/me`, and no endpoint returns it or anything derived from it. Why: a secret that can be read back over an API is not a secret.

Store it in a secret manager the moment you receive it. If you lose it, an operator has to issue a new one; write to kakitu@kakitu.org.

## Until delivery ships

Poll `GET /v1/charges/{id}` once charges are available. Do not build on an assumed webhook format.
