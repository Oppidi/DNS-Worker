/**
 * @file udp.ts
 * @description Classic UDP DNS server (RFC 1035 / RFC 6891) for Serverfull mode.
 */

import dgram from 'node:dgram';
import { Buffer } from 'node:buffer';
import { Env } from '../types';
import { formatPortError } from './format';
import { zeroizeBuffer } from '../utils/memory';
import { createIpRateLimiter, executeClassicDnsQuery } from './dnsCommon';

export interface UdpServerOptions {
  port: number;
  host: string;
  defaultProfileKey?: string;
  env: Env;
}

export class UdpDnsServer {
  private socket: dgram.Socket | null = null;
  private isRunning: boolean = false;
  private allowUdpPacket = createIpRateLimiter(120, 60, 10000);

  constructor(private options: UdpServerOptions) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const isBun = Boolean((process.versions as Record<string, string | undefined>).bun);
        // SO_REUSEPORT is unsupported on Windows (throws ENOTSUP 10045 under Bun) and unnecessary under single-process Bun
        const useReusePort = process.platform !== 'win32' && !isBun;
        this.socket = dgram.createSocket({
          type: 'udp4',
          reuseAddr: true,
          ...(useReusePort ? { reusePort: true } : {})
        });

        const startupErrorHandler = (err: any) => {
          try { this.socket?.close(); } catch {}
          this.socket = null;

          console.error(formatPortError({
            serviceName: 'UDP DNS',
            protocol: 'UDP',
            port: this.options.port,
            err,
            alternateOption: '--dns-port <port> (e.g. --dns-port 5353)',
            disableOption: '--disable-udp'
          }));

          reject(err);
        };

        this.socket.once('error', startupErrorHandler);

        this.socket.on('message', async (msg: Buffer, rinfo: dgram.RemoteInfo) => {
          await this.handleMessage(msg, rinfo);
        });

        this.socket.bind(this.options.port, this.options.host, () => {
          this.socket?.removeListener('error', startupErrorHandler);
          this.socket?.on('error', (err: Error) => {
            console.error('[UDP DNS] Socket runtime error:', err);
          });
          // Boost OS UDP socket buffers to reduce packet drops under high DNS load (progressive scaling: 16MB -> 8MB -> 4MB)
          const candidateBufferSizes = [16 * 1024 * 1024, 8 * 1024 * 1024, 4 * 1024 * 1024];
          for (const size of candidateBufferSizes) {
            try {
              this.socket?.setRecvBufferSize(size);
              this.socket?.setSendBufferSize(size);
              break;
            } catch {
              /* Gracefully fall through to next smaller buffer size if OS rmem_max restricts */
            }
          }
          this.isRunning = true;
          console.log(`[UDP DNS] Classic DNS listening on udp://${this.options.host}:${this.options.port}`);
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private async handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo): Promise<void> {
    if (msg.length < 12 || msg.length > 4096) {
      zeroizeBuffer(msg);
      return; // Drop oversized or truncated DNS UDP packets
    }
    if (!this.allowUdpPacket(rinfo.address)) {
      zeroizeBuffer(msg);
      return; // Drop excess UDP packets per source IP to prevent amplification / CPU DoS
    }
    const rawBytes = new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength);
    await executeClassicDnsQuery({
      rawBytes,
      remoteIp: rinfo.address,
      defaultProfileKey: this.options.defaultProfileKey,
      env: this.options.env,
      protocolTag: 'UDP',
      onAnswer: (answer) => {
        this.sendUdpAnswer(answer, rinfo);
      }
    });
  }

  /**
   * Truncates oversized DNS responses to RFC 1035 512-byte UDP limit and transmits to client.
   */
  private sendUdpAnswer(rawAnswer: Uint8Array, rinfo: dgram.RemoteInfo): void {
    let answer = rawAnswer;
    // RFC 1035 UDP 512 bytes limit check (if no EDNS or response > 512, truncate)
    if (answer.length > 512) {
      const truncated = new Uint8Array(answer);
      // Set TC (Truncation) bit: flags byte 1 (offset 2) bit 1 (0x02)
      truncated[2] |= 0x02;
      answer = truncated.slice(0, 512);
    }

    this.socket?.send(answer, rinfo.port, rinfo.address, (err: Error | null) => {
      if (err) {
        console.warn(`[UDP DNS] Failed to send answer to ${rinfo.address}:${rinfo.port}:`, err.message);
      }
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket && this.isRunning) {
        this.socket.close(() => {
          this.isRunning = false;
          console.log('[UDP DNS] Service stopped.');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
