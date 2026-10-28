/** Honest capabilities: implementation evidence is not the same as a live deployment. */
export interface ProviderCapability {
  id: string;
  label: string;
  application: string;
  storage: string;
  proxy: string;
  deployment: string;
  status: 'implemented-not-deployed' | 'partial';
}

export function providerCapabilities(): ProviderCapability[] {
  return [
    {
      id: 'workers', label: 'Cloudflare Workers',
      application: 'Management API, UI and data plane in the Workers runtime',
      storage: 'D1 binding GZ_DB required',
      proxy: 'VLESS and Trojan over WebSocket/TLS; TCP only',
      deployment: 'Wrangler configuration; real account deployment not verified',
      status: 'implemented-not-deployed',
    },
    {
      id: 'pages', label: 'Cloudflare Pages Functions',
      application: 'Pages Functions adapter; static Pages alone has no backend',
      storage: 'D1 binding GZ_DB required',
      proxy: 'Same code as Workers; live Pages socket path not verified',
      deployment: 'Pages Functions build; real account deployment not verified',
      status: 'implemented-not-deployed',
    },
    {
      id: 'fastedge', label: 'Gcore FastEdge',
      application: 'Separate geo-page HTTP Wasm only; not the management panel',
      storage: 'FastEdge management storage adapter not implemented',
      proxy: 'Proxy data plane not implemented for FastEdge',
      deployment: 'Build and upload Wasm; live deployment not verified',
      status: 'partial',
    },
  ];
}
