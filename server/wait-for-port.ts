import net from 'net';

export async function waitForPort(
  host: string,
  port: number,
  opts: { timeoutMs: number; intervalMs?: number; signal?: AbortSignal }
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 200;
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    let socket: net.Socket | undefined;
    let settled = false;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      socket?.destroy();
      opts.signal?.removeEventListener('abort', onAbort);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onAbort = () => {
      fail(opts.signal?.reason instanceof Error ? opts.signal.reason : new Error('wait for port aborted'));
    };

    const tryConnect = () => {
      if (settled) return;
      if (opts.signal?.aborted) {
        onAbort();
        return;
      }

      if (Date.now() - startedAt >= opts.timeoutMs) {
        fail(new Error(`port did not open: ${host}:${port}`));
        return;
      }

      socket = net.createConnection({ host, port });
      socket.once('connect', succeed);
      socket.once('error', () => {
        socket?.destroy();
        const remainingMs = opts.timeoutMs - (Date.now() - startedAt);
        if (remainingMs <= 0) {
          fail(new Error(`port did not open: ${host}:${port}`));
          return;
        }
        timer = setTimeout(tryConnect, Math.min(intervalMs, remainingMs));
      });
    };

    opts.signal?.addEventListener('abort', onAbort, { once: true });
    tryConnect();
  });
}
