// WebRTC transport for co-op multiplayer (adapted from kemetic/senet/src/net/peer.js).
//
// PeerJS's public broker (0.peerjs.com) does the signaling — no server of our own needed. The host
// registers a peer id `d2-<CODE>`; the joiner connects to it (retrying until the host is registered or
// the deadline passes). M1 is 2-player (the host keeps a single joiner `conn`); this generalises to a
// multi-connection host relay in M5. Messages are plain objects tagged by a `.t` field (see
// protocol.js); PeerJS's default DataConnection is reliable + ordered (a dedicated unreliable state
// channel is an M5 optimisation).

const PEER_PREFIX = 'd2-';
const JOIN_RETRY_MS = 1200;
const JOIN_GIVEUP_MS = 30000;

// ICE servers: Google STUN (free, for the common direct/hole-punch case) + a free public TURN relay
// (OpenRelay) as the fallback when symmetric NAT/firewalls block a direct path — without TURN ~10-20%
// of cross-internet peers never connect. WebRTC only relays through TURN when it must; direct still wins
// when possible. Swap in a paid/own TURN (e.g. Cloudflare Realtime) later for reliability at scale.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];
const PEER_OPTS = { config: { iceServers: ICE_SERVERS } };

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no O/I/L/0/1 ambiguity
export function shortCode() {
  let id = '';
  for (let i = 0; i < 5; i++) id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return id;
}

export function createPeerTransport({ role, code }) {
  const msgHandlers = [];
  const connectedHandlers = [];
  const disconnectedHandlers = [];
  const peerLeftHandlers = [];   // host only: a joiner's data channel closed
  const conns = [];              // open DataConnections (host: many joiners; joiner: the 1 to the host)
  let pending = null;            // joiner: the in-flight connect attempt (supersede stale retries)
  let peer = null;
  let myCode = code;
  let started = false;
  let opened = false;
  let dead = false;
  let retryTimer = null;
  let giveUpAt = 0;

  function fireDisconnected(e) {
    if (dead) return;
    dead = true;
    if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
    for (const h of disconnectedHandlers) h(e);
  }

  function joinerConnect() {
    if (opened || !peer) return;
    const prev = pending;
    pending = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
    wireConn(pending);
    if (prev && prev !== pending) { try { prev.close(); } catch { /* ignore */ } }
  }

  function wireConn(c) {
    c.on('open', () => {
      opened = true;
      if (!conns.includes(c)) conns.push(c);
      if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
      for (const h of connectedHandlers) h(c);
    });
    c.on('data', (d) => { for (const h of msgHandlers) h(d, c); });
    c.on('close', () => {
      const i = conns.indexOf(c); if (i >= 0) conns.splice(i, 1);
      if (role === 'host') { for (const h of peerLeftHandlers) h(c); } // one joiner left; host stays up
      else fireDisconnected();                                         // joiner: lost the host
    });
  }

  function init() {
    if (role === 'host') {
      myCode = code || shortCode();
      peer = new window.Peer(PEER_PREFIX + myCode, PEER_OPTS);
      peer.on('open', (id) => console.log('[d2net] host peer open', id));
      peer.on('connection', (c) => { console.log('[d2net] host got joiner', c.peer); wireConn(c); });
    } else {
      peer = new window.Peer(undefined, PEER_OPTS);
      peer.on('open', () => {
        giveUpAt = Date.now() + JOIN_GIVEUP_MS;
        joinerConnect();
        retryTimer = setInterval(() => {
          if (opened) { clearInterval(retryTimer); retryTimer = null; return; }
          if (Date.now() >= giveUpAt) { fireDisconnected(); return; }
          console.log('[d2net] joiner re-attempting', PEER_PREFIX + code);
          joinerConnect();
        }, JOIN_RETRY_MS);
      });
    }
    peer.on('error', (e) => {
      const type = e?.type || e?.message || String(e);
      // joiner racing ahead of the host registering its id — not fatal, the retry loop keeps trying
      if (role === 'joiner' && type === 'peer-unavailable' && !opened && Date.now() < giveUpAt) return;
      console.warn('[d2net] peer error:', type);
      fireDisconnected(e);
    });
  }

  return {
    role,
    get code() { return myCode; },
    get connected() { return opened && !dead; },
    get peerCount() { return conns.length; },
    onConnected(h) { connectedHandlers.push(h); }, // h(conn)
    onDisconnected(h) { disconnectedHandlers.push(h); },
    onPeerLeft(h) { peerLeftHandlers.push(h); }, // host only: h(conn)
    onMessage(h) { msgHandlers.push(h); }, // h(msg, conn)
    send(msg) { for (const c of conns) { try { c.send(msg); } catch { /* not open */ } } }, // broadcast to all
    sendTo(conn, msg) { try { conn.send(msg); } catch { /* not open */ } }, // targeted (e.g. WELCOME)
    start() { if (started) return; started = true; init(); },
    close() { for (const c of conns) { try { c.close(); } catch { /* */ } } try { peer?.destroy(); } catch { /* */ } },
  };
}
