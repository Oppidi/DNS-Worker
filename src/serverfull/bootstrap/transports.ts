/**
 * @file transports.ts
 * @description Network server transport lifecycle management (UDP DNS, TCP DNS, DoT, HTTP, HTTPS).
 */

import type { Env } from '../../types';
import type { ServerfullConfig } from '../config';
import { inspectTlsCertificate } from '../cert';
import { UdpDnsServer } from '../udp';
import { TcpDnsServer } from '../tcp';
import { DotDnsServer } from '../dot';
import { HttpServer, HttpsServer } from '../http';

export interface ServerfullTransports {
  udpServer: UdpDnsServer | null;
  tcpServer: TcpDnsServer | null;
  dotServer: DotDnsServer | null;
  httpServer: HttpServer;
  httpsServer: HttpsServer | null;
}

/**
 * Instantiates and starts all configured network listeners (UDP/TCP DNS, DoT, HTTP/HTTPS Web UI & DoH).
 */
export async function startServerfullTransports(
  config: ServerfullConfig,
  env: Env
): Promise<ServerfullTransports> {
  const certInfo = inspectTlsCertificate(config.tlsCertPath, config.tlsKeyPath);
  const canStartHttps = certInfo.configured && certInfo.filesExist && !config.disableHttps;
  const canStartDot = !config.disableDot && certInfo.configured && certInfo.filesExist && certInfo.isWildcard;

  const udpServer = !config.disableUdp ? new UdpDnsServer({
    port: config.udpPort,
    host: config.host,
    defaultProfileKey: config.defaultProfileKey,
    env,
  }) : null;

  const tcpServer = !config.disableTcp ? new TcpDnsServer({
    port: config.udpPort,
    host: config.host,
    defaultProfileKey: config.defaultProfileKey,
    env,
  }) : null;

  const dotServer = canStartDot ? new DotDnsServer({
    port: config.dotPort,
    host: config.host,
    tlsKeyPath: config.tlsKeyPath,
    tlsCertPath: config.tlsCertPath,
    dotDomain: config.dotDomain,
    defaultProfileKey: config.defaultProfileKey,
    env,
  }) : null;

  const httpServer = new HttpServer({
    port: config.httpPort,
    host: config.host,
    env,
    httpsRedirect: canStartHttps ? {
      enabled: true,
      httpsPort: config.httpsPort,
    } : undefined,
  });

  const httpsServer = canStartHttps ? new HttpsServer({
    port: config.httpsPort,
    host: config.host,
    certPath: config.tlsCertPath,
    keyPath: config.tlsKeyPath,
    env,
  }) : null;

  if (udpServer) await udpServer.start();
  if (tcpServer) await tcpServer.start();
  if (dotServer) await dotServer.start();
  await httpServer.start();
  if (httpsServer) await httpsServer.start();

  return { udpServer, tcpServer, dotServer, httpServer, httpsServer };
}

/**
 * Gracefully stops all active network server transports in parallel.
 */
export async function stopServerfullTransports(transports: ServerfullTransports): Promise<void> {
  await Promise.all([
    transports.udpServer?.stop(),
    transports.tcpServer?.stop(),
    transports.dotServer?.stop(),
    transports.httpServer.stop(),
    transports.httpsServer?.stop(),
  ]);
}
