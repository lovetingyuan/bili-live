import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Writable } from "node:stream";
import test from "node:test";

import handler from "../api/proxy.js";

function createRequest(path, method = "GET") {
  return {
    method,
    url: path,
    headers: {
      host: "localhost",
    },
  };
}

function createResponse() {
  const chunks = [];
  const response = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });

  response.statusCode = 200;
  response.headers = new Map();
  response.setHeader = (name, value) => {
    response.headers.set(name.toLowerCase(), value);
  };
  response.getHeader = (name) => response.headers.get(name.toLowerCase());
  response.writeHead = (statusCode, responseHeaders = {}) => {
    response.statusCode = statusCode;
    for (const [name, value] of Object.entries(responseHeaders)) {
      response.setHeader(name, value);
    }
  };
  response.body = () => Buffer.concat(chunks).toString("utf8");

  return response;
}

async function withUpstream(handlerFn, callback) {
  const server = createServer(handlerFn);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("rejects requests without the configured token", async () => {
  process.env.PROXY_TOKEN = "secret";
  const response = createResponse();

  await handler(createRequest("/api/proxy?url=https%3A%2F%2Fexample.com"), response);

  assert.equal(response.statusCode, 401);
  assert.equal(response.body(), "Unauthorized");
});

test("rejects requests with an incorrect token", async () => {
  process.env.PROXY_TOKEN = "secret";
  const response = createResponse();

  await handler(
    createRequest("/api/proxy?token=wrong&url=https%3A%2F%2Fexample.com"),
    response,
  );

  assert.equal(response.statusCode, 401);
  assert.equal(response.body(), "Unauthorized");
});

test("rejects requests without a url parameter", async () => {
  process.env.PROXY_TOKEN = "secret";
  const response = createResponse();

  await handler(createRequest("/api/proxy?token=secret"), response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body(), "Missing url");
});

test("rejects non-http target urls", async () => {
  process.env.PROXY_TOKEN = "secret";
  const response = createResponse();

  await handler(
    createRequest(`/api/proxy?token=secret&url=${encodeURIComponent("file:///etc/passwd")}`),
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.equal(response.body(), "Invalid url");
});

test("proxies a GET request and forwards upstream status, body, and headers", async () => {
  process.env.PROXY_TOKEN = "secret";

  await withUpstream(
    (request, response) => {
      assert.equal(request.method, "GET");
      assert.equal(request.url, "/resource?x=1");
      response.writeHead(203, {
        "content-type": "text/plain",
        "x-upstream-token": "abc123",
      });
      response.end("upstream body");
    },
    async (upstreamUrl) => {
      const targetUrl = `${upstreamUrl}/resource?x=1`;
      const response = createResponse();

      await handler(
        createRequest(`/api/proxy?token=secret&url=${encodeURIComponent(targetUrl)}`),
        response,
      );

      assert.equal(response.statusCode, 203);
      assert.equal(response.body(), "upstream body");
      assert.equal(response.getHeader("content-type"), "text/plain");
      assert.equal(response.getHeader("x-upstream-token"), "abc123");
    },
  );
});

test("allows only GET requests", async () => {
  process.env.PROXY_TOKEN = "secret";
  const response = createResponse();

  await handler(
    createRequest("/api/proxy?token=secret&url=https%3A%2F%2Fexample.com", "POST"),
    response,
  );

  assert.equal(response.statusCode, 405);
  assert.equal(response.body(), "Method Not Allowed");
});
