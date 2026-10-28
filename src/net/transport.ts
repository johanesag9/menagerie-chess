/**
 * How the online client reaches a room server: plain HTTP for rooms, one socket per player.
 * The real one uses fetch and WebSocket; `fakeServer.ts` gives an in-page one with the same shape.
 */

/** The bits of a WebSocket the client uses. Text frames only. */
export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  /** Fires once, whether the socket closed cleanly, failed to open or was dropped. */
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export interface HttpReply {
  status: number;
  body: unknown;
}

export interface Transport {
  /** `path` starts with '/', e.g. '/rooms'. Network failures reject. */
  request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<HttpReply>;
  connect(path: string): SocketLike;
}

/** fetch + WebSocket against `base` (http(s)://host[:port], no trailing slash). */
export function httpTransport(base: string): Transport {
  const root = base.replace(/\/+$/, '');
  return {
    async request(method, path, body) {
      const res = await fetch(root + path, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, body: json };
    },
    connect(path) {
      const url = root.replace(/^http/, 'ws') + path;
      const out: SocketLike = { onopen: null, onmessage: null, onclose: null, send: () => {}, close: () => {} };
      let closed = false;
      const done = () => {
        if (closed) return;
        closed = true;
        out.onclose?.();
      };
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        setTimeout(done, 0);
        return out;
      }
      ws.onopen = () => out.onopen?.();
      ws.onmessage = (e) => typeof e.data === 'string' && out.onmessage?.(e.data);
      ws.onclose = done;
      ws.onerror = () => {}; // onclose follows
      out.send = (data) => ws.readyState === WebSocket.OPEN && ws.send(data);
      // A half-open socket can take a long time to report its close; treat it as closed right away.
      out.close = () => {
        try { ws.close(); } catch { /* already closed */ }
        done();
      };
      return out;
    },
  };
}

/**
 * Wraps a transport with a switch to cut the network (for the demo and tests):
 * `drop()` kills the live socket; while `offline`, new sockets fail and requests reject.
 */
export class ControlledTransport implements Transport {
  offline = false;
  private live = new Set<SocketLike>();

  constructor(private inner: Transport) {}

  request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<HttpReply> {
    if (this.offline) return Promise.reject(new Error('offline'));
    return this.inner.request(method, path, body);
  }

  connect(path: string): SocketLike {
    const out: SocketLike = { onopen: null, onmessage: null, onclose: null, send: () => {}, close: () => {} };
    if (this.offline) {
      setTimeout(() => out.onclose?.(), 0);
      return out;
    }
    const s = this.inner.connect(path);
    this.live.add(s);
    s.onopen = () => out.onopen?.();
    s.onmessage = (d) => out.onmessage?.(d);
    s.onclose = () => {
      this.live.delete(s);
      out.onclose?.();
    };
    out.send = (d) => s.send(d);
    out.close = () => s.close();
    return out;
  }

  /** Close every live socket as if the network went away. */
  drop(): void {
    for (const s of [...this.live]) s.close();
  }
}
