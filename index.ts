/**
 * Welcome to Cloudflare Workers!
 *
 * This is a template for a Scheduled Worker: a Worker that can run on a
 * configurable interval:
 * https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Run `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"` to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { checkLive, wechatNotify, wechatNotify2 } from "./check-live";

import { DurableObject } from "cloudflare:workers";

export class MyDurableObject extends DurableObject<Env> {
  /**
   * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
   * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
   *
   * @param ctx - The interface for interacting with Durable Object state
   * @param env - The interface to reference bindings declared in wrangler.jsonc
   */
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /**
   * The Durable Object exposes an RPC method sayHello which will be invoked when when a Durable
   *  Object instance receives a request from a Worker via the same method invocation on the stub
   *
   * @param name - The name provided to a Durable Object instance from a Worker
   * @returns The greeting to be sent back to the Worker
   */
  sayHello(name: string) {
    return `Hello, ${name}!`;
  }

  async setData<T>(key: string, value: T) {
    await this.ctx.storage.put(key, value);
  }

  async getData<T>(key: string, defaultValue?: T) {
    const val = await this.ctx.storage.get(key);
    if (val === undefined) {
      await this.ctx.storage.put(key, defaultValue);
      return defaultValue;
    }
    return val;
  }
}

export default {
  // The scheduled handler is invoked at the interval set in our wrangler.toml's
  // [[triggers]] configuration.
  async scheduled(event, env, ctx): Promise<void> {
    return checkLive(env)
      .then(() => {})
      .catch((err: any) => {
        wechatNotify2("检查bili live失败", err?.message ?? "未知错误", env);
      });
  },
  async fetch(request, env) {
    if (!request.url.includes(env.SAFE_TOKEN)) {
      return new Response("failed", {
        status: 400,
      });
    }
    if (request.url.includes("notify2")) {
      return wechatNotify2("test", "success", env);
    }
    if (request.url.includes("notify")) {
      return wechatNotify("test", "success", env);
    }
    if (request.url.includes("inspect")) {
      const id: DurableObjectId = env.MY_DURABLE_OBJECT.idFromName("bili-live");
      const stub = env.MY_DURABLE_OBJECT.get(id);
      const data = await stub.getData("liveUps");

      return Response.json({
        data,
        env,
        ups: await env.KV_BILI_LIVE.get("up_ids"),
      });
    }
    return checkLive(env).then((res: any) => {
      return Response.json(res);
    });
  },
} satisfies ExportedHandler<Env>;
