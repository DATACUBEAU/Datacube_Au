declare const Deno: {
  env: {
    get(key: string): string | undefined;
    toObject(): { [key: string]: string };
  };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  serve(options: { port?: number; hostname?: string; onListen?: (params: { hostname: string; port: number }) => void }, handler: (request: Request) => Response | Promise<Response>): void;
};

// Global types for Deno environment
declare function fetch(input: string | Request | URL, init?: RequestInit): Promise<Response>;
declare class Request {
  constructor(input: string | URL, init?: RequestInit);
  method: string;
  headers: Headers;
  json(): Promise<any>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  formData(): Promise<FormData>;
  blob(): Promise<Blob>;
}
declare class Response {
  constructor(body?: any, init?: ResponseInit);
  static json(data: any, init?: ResponseInit): Response;
  ok: boolean;
  status: number;
  headers: Headers;
  json(): Promise<any>;
  text(): Promise<string>;
}
declare class Headers {
  constructor(init?: any);
  append(name: string, value: string): void;
  delete(name: string): void;
  get(name: string): string | null;
  has(name: string): boolean;
  set(name: string, value: string): void;
}
declare interface RequestInit {
  method?: string;
  headers?: any;
  body?: any;
  signal?: AbortSignal;
}
declare interface ResponseInit {
  status?: number;
  statusText?: string;
  headers?: any;
}
