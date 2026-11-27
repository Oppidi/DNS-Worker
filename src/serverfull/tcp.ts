/**
 * @file tcp.ts
 * @description Classic TCP DNS server (RFC 1035 Section 4.2.2 / RFC 7766) for Serverfull mode.
 * Handles DNS over TCP on the configured DNS port (default 53), including retries after UDP TC=1 truncation.
 */

import net from 'node:net';
import { Buffer } from 'node:buffer';
import { Env } from '../types';
import { formatPortError } from './format';
import {
  attachLengthPrefixedDnsReader,
  createIpRateLimiter,
  executeClassicDnsQuery,
  sendLengthPrefixedDnsAnswer
} from './dnsCommon';

const MAX_ACTIVE_TCP_SOCKETS = 2048;

export interface TcpServerOptions {
  port: number;
  host: string;
  defaultProfileKey?: string;
  env: Env;
}

export class TcpDnsServer {
  private server: net.Server | null = null;
  private isRunning: boolean = false;
  private activeSockets = new Set<net.Socket>();
  private allowTcpQuery = createIpRateLimiter(120, 60, 10000);

  constructor(private options: TcpServerOptions) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { port, host } = this.options;
      try {
        this.server = net.createServer((socket: net.Socket) => {
          if (this.activeSockets.size >= MAX_ACTIVE_TCP_SOCKETS) {
            socket.destroy();
            return;
          }
          this.activeSockets.add(socket);
          socket.once('close', () => {
            this.activeSockets.delete(socket);
          });
          this.handleConnection(socket);
        });

        const startupErrorHandler = (err: unknown) => {
          this.server = null;

          console.error(formatPortError({
            serviceName: 'TCP DNS',
            protocol: 'TCP',
            port,
            err,
            alternateOption: '--dns-port <port> (e.g. --dns-port 5353)',
            disableOption: '--disable-tcp'
          }));

          reject(err);
        };

        this.server.once('error', startupErrorHandler);

        this.server.listen(port, host, () => {
          this.server?.removeListener('error', startupErrorHandler);
          this.server?.on('error', (err: Error) => {
            console.error('[TCP DNS] Server runtime error:', err);
          });
          this.isRunning = true;
          console.log(`[TCP DNS] Classic DNS listening on tcp://${host}:${port}`);
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private handleConnection(socket: net.Socket): void {
    // Disable Nagle's algorithm and enable TCP keepalive (RFC 7766)
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 60000);

    const remoteIp = socket.remoteAddress?.replace(/^::ffff:/, '') || '127.0.0.1';

    socket.setTimeout(30000, () => {
      socket.destroy();
    });

    socket.on('error', (err: Error) => {
      if ((err as { code?: string }).code !== 'ECONNRESET') {
        console.warn(`[TCP DNS] Socket error from ${remoteIp}:`, err.message);
      }
    });

    attachLengthPrefixedDnsReader(socket, async (frame: Buffer) => {
      if (frame.length < 12) {
        return;
      }
      if (!this.allowTcpQuery(remoteIp)) {
        socket.destroy();
        return;
      }
      const rawBytes = new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
      await executeClassicDnsQuery({
        rawBytes,
        remoteIp,
        defaultProfileKey: this.options.defaultProfileKey,
        env: this.options.env,
        protocolTag: 'TCP',
        onAnswer: (answer) => {
          sendLengthPrefixedDnsAnswer(socket, answer);
        }
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server && this.isRunning) {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.isRunning = false;
          console.log('[TCP DNS] Service stopped.');
          resolve();
        };
        const timer = setTimeout(() => {
          for (const sock of this.activeSockets) {
            try { sock.destroy(); } catch {}
          }
          finish();
        }, 1500);

        this.server.close(finish);
      } else {
        resolve();
      }
    });
  }
}
