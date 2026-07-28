// TURN relay configuration.
//
// You only need this to play across *different* networks. On one shared Wi-Fi
// the browsers talk directly and none of this matters.
//
// Across networks — and especially with both devices on mobile data — a relay
// is not optional. Carriers put phones behind carrier-grade NAT, which usually
// means neither side can accept an incoming connection and no amount of STUN
// will find a path. Without a relay the join fails every time.
//
// There is no reliable zero-signup public TURN server. The one this project
// used to point at (openrelay.metered.ca) has been retired: it now answers
// STUN requests with an HTTP error. Every working option needs a free account:
//
//   Metered     https://dashboard.metered.ca  — free tier, ~50 GB/month
//   Cloudflare  https://dash.cloudflare.com   — Realtime/Calls TURN
//   Twilio      https://twilio.com            — Network Traversal Service
//
// Paste the credentials they give you below, commit, and both the host screen
// and every phone will pick them up. Prefer entries on port 443 with
// transport=tcp — they survive restrictive networks that block UDP.
//
// You can also pass them at runtime without editing this file:
//   host.html?turnhost=relay.example.com&turnuser=USER&turnpass=SECRET
// The host propagates those into its QR code, so phones inherit them.

// Metered: dashboard.metered.ca -> your app -> "TURN Server Credentials".
// Copy the username and password it shows and uncomment this block. The host
// name is the same for every Metered account; only the credentials differ.
//
// These are visible to anyone who loads the page — that is unavoidable for
// browser WebRTC, and is why the free tier is metered rather than secret. If
// the quota ever gets burned by someone else, rotate the password in the
// dashboard.
export const TURN_SERVERS = [
  // {
  //   urls: [
  //     'turn:global.relay.metered.ca:80',
  //     'turn:global.relay.metered.ca:443',
  //     'turns:global.relay.metered.ca:443?transport=tcp',
  //   ],
  //   username: 'PASTE_USERNAME',
  //   credential: 'PASTE_PASSWORD',
  // },
];

/** Runtime override from the URL, so a relay can be tried without a commit. */
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
