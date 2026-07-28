// Relay configuration — deliberately empty.
//
// **Partycombat is a same-Wi-Fi game.** Everyone — the host screen and every
// phone — joins the same wireless network, and the browsers open a direct
// peer-to-peer link over the LAN. Nothing else is needed and nothing else is
// supported.
//
// That is a choice, not a limitation we failed to fix. Playing across networks
// means every byte of gameplay traffic has to be bounced through a TURN relay,
// because phones on mobile data sit behind carrier-grade NAT where neither side
// can accept an incoming connection. A relay means an account, credentials
// baked into a public page, a monthly bandwidth quota, and a new way for the
// game to break that looks exactly like an ordinary network problem. For a
// party game where everyone is in the same room anyway, the trade is not worth
// it — so the requirement is simply: same Wi-Fi.
//
// The list below stays empty. Nothing here is a placeholder waiting to be
// filled in.
export const TURN_SERVERS = [];

// One escape hatch, off by default and never committed: if you ever do want to
// play across networks, pass a relay's details on the URL.
//
//   host.html?turnhost=relay.example.com&turnuser=USER&turnpass=SECRET
//
// The host propagates those into its QR code so phones inherit them. Metered,
// Cloudflare and Twilio all have free tiers. Note that credentials on a URL are
// visible to everyone who scans the QR — unavoidable for browser WebRTC, which
// is the other reason they are not the default.
export function turnFromUrl(search = location.search) {
  const q = new URLSearchParams(search);
  const host = q.get('turnhost');
  if (!host) return [];
  return [
    {
      urls: [`turn:${host}:443?transport=tcp`, `turns:${host}:443?transport=tcp`, `turn:${host}:80`],
      username: q.get('turnuser') || '',
      credential: q.get('turnpass') || '',
    },
  ];
}

export const hasTurn = () => TURN_SERVERS.length > 0 || turnFromUrl().length > 0;
