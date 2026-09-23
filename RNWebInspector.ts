/**
 * RNWebInspector — drop this file into your React Native project.
 *
 * Usage (as early as possible, e.g. top of index.js / App.tsx, dev-only):
 *
 *   import RNWebInspector from './devtools/RNWebInspector';
 *   if (__DEV__) {
 *     RNWebInspector.init({
 *       host: '192.168.1.23',   // your Mac's LAN IP
 *       appName: 'MyApp',       // shown in the dashboard's device panel
 *     });
 *   }
 *
 * It patches globalThis.fetch, XMLHttpRequest, and console.* and streams
 * events to the rn-web-inspector Node server over a plain WebSocket.
 * No native module, no installer — pure JS/TS.
 *
 * Device/app identity shown in the dashboard:
 *   - platform   -> auto-detected from react-native's Platform module (ios/android)
 *   - deviceName -> auto-built as "iOS 17.4" / "Android 14" unless you pass one
 *   - appName    -> pass this yourself (e.g. your app's display name);
 *                   there's no reliable cross-platform way to read it automatically
 */
import { Platform } from 'react-native';

declare const __DEV__: boolean;

export interface RNWebInspectorOptions {
  /** LAN IP of the machine running the server, e.g. '192.168.1.23'. Required. */
  host: string;
  /** Port the server is listening on. Defaults to 4000. */
  port?: number;
  /** Friendly label for THIS DEVICE/SIMULATOR, e.g. 'iPhone 15 Sim'. Auto-detected if omitted. */
  deviceName?: string;
  /** Friendly label for THIS APP, e.g. 'MyApp (staging)'. Shown in the dashboard's device panel. */
  appName?: string;
}

type EventPayload = Record<string, unknown> & { type: string };

let ws: WebSocket | null = null;
let queue: EventPayload[] = [];
let connected = false;
let deviceName = `${Platform.OS === 'ios' ? 'iOS' : 'Android'} ${Platform.Version}`;
let appName = 'RN App';

function send(payload: EventPayload): void {
  const packet: EventPayload = { ...payload, timestamp: Date.now() };
  if (connected && ws && ws.readyState === 1) {
    ws.send(JSON.stringify(packet));
  } else {
    queue.push(packet);
  }
}

function flushQueue(): void {
  while (queue.length) {
    const packet = queue.shift();
    if (packet && ws) ws.send(JSON.stringify(packet));
  }
}

function connect(host: string, port: number): void {
  ws = new WebSocket(`ws://${host}:${port}`);

  ws.onopen = () => {
    connected = true;
    ws?.send(JSON.stringify({
      type: 'hello',
      role: 'device',
      deviceName,
      appName,
      platform: Platform.OS,
    }));
    flushQueue();
  };

  ws.onclose = () => {
    connected = false;
    setTimeout(() => connect(host, port), 2000); // auto-reconnect
  };

  ws.onerror = () => {
    // swallow — onclose will fire next and trigger reconnect
  };
}

// ---------- console interception ----------
type ConsoleLevel = 'log' | 'info' | 'warn' | 'error';

function patchConsole(): void {
  (['log', 'info', 'warn', 'error'] as ConsoleLevel[]).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      send({
        type: 'log',
        level,
        message: args.map(safeStringify).join(' '),
        args,
      });
    };
  });
}

function safeStringify(a: unknown): string {
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(a);
  } catch (e) {
    return String(a);
  }
}

// ---------- fetch interception ----------
function patchFetch(): void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (
    input: RequestInfo | URL,
    fetchOptions: RequestInit = {}
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : (input as Request)?.url ?? String(input);
    const method = (fetchOptions.method || 'GET').toUpperCase();
    const start = Date.now();

    let response: Response | undefined;
    let error: unknown;

    try {
      response = await originalFetch(input, fetchOptions);
    } catch (e) {
      error = e;
    }

    const duration = Date.now() - start;
    let responseBody: unknown;

    if (response) {
      try {
        const text = await response.clone().text();
        try {
          responseBody = JSON.parse(text);
        } catch {
          responseBody = text;
        }
      } catch {
        responseBody = '(unreadable body)';
      }
    }

    send({
      type: 'network',
      method,
      url,
      status: response ? response.status : 'ERR',
      duration,
      requestHeaders: fetchOptions.headers as unknown,
      requestBody: fetchOptions.body as unknown,
      responseHeaders: response ? Object.fromEntries(response.headers.entries()) : undefined,
      responseBody: error ? String(error) : responseBody,
    });

    if (error) throw error;
    return response as Response;
  };
}

// ---------- XMLHttpRequest interception ----------
function patchXHR(): void {
  const OriginalXHR = globalThis.XMLHttpRequest as typeof XMLHttpRequest | undefined;
  if (!OriginalXHR) return;

  function PatchedXHR(this: XMLHttpRequest) {
    const xhr = new (OriginalXHR as typeof XMLHttpRequest)();
    let method: string;
    let url: string;
    let start: number;

    const originalOpen = xhr.open.bind(xhr);
    xhr.open = function (
      m: string,
      u: string,
      ...rest: unknown[]
    ) {
      method = m;
      url = u;
      // @ts-expect-error — forwarding variadic overload args to the native implementation
      return originalOpen(m, u, ...rest);
    } as typeof xhr.open;

    const originalSend = xhr.send.bind(xhr);
    xhr.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      start = Date.now();
      xhr.addEventListener('loadend', () => {
        let responseBody: unknown;
        if (xhr.responseType === 'text' || xhr.responseType === '') {
          responseBody = safeParse(xhr.responseText);
        } else {
          // For non-text response types, we don't attempt to read as text
          responseBody = `(non-text response type: ${xhr.responseType})`;
        }
        send({
          type: 'network',
          method,
          url,
          status: xhr.status,
          duration: Date.now() - start,
          requestBody: body as unknown,
          responseBody,
        });
      });
      // Cast to any to avoid TypeScript errors with XMLHttpRequestBodyInit
      return originalSend(body as any);
    } as typeof xhr.send;

    return xhr;
  }

  // @ts-expect-error — replacing the global constructor with our wrapped version
  globalThis.XMLHttpRequest = PatchedXHR;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function init(options: RNWebInspectorOptions): void {
  const { host, port = 4000, deviceName: customDeviceName, appName: customAppName } = options;

  if (!host) {
    console.warn('[RNWebInspector] "host" (your dev machine LAN IP) is required.');
    return;
  }

  if (customDeviceName) deviceName = customDeviceName;
  if (customAppName) appName = customAppName;

  patchConsole();
  patchFetch();
  patchXHR();
  connect(host, port);
}

export default { init };
