# Modal LLM Gateway

Cloudflare Worker that exposes a single OpenAI-compatible endpoint and routes each request to a model-specific Modal endpoint based on the request `model`.

## API

- `POST /v1/chat/completions`
  - Requires `Authorization: Bearer <CLIENT_API_KEY>`.
  - Reads the JSON request body's `model` field.
  - Forwards the unchanged request body to the Modal endpoint configured for that model.
  - Supports `stream: true` by passing the upstream response body through without buffering.
- `GET /v1/models`
  - Requires `Authorization: Bearer <CLIENT_API_KEY>`.
  - Returns the model names configured in `MODEL_ROUTES`.

## Configuration

Local development uses `.dev.vars`. Copy the example file first:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

Variables and secrets:

- `CLIENT_API_KEY`: Bearer token accepted by the Worker from clients.
- `MODEL_ROUTES`: JSON object mapping OpenAI `model` names to Modal chat completion URLs.
- `MODAL_API_KEY`: Secret used by the Worker when calling Modal.
- `MODAL_AUTH_HEADER`: Optional header name for Modal auth. If omitted, the Worker sends `Authorization: Bearer <MODAL_API_KEY>`.

Example `MODEL_ROUTES`:

```json
{
  "llama-70b": "https://example-user--llama-70b.modal.run/v1/chat/completions",
  "qwen-32b": "https://example-user--qwen-32b.modal.run/v1/chat/completions"
}
```

For production, set secrets with Wrangler:

```powershell
npx wrangler secret put CLIENT_API_KEY
npx wrangler secret put MODAL_API_KEY
npx wrangler secret put MODEL_ROUTES
# Optional
npx wrangler secret put MODAL_AUTH_HEADER
```

## Development

```powershell
npm install
npm test
npm run build
npm run dev
```

## Request Example

```powershell
$body = @{
  model = "llama-70b"
  messages = @(@{ role = "user"; content = "Hello" })
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Uri "http://localhost:8787/v1/chat/completions" `
  -Method Post `
  -Headers @{ Authorization = "Bearer $env:CLIENT_API_KEY"; "Content-Type" = "application/json" } `
  -Body $body
```