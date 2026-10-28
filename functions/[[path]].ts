/** Cloudflare Pages Functions catch-all: same Worker handler and D1 binding. */
import worker from '../src/index';
import { Env } from '../src/config';

export const onRequest: PagesFunction<Env> = async (context) => {
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => context.waitUntil(promise),
    passThroughOnException: () => {},
  } as ExecutionContext;
  return worker.fetch(context.request, context.env, ctx);
};
