// PeerJS transport. The host owns a well-known peer id derived from the room
// code, so phones can dial in with four letters and no signalling server of
// our own. The host is authoritative: phones only ever send input.

import { TURN_SERVERS, turnFromUrl, hasTurn } from './turn.js';

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
// Everyone plays on one shared Wi-Fi, where the browsers exchange LAN
// addresses and talk to each other directly. STUN is kept because some
// networks hand out addresses the browser will not offer as plain host
// candidates, and it costs one round trip during setup.
//
// No TURN relay is configured, by design — see js/turn.js. Across networks,
// and especially on mobile data, carrier-grade NAT means neither side can
// accept an incoming connection and only a relay could carry the traffic.
// Same Wi-Fi is the requirement instead.
const STUN_SERVERS = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] };

function iceServers() {
  return [STUN_SERVERS, ...TURN_SERVERS, ...turnFromUrl()];
}

export function peerOptions() {
  const q = new URLSearchParams(location.search);
  const opts = { debug: 1, config: { iceServers: iceServers() } };
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

    // Watch ICE so a failure can say *which* part of the link broke rather
    // than just "could not connect". Candidate types tell us a lot:
    //   host  — a same-LAN route was offered at all
    //   srflx — STUN worked, so our public address is known
    //   relay — a TURN relay was configured on the URL and answered
    // Since this is a same-Wi-Fi game, a failure with host candidates present
    // usually means the two devices are on different networks, or on a network
    // that isolates its clients from each other.
    const seen = new Set();
    let iceState = 'new';
    setTimeout(() => {
      const pc = conn.peerConnection;
      if (!pc) return;
      pc.addEventListener('icecandidate', (e) => {
        if (e.candidate && e.candidate.type) seen.add(e.candidate.type);
      });
      pc.addEventListener('iceconnectionstatechange', () => {
        iceState = pc.iceConnectionState;
      });
    }, 0);
    const diagnostics = () => ({
      candidates: [...seen],
      ice: iceState,
      relay: seen.has('relay'),
      summary: `ICE ${iceState}; candidates: ${[...seen].join(', ') || 'none'}`,
    });

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
      // relayed our offer — the direct peer-to-peer link is what failed. The
      // code was right; the two devices simply could not reach each other, and
      // saying "no room found" here sends people off debugging the wrong
      // thing. On a same-Wi-Fi game the answer is nearly always the same one.
      const d = diagnostics();
      peer.destroy();
      const hint =
        seen.size === 0
          ? 'No network candidates were gathered at all — this browser may be blocking WebRTC.'
          : d.relay
            ? 'The relay on the URL answered but the link still failed — a firewall is blocking the media path.'
            : hasTurn()
              ? 'The relay on the URL never answered — check the turnhost/turnuser/turnpass values.'
              : 'Partycombat needs every device on the same Wi-Fi. Check that this phone is on the ' +
                'same network as the host screen, and not on mobile data. Guest networks that ' +
                'isolate clients from each other will not work either.';
      const err = new Error(
        `Found room ${code}, but could not reach the host. ${hint}`
      );
      err.diagnostics = d;
      done(reject, err);
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
