// Forward-compatible client-side patch for engine.io's WebSocket transport
// (ether/etherpad#7756 lever 8). Recognises payload-encoded WS frames sent
// by a server that enables `settings.enginePacking`.
//
// Engine.io's base transport calls `onData(data)` per incoming WS frame and
// runs `decodePacket(data, binaryType)` on it. With server-side packing
// enabled, a single WS frame can carry multiple engine.io packets joined
// by the record separator (`\x1e`, U+001E), the same wire format the
// polling transport uses. This patch detects the separator and routes
// through `decodePayload` when present.
//
// Always on (no setting). A single-packet frame never legitimately
// contains `\x1e`: engine.io packet type bytes are '0'-'6' or empty for
// binary, and JSON serialises raw `\x1e` to the escape sequence
// ``. So the separator check is a safe discriminator.
//
// Idempotent. Patches the prototype once; safe to call from multiple init
// paths.
//
// We reach into the pnpm store via the canonical path under
// `node_modules/.pnpm/` so we patch the SAME engine.io-client module
// instance the bundled socket.io-client uses (pnpm symlinks resolve to the
// same module object).

import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

let installed = false;

// ESM-friendly equivalents of __dirname / __filename. The harness is ESM
// (package.json "type": "module"), so the CJS globals don't exist.
const HERE_FILE = fileURLToPath(import.meta.url);
const HERE_DIR = path.dirname(HERE_FILE);
const HARNESS_ROOT = path.resolve(HERE_DIR, '../..');
const ENGINE_IO_CLIENT_PATH = path.join(
  HARNESS_ROOT,
  'node_modules/.pnpm/engine.io-client@6.6.4/node_modules/engine.io-client/build/cjs/transport.js',
);
const ENGINE_IO_PARSER_PATH = path.join(
  HARNESS_ROOT,
  'node_modules/.pnpm/engine.io-parser@5.2.3/node_modules/engine.io-parser/build/cjs/index.js',
);

const req = createRequire(HERE_FILE);

export const installEnginePackingClientPatch = (): void => {
  if (installed) return;
  installed = true;

  let TransportProto: {onData?: (d: unknown) => void} & Record<string, unknown>;
  let decodePayload: (data: string, binaryType?: string) => Array<unknown>;
  try {
    TransportProto = req(ENGINE_IO_CLIENT_PATH).Transport.prototype;
    decodePayload = req(ENGINE_IO_PARSER_PATH).decodePayload;
  } catch (err: any) {
    console.error(`[engine-packing-client-patch] cannot resolve engine.io-client/parser: ${err && err.message || err}`);
    return;
  }
  if (typeof TransportProto.onData !== 'function' || typeof decodePayload !== 'function') {
    console.error('[engine-packing-client-patch] engine.io-client shape unexpected; skipping');
    return;
  }

  const original = TransportProto.onData as (this: unknown, data: unknown) => void;
  const SEPARATOR = String.fromCharCode(30);

  TransportProto.onData = function (this: {socket?: {binaryType?: string}; onPacket: (p: unknown) => void}, data: unknown) {
    if (typeof data !== 'string' || data.indexOf(SEPARATOR) === -1) {
      return original.call(this, data);
    }
    const packets = decodePayload(data, this.socket?.binaryType ?? 'nodebuffer');
    for (const packet of packets) this.onPacket(packet);
  };
};
