// Copyright 2020 Carton contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { WASI, File, OpenFile, ConsoleStdout, PreopenDirectory, WASIProcExit, Inode, Directory } from "@bjorn3/browser_wasi_shim";
import type { SwiftRuntime, SwiftRuntimeConstructor } from "./JavaScriptKit_JavaScriptKit.resources/Runtime/index";
import { polyfill as polyfillWebAssemblyTypeReflection } from "wasm-imports-parser/polyfill";
import type { ImportEntry } from "wasm-imports-parser";
import { AddressInfo } from "node:net";

// Apply polyfill for WebAssembly Type Reflection JS API to inspect imported memory info.
// https://github.com/WebAssembly/js-types/blob/main/proposals/js-types/Overview.md
export const WebAssembly = polyfillWebAssemblyTypeReflection(globalThis.WebAssembly);

class LineDecoder {
  constructor(onLine: (line: string) => void) {
    this.decoder = new TextDecoder("utf-8", { fatal: false });
    this.buffer = "";
    this.onLine = onLine;
  }

  private decoder: TextDecoder;
  private buffer: string;
  private onLine: (line: string) => void;

  send(chunk: Uint8Array) {
    this.buffer += this.decoder.decode(chunk, { stream: true });

    const lines = this.buffer.split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      this.onLine(lines[i]);
    }

    this.buffer = lines[lines.length - 1];
  }
}

export type InstantiationOptions = {
  module: WebAssembly.Module;
  args?: string[];
  env?: Record<string, string>;
  rootFs?: Map<string, Inode>;
  onStdout?: (chunk: Uint8Array) => void;
  onStdoutLine?: (line: string) => void;
  onStderr?: (chunk: Uint8Array) => void;
  onStderrLine?: (line: string) => void;
  swift?: SwiftRuntime;
  SwiftRuntime?: SwiftRuntimeConstructor;
};

export async function instantiate(rawOptions: InstantiationOptions, extraWasmImports?: WebAssembly.Imports): Promise<{
  instance: WebAssembly.Instance;
  rootFs: Map<string, Inode>;
}> {
  const options: InstantiationOptions = defaultInstantiationOptions(rawOptions);

  let swift: SwiftRuntime | undefined = options.swift;
  if (!swift && options.SwiftRuntime) {
    let sharedMemory = false;
    for (const importEntry of WebAssembly.Module.imports(options.module)) {
        if (importEntry.module === "env" && importEntry.name === "memory" && importEntry.kind === "memory") {
            sharedMemory = true;
            break;
        }
    }
    swift = new options.SwiftRuntime({ sharedMemory });
  }

  let stdoutLine: LineDecoder | undefined = undefined;
  if (options.onStdoutLine != null) {
    stdoutLine = new LineDecoder(options.onStdoutLine);
  }
  const stdout = new ConsoleStdout((chunk) => {
    options.onStdout?.call(undefined, chunk);
    stdoutLine?.send(chunk);
  });

  let stderrLine: LineDecoder | undefined = undefined;
  if (options.onStderrLine != null) {
    stderrLine = new LineDecoder(options.onStderrLine);
  }
  const stderr = new ConsoleStdout((chunk) => {
    options.onStderr?.call(undefined, chunk);
    stderrLine?.send(chunk);
  });

  const args = options.args || [];
  const rootFs = options.rootFs || new Map<string, Inode>();
  const fds = [
    new OpenFile(new File([])), // stdin
    stdout,
    stderr,
    new PreopenDirectory("/", rootFs),
  ];

  // Convert env Record to array of "key=value" strings
  const envs = options.env ? Object.entries(options.env).map(([key, value]) => `${key}=${value}`) : [];

  const wasi = new WASI(args, envs, fds, {
    debug: false
  });

  const createWasmImportObject = (
    extraWasmImports: WebAssembly.Imports | undefined,
    module: WebAssembly.Module,
  ): WebAssembly.Imports => {
    const importObject: WebAssembly.Imports = {
      wasi_snapshot_preview1: wasi.wasiImport,
    };

    if (swift) {
      importObject.javascript_kit = swift.wasmImports as unknown as WebAssembly.ModuleImports;
    }

    if (extraWasmImports) {
      for (const moduleName in extraWasmImports) {
        if (!importObject[moduleName]) {
          importObject[moduleName] = {};
        }
        for (const entry in extraWasmImports[moduleName]) {
          importObject[moduleName][entry] = extraWasmImports[moduleName][entry];
        }
      }
    }

    for (const _importEntry of WebAssembly.Module.imports(module)) {
      const importEntry = _importEntry as ImportEntry;
      if (!importObject[importEntry.module]) {
        importObject[importEntry.module] = {};
      }
      // Skip if the import is already provided
      if (importObject[importEntry.module][importEntry.name]) {
        continue;
      }
      if (importEntry.kind == "function") {
        importObject[importEntry.module][importEntry.name] = () => {
          throw new Error(`Imported function ${importEntry.module}.${importEntry.name} not implemented`);
        }
      } else if (importEntry.kind == "memory" && importEntry.module == "env" && importEntry.name == "memory") {
        // Create a new WebAssembly.Memory instance with the same descriptor as the imported memory
        const type = importEntry.type
        const descriptor: WebAssembly.MemoryDescriptor = {
          initial: type.minimum,
          maximum: type.maximum,
          shared: type.shared,
        }
        importObject[importEntry.module][importEntry.name] = new WebAssembly.Memory(descriptor);
      }
    }

    return importObject;
  };

  const importObject = createWasmImportObject(extraWasmImports, options.module);
  const instance = await WebAssembly.instantiate(options.module, importObject);

  if (swift && instance.exports.swjs_library_version) {
    swift.setInstance(instance);
  }

  if (typeof instance.exports._start === "function") {
    // Start the WebAssembly WASI instance
    wasi.start(instance as any);
  } else if (typeof instance.exports._initialize == "function") {
    // Initialize and start Reactor
    wasi.initialize(instance as any);
    if (swift && swift.main) {
      // Use JavaScriptKit's entry point if it's available
      swift.main();
    } else {
      // For older versions of JavaScriptKit, we need to handle it manually
      if (typeof instance.exports.main === "function") {
        instance.exports.main();
      } else if (typeof instance.exports.__main_argc_argv === "function") {
        // Swift 6.0 and later use `__main_argc_argv` instead of `main`.
        instance.exports.__main_argc_argv(0, 0);
      }
    }
  }

  return { instance, rootFs };
}

function defaultInstantiationOptions(options: InstantiationOptions): InstantiationOptions {
  if (options.args == null) {
    options.args = ["main.wasm"];
  }
  const isNodeJs = (typeof process !== 'undefined') && (process.release.name === 'node');
  const isWebBrowser = (typeof window !== 'undefined');
  if (isNodeJs) {
    if (!options.onStdout) {
      options.onStdout = (chunk) => process.stdout.write(chunk);
    }
    if (!options.onStderr) {
      options.onStderr = (chunk) => process.stderr.write(chunk);
    }
  } else if (isWebBrowser) {
    if (!options.onStdoutLine) {
      options.onStdoutLine = (line) => console.log(line);
    }
    if (!options.onStderrLine) {
      options.onStderrLine = (line) => console.warn(line);
    }
  }
  return options;
}

type Instantiate = (options: Omit<InstantiationOptions, "module">, extraWasmImports?: WebAssembly.Imports) => Promise<{
  instance: WebAssembly.Instance;
  rootFs: Map<string, Inode>;
}>;

async function extractAndSaveFile(rootFs: Map<string, Inode>, path: string): Promise<boolean> {
  const getFile = (parent: Map<string, Inode>, components: string[], index: number): Inode | undefined => {
    const name = components[index];
    const entry = parent.get(name);
    if (entry === undefined) {
      return undefined;
    }
    if (index === components.length - 1) {
      return entry;
    }
    if (entry instanceof Directory) {
      return getFile(entry.contents, components, index + 1);
    }
    throw new Error(`Expected directory at ${components.slice(0, index).join("/")}`);
  }

  const components = path.split("/");
  const file = getFile(rootFs, components, 0);
  if (file === undefined) {
    return false;
  }
  if (file instanceof File) {
    const fs = await import("node:fs/promises");
    console.log(`Saved ${path} to ${process.cwd()}`);
    await fs.writeFile(path, file.data);
    return true;
  }
  return false;
}

export async function testBrowser(
  instantiate: Instantiate,
  wasmFileName: string,
  args: string[],
  indexJsUrl: string,
  options: { contentTypes?: (fileName: string) => string } = {},
  inPage: boolean = false
) {
  if (inPage) {
    return await testBrowserInPage(instantiate, wasmFileName, args);
  }

  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const indexJsPath = fileURLToPath(indexJsUrl);
  const webRoot = path.dirname(indexJsPath);

  const http = await import("node:http");
  const defaultContentTypes: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".wasm": "application/wasm",
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const filePath = path.join(webRoot, pathname);
    if (existsSync(filePath) && (await fs.stat(filePath)).isFile()) {
      const data = await fs.readFile(filePath);
      const ext = pathname.slice(pathname.lastIndexOf("."));
      const contentType = options.contentTypes?.(pathname) || defaultContentTypes[ext] || "text/plain";
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    } else if (pathname === "/process-info.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ env: process.env }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen({ host: "localhost", port: 0 }, () => resolve()));
  const address = server.address() as AddressInfo;

  const playwright = await (async () => {
    try {
      // @ts-ignore
      return await import("playwright")
    } catch {
      // Playwright is not available in the current environment
      console.error(`Playwright is not available in the current environment.
Please run the following command to install it:

      $ npm install playwright && npx playwright install chromium
      `);
      process.exit(1);
    }
  })();
  const browser = await playwright.chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Forward console messages in the page to the Node.js console
  page.on("console", (message: any) => {
    console.log(message.text());
  });

  const onExit = new Promise<number>((resolve) => {
    page.exposeFunction("exitTest", resolve);
  });
  await page.goto(`http://localhost:${address.port}/test.browser.html`);
  const exitCode = await onExit;
  await browser.close();
  process.exit(exitCode);
}

async function testBrowserInPage(instantiate: Instantiate, wasmFileName: string, args: string[]) {
  const logElement = document.createElement("pre");
  document.body.appendChild(logElement);

  const exitTest = (code: number) => {
    const fn = (window as any).exitTest;
    if (fn) { fn(code); }
  }

  const config = await fetch("/process-info.json").then((response) => response.json());

  const handleError = (error: any) => {
    console.error(error);
    exitTest(1);
  };

  // There are 6 cases to exit test
  // 1. Successfully finished XCTest with `exit(0)` synchronously
  // 2. Unsuccessfully finished XCTest with `exit(non - zero)` synchronously
  // 3. Successfully finished XCTest with `exit(0)` asynchronously
  // 4. Unsuccessfully finished XCTest with `exit(non - zero)` asynchronously
  // 5. Crash by throwing JS exception synchronously
  // 6. Crash by throwing JS exception asynchronously

  const handleExitOrError = (error: any) => {
    // XCTest always calls `exit` at the end when no crash
    if (error instanceof WASIProcExit) {
      // pass the output to the server in any case
      if (error.code === 0) {
        exitTest(0);
      } else {
        handleError(error) // test failed
      }
    } else {
      handleError(error) // something wrong happens during test
    }
  }

  // Handle asynchronous exits (case 3, 4, 6)
  window.addEventListener("unhandledrejection", event => {
    event.preventDefault();
    const error = event.reason;
    handleExitOrError(error);
  });

  try {
    // Instantiate the WebAssembly file
    await instantiate(
      {
        env: config.env,
        args: [wasmFileName].concat(args),
        onStdoutLine(line) {
          console.log(line);
          logElement.textContent += line + "\n";
        },
        onStderrLine(line) {
          console.warn(line);
          logElement.textContent += line + "\n";
        },
      },
      {
        "wasi_snapshot_preview1": {
          proc_exit: (code: number) => {
            exitTest(code);
            throw new WASIProcExit(code);
          },
        }
      }
    );
  } catch (error) {
    // Handle synchronous exits (case 1, 2, 5)
    handleExitOrError(error);
  }
  // When JavaScriptEventLoop executor is still running,
  // reachable here without catch (case 3, 4, 6)
}

export async function testNode(instantiate: Instantiate, wasmFileName: string, args: string[]) {
  const env: Record<string, string> = {};
  for (const key in process.env) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }

  let procExitCalled = false;

  // Make `require` function available in the Swift environment. By default it's only available in the local scope,
  // but not on the `global` object.
  // @ts-ignore
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  globalThis.require = require;

  process.on("beforeExit", () => {
    if (!procExitCalled) {
      throw new Error(`Test harness process exited before test process.
This usually means there are some dangling continuations, which are awaited but never resumed.`);
    }
  });

  process.on("unhandledRejection", (error) => {
    if (error instanceof WASIProcExit && error.code == 0) {
      return;
    }
    throw error;
  })

  const rootFs = new Map<string, Inode>();
  const onExit = new Promise<number>(async (resolve) => {
    try {
      await instantiate({ env, args: [wasmFileName].concat(args), rootFs }, {
        "wasi_snapshot_preview1": {
          // @bjorn3/browser_wasi_shim raises an exception when
          // the process exits, but we just want to exit the process itself.
          proc_exit: (code: number) => {
            procExitCalled = true;
            resolve(code);
            throw new WASIProcExit(code);
          },
        }
      });
    } catch (error) {
      if (error instanceof WASIProcExit) {
        resolve(error.code);
      } else {
        throw error;
      }
    }
  });
  let code = 1;
  try {
    code = await onExit;
  } finally {
    for (const path of ["default.profraw"]) {
      await extractAndSaveFile(rootFs, path);
    }
    process.exit(code);
  }
}
