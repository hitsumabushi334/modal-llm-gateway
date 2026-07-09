# Implementation Plan: Cloudflare Worker Modal Routing

## Overview

Create a TypeScript Cloudflare Worker that presents one OpenAI-compatible API endpoint and routes `POST /v1/chat/completions` requests to model-specific Modal endpoints based on the request `model` field.

## Goals

- Expose `POST /v1/chat/completions` and `GET /v1/models`.
- Keep client-facing Worker authentication separate from Modal upstream authentication.
- Configure model routing through `MODEL_ROUTES` JSON.
- Pass streaming and non-streaming Modal responses through without changing their OpenAI-compatible shape.
- Include tests, local configuration examples, and deployment notes.

## Non-Goals

- No KV, D1, admin UI, or runtime model management in the initial version.
- No response transformation between Modal-specific and OpenAI-compatible schemas.
- No OpenAI endpoints beyond chat completions and models.

## Design

The Worker authenticates every request with `Authorization: Bearer <CLIENT_API_KEY>`. For chat completions, it parses the request JSON, validates `model`, finds that model in `MODEL_ROUTES`, removes the client Authorization header, attaches Modal auth from `MODAL_API_KEY`, and forwards the unchanged JSON body to the configured Modal URL.

When `MODAL_AUTH_HEADER` is set, the Worker sends that header with the raw `MODAL_API_KEY` value. Otherwise it sends `Authorization: Bearer <MODAL_API_KEY>`. Upstream responses are returned as `new Response(upstream.body, upstream)` so streaming response bodies are not buffered or replaced.

## Testing Strategy

Vitest covers missing and invalid client auth, missing model, unknown model, valid routing, Modal auth header behavior, `/v1/models`, invalid `MODEL_ROUTES`, streaming passthrough, and unsupported routes.