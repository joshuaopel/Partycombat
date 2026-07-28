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
// PeerJS defaults to STUN only, which is enough when everyone is on the same
// Wi-Fi but not across strict NATs — a phone on mobile data and a host on
// Wi-Fi frequently cannot reach each other at all. The relay is a free public
// one and is only used as a last resort, after direct candidates fail.
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turns:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export function peerOptions() {
  const q = new URLSearchParams(location.search);
  const opts = { debug: 1, config: { iceServers: ICE_SERVERS } };
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

/** Open our own peer and register it with the broker. */
function openPeer(timeoutMs) {
  return new Promise((resolve, reject) => {
    const p = new window.Peer(peerOptions());
    // Both listeners must come off once this settles. Leaving the error
    // handler attached means a later, unrelated error — PeerJS reports
    // peer-unavailable and transient network blips on the peer itself —
    // destroys the peer out from under an in-flight connection.
    const done = (fn, arg) => {
      clearTimeout(to);
      p.off('open', onOpen);
      p.off('error', onError);
      fn(arg);
    };
    const onOpen = () => done(resolve, p);
    const onError = (err) => {
      p.destroy();
      done(reject, new Error(describe(err, 'Could not reach the matchmaking server.')));
    };
    const to = setTimeout(() => {
      p.destroy();
      done(reject, new Error('Timed out reaching the matchmaking server.'));
    }, timeoutMs);
    p.on('open', onOpen);
    p.on('error', onError);
  });
}

function describe(err, fallback) {
  if (!err) return fallback;
  if (err.type === 'unavailable-id') return 'That room code is already taken.';
  if (err.type === 'browser-incompatible') return 'This browser does not support WebRTC.';
  if (err.type === 'network') return 'Lost the connection to the matchmaking server.';
  if (err.type === 'ssl-unavailable') return 'The matchmaking server refused a secure connection.';
  return err.message || fallback;
}

/** Connect a controller to a host room code. Resolves with an open DataConnection. */
export async function joinRoom(code, { timeoutMs = 20000 } = {}) {
  await waitForPeerJS();
  const peer = await openPeer(timeoutMs);

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      peer.off('error', onError);
      fn(arg);
    };

    const conn = peer.connect(peerIdFor(code), { reliable: true, serialization: 'json' });

    const onError = (err) => {
      if (err && err.type === 'peer-unavailable') {
        peer.destroy();
        done(reject, new Error(
          `No room with code ${code}. Check the code on the host screen — it changes ` +
          `every time the host page reloads.`
        ));
        return;
      }
      peer.destroy();
      done(reject, new Error(describe(err, 'Could not join the room.')));
    };
    peer.on('error', onError);
    conn.on('open', () => done(resolve, { peer, conn }));

    const to = setTimeout(() => {
      // No peer-unavailable came back, so the broker did find the host and
      // relayed our offer — the direct peer-to-peer link is what failed. That
      // is a network problem (strict NAT, mobile data, guest Wi-Fi with client
      // isolation), not a wrong code, and saying "no room found" here sends
      // people off debugging the wrong thing.
      peer.destroy();
      done(reject, new Error(
        `Found room ${code}, but could not open a direct connection to the host. ` +
        `Put both devices on the same Wi-Fi network and try again.`
      ));
    }, timeoutMs);
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
