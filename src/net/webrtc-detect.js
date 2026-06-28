// Feature-detect "would PeerJS actually work here?" — used to gate the co-op multiplayer UI so users
// on devices that can't establish a WebRTC peer don't see error logs and dead waiting rooms.
//
// PeerJS hardcodes `!this.isIOS` in its support check (vendor/peerjs.min.js -> isBrowserSupported), so
// it refuses to construct a working Peer on any iPhone/iPad even though iOS Safari has full WebRTC. We
// mirror that detection here so the UI degrades before PeerJS logs "browser-incompatible".
// (Adapted verbatim from kemetic/senet/src/net/webrtc-detect.js.)

let cached = null;

export function peerJsWorksHere() {
  if (cached !== null) return cached;
  cached = compute();
  return cached;
}

function compute() {
  if (typeof window === 'undefined') return false;
  if (typeof window.RTCPeerConnection !== 'function') return false;
  if (typeof window.Peer !== 'function') return false; // vendored peerjs not loaded
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && (navigator.maxTouchPoints || 0) > 1);
  if (isIOS) return false;
  return true;
}
