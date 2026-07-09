import worker, { type Env } from "../src/index";

const defaultEnv: Env = {
  CLIENT_API_KEY: "client-secret",
  MODAL_API_KEY: "modal-secret",
  MODEL_ROUTES: JSON.stringify({
    "llama-70b": "https://llama.example.com/v1/chat/completions",
    "qwen-32b": "https://qwen.example.com/v1/chat/completions"
  })
};

function chatRequest(body: unknown, authorization = "Bearer client-secret"): Request {
  return new Request("https://gateway.example.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization
    },
    body: JSON.stringify(body)
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("Modal LLM gateway Worker", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("rejects requests without Authorization", async () => {
    const request = new Request("https://gateway.example.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "llama-70b", messages: [] })
    });

    const response = await worker.fetch(request, defaultEnv);
    const body = await json(response);

    expect(response.status).toBe(401);
    expect(body.error).toMatchObject({
      type: "authentication_error",
      code: "unauthorized"
    });
  });

  it("rejects requests with an invalid Bearer token", async () => {
    const response = await worker.fetch(
      chatRequest({ model: "llama-70b", messages: [] }, "Bearer wrong"),
      defaultEnv
    );
    const body = await json(response);

    expect(response.status).toBe(401);
    expect(body.error).toMatchObject({
      type: "authentication_error",
      code: "unauthorized"
    });
  });

  it("rejects chat completions without a model", async () => {
    const response = await worker.fetch(chatRequest({ messages: [] }), defaultEnv);
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({
      type: "invalid_request_error",
      code: "missing_model"
    });
  });

  it("rejects chat completions for unknown models", async () => {
    const response = await worker.fetch(
      chatRequest({ model: "missing-model", messages: [] }),
      defaultEnv
    );
    const body = await json(response);

    expect(response.status).toBe(404);
    expect(body.error).toMatchObject({
      type: "invalid_request_error",
      code: "model_not_found"
    });
  });

  it("routes known models to the configured Modal endpoint with Modal auth only", async () => {
    let upstreamRequest: Request | undefined;
    globalThis.fetch = vi.fn(async (request: RequestInfo | URL) => {
      upstreamRequest = request as Request;
      return Response.json({ id: "chatcmpl_1", object: "chat.completion" });
    }) as typeof fetch;

    const response = await worker.fetch(
      chatRequest({ model: "qwen-32b", messages: [{ role: "user", content: "hi" }] }),
      defaultEnv
    );

    expect(response.status).toBe(200);
    expect(upstreamRequest?.url).toBe("https://qwen.example.com/v1/chat/completions");
    expect(upstreamRequest?.headers.get("authorization")).toBe("Bearer modal-secret");
    expect(upstreamRequest?.headers.get("content-type")).toBe("application/json");
    expect(await upstreamRequest?.json()).toEqual({
      model: "qwen-32b",
      messages: [{ role: "user", content: "hi" }]
    });
  });

  it("uses a custom Modal auth header when MODAL_AUTH_HEADER is configured", async () => {
    let upstreamRequest: Request | undefined;
    globalThis.fetch = vi.fn(async (request: RequestInfo | URL) => {
      upstreamRequest = request as Request;
      return Response.json({ ok: true });
    }) as typeof fetch;

    await worker.fetch(
      chatRequest({ model: "llama-70b", messages: [] }),
      { ...defaultEnv, MODAL_AUTH_HEADER: "x-api-key" }
    );

    expect(upstreamRequest?.headers.get("x-api-key")).toBe("modal-secret");
    expect(upstreamRequest?.headers.get("authorization")).toBeNull();
  });

  it("returns OpenAI-compatible models from MODEL_ROUTES", async () => {
    const response = await worker.fetch(
      new Request("https://gateway.example.com/v1/models", {
        headers: { authorization: "Bearer client-secret" }
      }),
      defaultEnv
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.object).toBe("list");
    expect(body.data).toEqual([
      { id: "llama-70b", object: "model", owned_by: "modal" },
      { id: "qwen-32b", object: "model", owned_by: "modal" }
    ]);
  });

  it("returns a configuration error when MODEL_ROUTES is invalid JSON", async () => {
    const response = await worker.fetch(
      chatRequest({ model: "llama-70b", messages: [] }),
      { ...defaultEnv, MODEL_ROUTES: "not json" }
    );
    const body = await json(response);

    expect(response.status).toBe(500);
    expect(body.error).toMatchObject({
      type: "server_error",
      code: "invalid_model_routes"
    });
  });

  it("passes streaming responses through without replacing the body", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: chunk\n\n"));
        controller.close();
      }
    });
    globalThis.fetch = vi.fn(async () => {
      return new Response(stream, {
        headers: { "content-type": "text/event-stream" }
      });
    }) as typeof fetch;

    const response = await worker.fetch(
      chatRequest({ model: "llama-70b", stream: true, messages: [] }),
      defaultEnv
    );

    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toBe("data: chunk\n\n");
  });

  it("returns JSON 404 errors for unsupported paths", async () => {
    const response = await worker.fetch(
      new Request("https://gateway.example.com/v1/completions", {
        headers: { authorization: "Bearer client-secret" }
      }),
      defaultEnv
    );
    const body = await json(response);

    expect(response.status).toBe(404);
    expect(body.error).toMatchObject({
      type: "invalid_request_error",
      code: "not_found"
    });
  });
});
