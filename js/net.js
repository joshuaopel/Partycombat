// PeerJS transport. The host owns a well-known peer id derived from the room
// code, so phones can dial in with four letters and no signalling server of
// our own. The host is authoritative: phones only ever send input.

export const MAX_PLAYERS = 6;
const ID_PREFIX = 'pcbt-v1-';
// Ambiguous glyphs removed so codes are readable off a TV.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * PeerJS connects to its free public broker by default. That broker is
 * occasionally flaky and rate-limited, so allow pointing at your own
 * PeerServer with ?host=…&port=…&path=…&secure=0 on either page. Both the
 * host screen and every controller must use the same settings.
 */
export function peerOptions() {
  const q = new URLSearchParams(location.search);
  const opts = { debug: 1 };
  if (q.get('host')) {
    opts.host = q.get('host');
    if (q.get('port')) opts.port = Number(q.get('port'));
    opts.path = q.get('path') || '/';
    opts.secure = q.get('secure') !== '0';
  }
  return opts;
}

export function randomCode(len = 4) {
  let s = '';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

export const peerIdFor = (code) => ID_PREFIX + code.toUpperCase();

function waitForPeerJS(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    (function poll() {
      if (typeof window.Peer === 'function') return resolve();
      if (Date.now() - started > timeoutMs) {
        return reject(new Error('Could not load the PeerJS library. Check your connection.'));
      }
      setTimeout(poll, 60);
    })();
  });
}

/**
 * Bring up a host peer, retrying with a fresh code if the id is taken.
 * Returns { peer, code }.
 */
export async function startHost({ onOpen, onError } = {}) {
  await waitForPeerJS();
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode();
    try {
      const peer = await new Promise((resolve, reject) => {
        const p = new window.Peer(peerIdFor(code), peerOptions());
        const cleanup = () => {
          p.off('open', ok);
          p.off('error', bad);
        };
        const ok = () => {
          cleanup();
          resolve(p);
        };
        const bad = (err) => {
          cleanup();
          p.destroy();
          reject(err);
        };
        p.on('open', ok);
        p.on('error', bad);
      });
      onOpen?.(code, peer);
      return { peer, code };
    } catch (err) {
      // A taken id just means another room is live — roll a new code.
      if (err && err.type === 'unavailable-id') continue;
      onError?.(err);
      throw err;
    }
  }
  const err = new Error('Could not reserve a room code. Try again.');
  onError?.(err);
  throw err;
}

/** Connect a controller to a host room code. Resolves with an open DataConnection. */
export async function joinRoom(code, { timeoutMs = 15000 } = {}) {
  await waitForPeerJS();
  const peer = await new Promise((resolve, reject) => {
    const p = new window.Peer(peerOptions());
    const to = setTimeout(() => {
      p.destroy();
      reject(new Error('Timed out reaching the matchmaking server.'));
    }, timeoutMs);
    p.on('open', () => {
      clearTimeout(to);
      resolve(p);
    });
    p.on('error', (err) => {
      clearTimeout(to);
      p.destroy();
      reject(err);
    });
  });

  return new Promise((resolve, reject) => {
    const conn = peer.connect(peerIdFor(code), { reliable: true, serialization: 'json' });
    const to = setTimeout(() => {
      reject(new Error(`No room found with code ${code}.`));
      peer.destroy();
    }, timeoutMs);

    conn.on('open', () => {
      clearTimeout(to);
      resolve({ peer, conn });
    });
    peer.on('error', (err) => {
      clearTimeout(to);
      const msg =
        err && err.type === 'peer-unavailable'
          ? `No room found with code ${code}.`
          : err.message || String(err);
      reject(new Error(msg));
    });
  });
}

/** Fire-and-forget send that swallows closed-channel errors. */
export function send(conn, msg) {
  try {
    if (conn && conn.open) conn.send(msg);
  } catch {
    /* connection is going away; the close handler will clean up */
  }
}
