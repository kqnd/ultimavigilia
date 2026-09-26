import os from 'node:os';
import type { NetInterfaceInfo } from '../shared/bridge.js';

/** Lista interfaces IPv4 externas (nunca loopback). Radmin VPN usa a faixa 26.0.0.0/8. */
export function listIPv4(): NetInterfaceInfo[] {
  const out: NetInterfaceInfo[] = [];
  const ifs = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifs)) {
    for (const a of addrs ?? []) {
      const famRaw = a.family as unknown;
      const fam = typeof famRaw === 'string' ? famRaw : famRaw === 4 ? 'IPv4' : 'IPv6';
      if (fam !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue; // APIPA: sem rede real
      const radmin = /radmin/i.test(name) || a.address.startsWith('26.');
      const label = radmin
        ? 'Radmin VPN'
        : /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)
          ? 'Rede local'
          : /hamachi/i.test(name) || a.address.startsWith('25.')
            ? 'VPN (Hamachi)'
            : 'Outra rede';
      out.push({ name, address: a.address, label, radmin });
    }
  }
  // Radmin primeiro, depois rede local
  out.sort((x, y) => Number(y.radmin) - Number(x.radmin) || x.label.localeCompare(y.label));
  return out;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export const isIPv4 = (s: string): boolean => IPV4.test(s);
/** Endereço aceitável para conectar: IPv4 ou nome de host simples. */
export const isValidHost = (s: string): boolean => isIPv4(s) || /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(s);
