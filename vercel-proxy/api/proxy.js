import http from "node:http";
import https from "node:https";

function send(response, statusCode, body) {
  response.statusCode = statusCode;
  response.end(body);
}

function getIncomingUrl(request) {
  const hostHeader = request.headers?.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;

  return new URL(request.url ?? "/", `http://${host ?? "localhost"}`);
}

function parseTarget(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const target = new URL(rawUrl);

    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return null;
    }

    return target;
  } catch {
    return null;
  }
}

function proxyGet(target, response) {
  const client = target.protocol === "https:" ? https : http;

  return new Promise((resolve) => {
    const upstreamRequest = client.request(target, { method: "GET" }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
      upstreamResponse.on("end", resolve);
    });

    upstreamRequest.on("error", () => {
      send(response, 502, "Bad Gateway");
      resolve();
    });

    upstreamRequest.end();
  });
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    send(response, 405, "Method Not Allowed");
    return;
  }

  const configuredToken = process.env.PROXY_TOKEN;
  const incomingUrl = getIncomingUrl(request);

  if (!configuredToken || incomingUrl.searchParams.get("token") !== configuredToken) {
    send(response, 401, "Unauthorized");
    return;
  }

  const rawTargetUrl = incomingUrl.searchParams.get("url");
  if (!rawTargetUrl) {
    send(response, 400, "Missing url");
    return;
  }

  const target = parseTarget(rawTargetUrl);
  if (!target) {
    send(response, 400, "Invalid url");
    return;
  }

  await proxyGet(target, response);
}
