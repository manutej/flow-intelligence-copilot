declare namespace NodeJS {
  type ProcessEnv = Record<string, string | undefined>;
}

declare interface Buffer {
  toString(encoding?: string): string;
  readonly length: number;
}

declare const Buffer: {
  from(data: string | Uint8Array | Buffer, encoding?: string): Buffer;
  concat(list: readonly (Uint8Array | Buffer)[]): Buffer;
  byteLength(string: string, encoding?: string): number;
};

declare const process: {
  readonly env: NodeJS.ProcessEnv;
  readonly argv: string[];
  cwd(): string;
  exit(code?: number): never;
  exitCode?: number;
  readonly execPath: string;
  readonly platform: string;
  readonly versions: Readonly<Record<string, string>>;
  readonly stdin: {
    readonly isTTY?: boolean;
  };
  readonly stdout: {
    readonly isTTY?: boolean;
    write(chunk: string): boolean;
  };
  readonly stderr: {
    readonly isTTY?: boolean;
    write(chunk: string): boolean;
  };
};

declare module "node:fs" {
  export function readFileSync(path: string, encoding?: "utf-8" | "utf8" | string): string;
  export function writeFileSync(
    path: string,
    data: string,
    options?: "utf-8" | "utf8" | { encoding?: "utf-8" | "utf8"; mode?: number },
  ): void;
  export function existsSync(path: string): boolean;
  export function statSync(path: string): { isFile(): boolean; isDirectory(): boolean; size: number };
  export function mkdirSync(
    path: string,
    options?: { recursive?: boolean; mode?: number },
  ): void;
  export function chmodSync(path: string, mode: number): void;
  export function copyFileSync(src: string, dest: string): void;
  export function realpathSync(path: string): string;
  const fsDefault: {
    readFileSync: typeof readFileSync;
    writeFileSync: typeof writeFileSync;
    existsSync: typeof existsSync;
    statSync: typeof statSync;
    mkdirSync: typeof mkdirSync;
    chmodSync: typeof chmodSync;
    copyFileSync: typeof copyFileSync;
    realpathSync: typeof realpathSync;
  };
  export default fsDefault;
}

declare module "node:os" {
  export function homedir(): string;
  export function tmpdir(): string;
  const osDefault: {
    homedir: typeof homedir;
    tmpdir: typeof tmpdir;
  };
  export default osDefault;
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
  export function dirname(p: string): string;
  export function basename(p: string, ext?: string): string;
  export function extname(p: string): string;
  export function normalize(p: string): string;
  const pathDefault: {
    resolve: typeof resolve;
    join: typeof join;
    dirname: typeof dirname;
    basename: typeof basename;
    extname: typeof extname;
    normalize: typeof normalize;
  };
  export default pathDefault;
}

declare module "node:crypto" {
  export function createHash(algorithm: string): {
    update(data: string | Buffer): { digest(encoding: "hex" | "base64"): string };
  };
  export function randomBytes(size: number): Buffer;
  export function scryptSync(password: string | Buffer, salt: string | Buffer, keylen: number): Buffer;
  export function createCipheriv(algorithm: string, key: Buffer, iv: Buffer): {
    update(data: string | Buffer, inputEncoding?: string): Buffer;
    final(): Buffer;
    getAuthTag(): Buffer;
  };
  export function createDecipheriv(algorithm: string, key: Buffer, iv: Buffer): {
    setAuthTag(tag: Buffer): void;
    update(data: Buffer): Buffer;
    final(): Buffer;
  };
  const cryptoDefault: {
    createHash: typeof createHash;
    randomBytes: typeof randomBytes;
    scryptSync: typeof scryptSync;
    createCipheriv: typeof createCipheriv;
    createDecipheriv: typeof createDecipheriv;
  };
  export default cryptoDefault;
}

declare module "node:child_process" {
  export function execFile(
    file: string,
    args: readonly string[],
    options: Record<string, unknown>,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ): void;
  export function spawn(
    command: string,
    args?: readonly string[],
    options?: Record<string, unknown>,
  ): any;
  const cpDefault: {
    execFile: typeof execFile;
    spawn: typeof spawn;
  };
  export default cpDefault;
}

declare module "node:util" {
  export function promisify<T extends (...args: any[]) => any>(fn: T): (...args: any[]) => Promise<any>;
  const utilDefault: {
    promisify: typeof promisify;
  };
  export default utilDefault;
}

declare module "node:http" {
  export interface IncomingMessage {
    url?: string;
    method?: string;
    headers: Record<string, string | string[] | undefined>;
    body?: unknown;
    [Symbol.asyncIterator](): AsyncIterator<Buffer | string>;
    on(event: "data", listener: (chunk: Buffer) => void): this;
    on(event: "end", listener: () => void): this;
  }
  export interface ServerResponse {
    statusCode: number;
    setHeader(name: string, value: string): void;
    writeHead(status: number, headers?: Record<string, string>): this;
    end(chunk?: string | Buffer): void;
  }
  export interface Server {
    listen(port: number, cb?: () => void): this;
    listen(port: number, host: string, cb?: () => void): this;
    address(): import("node:net").AddressInfo | string | null;
    close(cb?: () => void): this;
  }
  export function createServer(
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  ): Server;
  const httpDefault: {
    createServer: typeof createServer;
  };
  export type { Server as HttpServer };
  export default httpDefault;
}

declare module "node:readline" {
  export interface Interface {
    prompt(): void;
    close(): void;
    question(query: string, callback: (answer: string) => void): void;
    on(event: "line", listener: (line: string) => void | Promise<void>): this;
    on(event: "close", listener: () => void): this;
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

declare module "node:assert/strict" {
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

declare module "node:test" {
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
  export function pathToFileURL(path: string): URL;
}

declare module "node:net" {
  export interface AddressInfo {
    address: string;
    family: string;
    port: number;
  }
}
