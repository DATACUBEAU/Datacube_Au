declare module 'tar' {
  export type ExtractOptions = {
    file: string;
    cwd: string;
  };

  export function x(options: ExtractOptions): Promise<void>;
}
