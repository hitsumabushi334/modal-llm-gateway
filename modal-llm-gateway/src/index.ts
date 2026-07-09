export interface Env {
  CLIENT_API_KEY: string;
  MODEL_ROUTES: string;
  MODAL_API_KEY: string;
  MODAL_AUTH_HEADER?: string;
}

type ModelRoutes = Record<string, string>;

type OpenAiErrorType =
  | "authentication_error"
  | "invalid_request_error"
  | "server_error";

interface OpenAiErrorBody {
  error: {
    message: string;
    type: OpenAiErrorType;
    param: string | null;
    code: string;
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function errorResponse(
  status: number,
  type: OpenAiErrorType,
  code: string,
  message: string,
  param: string | null = null
): Response {
  const body: OpenAiErrorBody = {
    error: { message, type, param, code }
  };

  return jsonResponse(body, status);
}

function authenticate(request: Request, env: Env): Response | null {
  const authorization = request.headers.get("authorization");
  const prefix = "Bearer ";

  if (!authorization?.startsWith(prefix)) {
    return errorResponse(
      401,
      "authentication_error",
      "unauthorized",
      "Missing or invalid Authorization bearer token."
    );
  }

  const token = authorization.slice(prefix.length);
  if (token !== env.CLIENT_API_KEY) {
    return errorResponse(
      401,
      "authentication_error",
      "unauthorized",
      "Missing or invalid Authorization bearer token."
    );
  }

  return null;
}

function parseModelRoutes(env: Env): ModelRoutes | Response {
  let parsed: unknown;

  try {
    parsed = JSON.parse(env.MODEL_ROUTES);
  } catch {
    return errorResponse(
      500,
      "server_error",
      "invalid_model_routes",
      "MODEL_ROUTES must be a valid JSON object mapping model names to Modal URLs."
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return errorResponse(
      500,
      "server_error",
      "invalid_model_routes",
      "MODEL_ROUTES must be a valid JSON object mapping model names to Modal URLs."
    );
  }

  const routes = parsed as Record<string, unknown>;
  for (const [model, endpoint] of Object.entries(routes)) {
    if (typeof endpoint !== "string" || endpoint.length === 0) {
      return errorResponse(
        500,
        "server_error",
        "invalid_model_routes",
        `MODEL_ROUTES entry for '${model}' must be a non-empty URL string.`
      );
    }
  }

  return routes as ModelRoutes;
}

function modalAuthHeaders(env: Env): HeadersInit | Response {
  if (!env.MODAL_API_KEY) {
    return errorResponse(
      500,
      "server_error",
      "missing_modal_api_key",
      "MODAL_API_KEY is not configured."
    );
  }

  const headerName = env.MODAL_AUTH_HEADER?.trim();
  if (headerName) {
    return { [headerName]: env.MODAL_API_KEY };
  }

  return { authorization: `Bearer ${env.MODAL_API_KEY}` };
}

function copyForwardHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("content-length");
  headers.delete("host");
  return headers;
}

async function handleChatCompletions(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse(
      405,
      "invalid_request_error",
      "method_not_allowed",
      "Use POST for /v1/chat/completions."
    );
  }

  const routes = parseModelRoutes(env);
  if (routes instanceof Response) {
    return routes;
  }

  const rawBody = await request.text();
  let body: unknown;

  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse(
      400,
      "invalid_request_error",
      "invalid_json",
      "Request body must be valid JSON."
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse(
      400,
      "invalid_request_error",
      "invalid_request_body",
      "Request body must be a JSON object."
    );
  }

  const model = (body as { model?: unknown }).model;
  if (typeof model !== "string" || model.length === 0) {
    return errorResponse(
      400,
      "invalid_request_error",
      "missing_model",
      "The 'model' field is required.",
      "model"
    );
  }

  const upstreamUrl = routes[model];
  if (!upstreamUrl) {
    return errorResponse(
      404,
      "invalid_request_error",
      "model_not_found",
      `Model '${model}' is not configured for this gateway.`,
      "model"
    );
  }

  const authHeaders = modalAuthHeaders(env);
  if (authHeaders instanceof Response) {
    return authHeaders;
  }

  const upstreamHeaders = copyForwardHeaders(request);
  for (const [name, value] of Object.entries(authHeaders)) {
    upstreamHeaders.set(name, value);
  }

  const upstreamResponse = await fetch(
    new Request(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: rawBody
    })
  );

  return new Response(upstreamResponse.body, upstreamResponse);
}

function handleModels(env: Env): Response {
  const routes = parseModelRoutes(env);
  if (routes instanceof Response) {
    return routes;
  }

  return jsonResponse({
    object: "list",
    data: Object.keys(routes).map((id) => ({
      id,
      object: "model",
      owned_by: "modal"
    }))
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const authError = authenticate(request, env);
    if (authError) {
      return authError;
    }

    const url = new URL(request.url);

    if (url.pathname === "/v1/chat/completions") {
      return handleChatCompletions(request, env);
    }

    if (url.pathname === "/v1/models") {
      if (request.method !== "GET") {
        return errorResponse(
          405,
          "invalid_request_error",
          "method_not_allowed",
          "Use GET for /v1/models."
        );
      }

      return handleModels(env);
    }

    return errorResponse(
      404,
      "invalid_request_error",
      "not_found",
      `No route found for ${url.pathname}.`
    );
  }
};