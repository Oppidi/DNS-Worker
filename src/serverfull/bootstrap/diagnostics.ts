/**
 * @file diagnostics.ts
 * @description Startup TLS certificate diagnostics, JWT secret audit warnings, and summary banners.
 */

import type { Env } from '../../types';
import type { ServerfullConfig } from '../config';
import { getPackageVersion } from '../config';
import { getActiveRuntimeDescription } from '../cli';
import { inspectTlsCertificate, getCertbotDiagnosticOptions, TlsCertificateInfo } from '../cert';
import { maskDatabaseUrl } from '../../lib/turso';
import { isUsableJwtSecret, isStrongJwtSecret } from '../../lib/jwt';
import { formatBanner, formatDiagnostic, formatKeyValueSection } from '../format';

function formatDotStatus(config: ServerfullConfig, certInfo: TlsCertificateInfo, useDotDomain: boolean): string {
  if (config.disableDot) return 'Disabled (--disable-dot)';
  if (!certInfo.configured) return useDotDomain ? 'Disabled / Not Configured' : 'Disabled (TLS Certificates Not Configured)';
  if (!certInfo.filesExist) return `Disabled (Files Inaccessible: ${certInfo.error || 'Check Permissions'})`;
  if (!certInfo.isWildcard) return 'Paused (Requires Wildcard Certificate *.domain)';
  const hostLabel = useDotDomain ? (config.dotDomain || config.host) : config.host;
  return `tls://${hostLabel}:${config.dotPort}`;
}

function formatHttpsStatus(config: ServerfullConfig, certInfo: TlsCertificateInfo, useDotDomain: boolean): string {
  if (config.disableHttps) return 'Disabled (--disable-https)';
  if (!certInfo.configured) return useDotDomain ? 'Disabled / Not Configured' : 'Disabled (TLS Certificates Not Configured)';
  if (!certInfo.filesExist) return `Disabled (Files Inaccessible: ${certInfo.error || 'Check Permissions'})`;
  const hostLabel = useDotDomain ? (config.dotDomain || config.host) : config.host;
  return `https://${hostLabel}:${config.httpsPort}`;
}

/**
 * Emits primary-process initialization banner, TLS certificate guidance, configured ports table,
 * and weak JWT_SECRET warning prior to database/worker startup.
 */
export function logPrimaryStartupDiagnostics(config: ServerfullConfig, env: Env): void {
  console.log(formatBanner({
    title: `Initializing DNS Worker v${getPackageVersion()} (Serverfull)`,
    borderChar: '-',
  }));

  const certInfo = inspectTlsCertificate(config.tlsCertPath, config.tlsKeyPath);
  const canStartHttps = certInfo.configured && certInfo.filesExist && !config.disableHttps;

  if (!certInfo.configured) {
    console.log(formatDiagnostic(getCertbotDiagnosticOptions('missing', config.dotDomain)));
  } else if (!certInfo.filesExist) {
    console.log(formatDiagnostic({
      level: 'warning',
      title: 'TLS Certificate Files Inaccessible',
      message: certInfo.error || 'Configured TLS certificate or private key files could not be read on disk.',
      details: [
        `Cert path configured: ${config.tlsCertPath ? 'yes' : 'no'}`,
        `Key path configured : ${config.tlsKeyPath ? 'yes' : 'no'}`,
        'Running user details are omitted for security.',
      ],
      solutions: [
        'Check that the paths configured in .env exist and are accessible.',
        "If using Let's Encrypt (/etc/letsencrypt/), grant read permissions to the service user (e.g. chmod 755 /etc/letsencrypt/{live,archive} and chmod 644 on keys).",
      ],
    }));
  } else if (!certInfo.isWildcard) {
    console.log(formatDiagnostic(getCertbotDiagnosticOptions('non_wildcard', config.dotDomain)));
  }

  console.log(formatKeyValueSection({
    title: '[Services] Configured Ports & Transports:',
    items: [
      {
        label: 'Web Dashboard & DoH (HTTP)',
        value: canStartHttps
          ? `http://${config.host}:${config.httpPort} (Redirects to HTTPS)`
          : `http://${config.host}:${config.httpPort}`,
      },
      { label: 'Web Dashboard & DoH (HTTPS)', value: formatHttpsStatus(config, certInfo, false) },
      { label: 'Classic UDP DNS', value: config.disableUdp ? 'Disabled' : `udp://${config.host}:${config.udpPort}` },
      { label: 'Classic TCP DNS', value: config.disableTcp ? 'Disabled' : `tcp://${config.host}:${config.udpPort}` },
      { label: 'DNS over TLS (DoT)', value: formatDotStatus(config, certInfo, false) },
    ],
  }));

  if (isUsableJwtSecret(env.JWT_SECRET) && !isStrongJwtSecret(env.JWT_SECRET)) {
    console.warn(formatDiagnostic({
      level: 'warning',
      title: 'SECURITY WARNING',
      message: 'JWT_SECRET is shorter than 32 characters.',
      solutions: [
        'Please configure KEK_v1 in your environment before rotating JWT_SECRET to prevent existing encrypted credentials from becoming unrecoverable.',
      ],
    }));
  }
}

/**
 * Renders the unified post-startup banner for either Single Process or Cluster Master mode.
 */
export function printRuntimeStartupBanner(config: ServerfullConfig, workersCount: number): void {
  const certInfo = inspectTlsCertificate(config.tlsCertPath, config.tlsKeyPath);
  const isCluster = workersCount > 1;

  console.log(formatBanner({
    title: isCluster
      ? 'DNS Worker (Serverfull Master) Started Successfully'
      : 'DNS Worker (Serverfull Mode) Started Successfully',
    borderChar: '=',
    bullet: '• ',
    items: [
      { label: 'Runtime Engine', value: getActiveRuntimeDescription() },
      isCluster
        ? { label: 'Multi-Core Concurrency', value: `${workersCount} Workers (Cluster Mode)` }
        : { label: 'Concurrency', value: 'Single Process' },
      { label: 'In-Memory DNS Cache', value: `${config.dnsCacheSize.toLocaleString()} entries` },
      {
        label: 'Classic UDP DNS',
        value: !config.disableUdp ? `udp://${config.host}:${config.udpPort}` : 'Disabled (--disable-udp)',
      },
      {
        label: 'Classic TCP DNS',
        value: !config.disableTcp ? `tcp://${config.host}:${config.udpPort}` : 'Disabled (--disable-tcp)',
      },
      { label: 'DoT (TLS DNS)', value: formatDotStatus(config, certInfo, true) },
      { label: 'Web UI & DoH (HTTP)', value: `http://${config.host}:${config.httpPort}` },
      { label: 'Web UI & DoH (HTTPS)', value: formatHttpsStatus(config, certInfo, true) },
      {
        label: 'Database Engine',
        value: config.databaseService === 'Turso'
          ? `Turso (${maskDatabaseUrl(config.tursoDatabaseUrl)})`
          : `SQLite (${config.dbPath})`,
      },
    ],
  }));
}
