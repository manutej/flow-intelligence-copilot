declare namespace NodeJS {
  type ProcessEnv = Record<string, string | undefined>;
}

declare const process: {
  readonly env: NodeJS.ProcessEnv;
  readonly argv: string[];
  cwd(): string;
  exit(code?: number): never;
  exitCode?: number;
  readonly stdin: unknown;
  readonly stdout: {
    write(chunk: string): boolean;
  };
};

declare const Buffer: {
  from(data: string, encoding?: string): {
    toString(encoding?: string): string;
  };
};

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf-8'): string;
  export function writeFileSync(
    path: string,
    data: string,
    encoding?: 'utf-8',
  ): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(
    path: string,
    options?: { recursive?: boolean },
  ): void;
  const fsDefault: {
    readFileSync: typeof readFileSync;
    writeFileSync: typeof writeFileSync;
    existsSync: typeof existsSync;
    mkdirSync: typeof mkdirSync;
  };
  export default fsDefault;
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
  export function dirname(p: string): string;
  const pathDefault: {
    resolve: typeof resolve;
    join: typeof join;
    dirname: typeof dirname;
  };
  export default pathDefault;
}

declare module 'node:readline' {
  export interface Interface {
    prompt(): void;
    close(): void;
    on(event: 'line', listener: (line: string) => void | Promise<void>): this;
  }
  export function createInterface(options: {
    input: unknown;
    output?: unknown;
    prompt?: string;
    terminal?: boolean;
  }): Interface;
  const rlDefault: {
    createInterface: typeof createInterface;
  };
  export default rlDefault;
}

declare module 'node:assert/strict' {
  export function equal(actual: unknown, expected: unknown, message?: string): void;
  export function deepEqual(
    actual: unknown,
    expected: unknown,
    message?: string,
  ): void;
  export function ok(value: unknown, message?: string): asserts value;
  const assertDefault: {
    equal: typeof equal;
    deepEqual: typeof deepEqual;
    ok: typeof ok;
  };
  export default assertDefault;
}

declare module 'node:test' {
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
}
