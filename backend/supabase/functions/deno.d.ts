declare const Deno: {
  env: {
    get(key: string): string | undefined;
    toObject(): { [key: string]: string };
  };
  test(name: string, fn: () => void | Promise<void>): void;
  test(definition: { name: string; fn: () => void | Promise<void> }): void;
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

declare module "https://esm.sh/@supabase/supabase-js@2.39.3" {
  export type SupabaseClient = any;
  export function createClient(...args: any[]): any;
}
declare module "https://deno.land/x/jose@v4.14.4/index.ts";
declare module "https://deno.land/std@0.192.0/testing/asserts.ts" {
  export function assertEquals<T>(actual: T, expected: T, msg?: string): void;
  export function assertRejects(
    fn: () => Promise<unknown> | unknown,
    ErrorClass?: new (...args: any[]) => Error,
    msgIncludes?: string
  ): Promise<void>;
}
declare module "jsr:@std/assert@0.224.0" {
  export function assertEquals<T>(actual: T, expected: T, msg?: string): void;
  export function assertRejects(
    fn: () => Promise<unknown> | unknown,
    ErrorClass?: new (...args: any[]) => Error,
    msgIncludes?: string
  ): Promise<void>;
}
