declare module 'tar' {
  export type TarEntry = {
    path?: string;
    type?: string;
    linkpath?: string;
  };

  export type ListOptions = {
    file: string;
    onentry?: (entry: TarEntry) => void;
  };

  export type ExtractOptions = {
    file: string;
    cwd: string;
  };

  export function t(options: ListOptions): Promise<void>;
  export function x(options: ExtractOptions): Promise<void>;
}
