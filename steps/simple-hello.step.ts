import type { ApiRouteConfig, Handlers } from 'motia';
import { z } from 'zod';

export const config: ApiRouteConfig = {
  name: 'SimpleHello',
  type: 'api',
  path: '/api/hello',
  method: 'GET',
  description: 'Simple endpoint that returns hello message',
  emits: [],
  flows: ['simple-hello'],
  responseSchema: {
    200: z.object({
      message: z.string()
    })
  }
};

export const handler: Handlers['SimpleHello'] = async () => {
  return {
    status: 200,
    body: {
      message: 'Hello'
    }
  };
};

