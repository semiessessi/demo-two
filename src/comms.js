// Campaign comms: an event-driven dialogue queue. A line is { speaker, text, dur, audio? }; the mission
// fires lines by id (single or a sequence). Lines never overlap — they queue. Each line shows a subtitle
// (speaker name + text, coloured per character) for its duration and, if a voice file is present, plays it
// via the 2D voice bus in audio.js (ducking the music). With NO audio it's subtitle-only — the campaign is
// fully playable before any VO is recorded. Triggers poll isDone(lineId) (e.g. {commsDone:'co.checkin'}).

export function createComms({ audio, missionHud, characters = {}, getVoiceGain, duckLevel = 0.35 } = {}) {
  let lines = {};        // lineId -> { speaker, text, dur, audio?, face? }
  let faces = {};        // per-mission speaker -> portrait override (e.g. { house: 'house-operations' })
  const buffers = {};    // lineId -> decoded AudioBuffer | null (null once probed-and-missing)
  let queue = [];        // pending line ids
  let active = null;     // { id, dur, elapsed, handle }
  const played = new Set(); // line ids that have FULLY played (drives {commsDone:'id'} triggers)

  function speakerOf(def) {
    return characters[def.speaker] || { name: (def.speaker || '').toUpperCase(), color: '#cdd6ea' };
  }

  // Register a mission's lines + prefetch/decode its VO (fire-and-forget; missing files -> subtitle-only).
  function load(missionId, lineMap, faceMap) {
    clear();
    lines = lineMap || {};
    faces = faceMap || {};
    for (const id of Object.keys(lines)) {
      const stem = lines[id].audio || id;
      buffers[id] = null;
      if (audio && audio.loadVoice) {
        audio.loadVoice(`/vo/${missionId}/${stem}`).then((buf) => { buffers[id] = buf; }).catch(() => {});
      }
    }
  }

  function play(idOrArray) {
    const ids = Array.isArray(idOrArray) ? idOrArray : [idOrArray];
    for (const id of ids) if (id) queue.push(id);
  }

  function startNext() {
    const id = queue.shift();
    const def = lines[id];
    if (!def) { played.add(id); return; } // unknown line — mark done so a {commsDone} trigger can't hang
    const ch = speakerOf(def);
    // portrait: per-line `face` > per-mission `faces[speaker]` (e.g. House grounded -> house-operations) > speaker default
    const faceKey = def.face || faces[def.speaker] || def.speaker;
    if (missionHud && missionHud.showSubtitle) missionHud.showSubtitle(ch.name, def.text, ch.color, faceKey);
    let dur = def.dur || 3;
    let handle = null;
    const buf = buffers[id];
    if (buf && audio && audio.playVoice) {
      handle = audio.playVoice(buf, { gain: getVoiceGain ? getVoiceGain() : 1 });
      dur = Math.max(dur, buf.duration);
    }
    if (audio && audio.duck) audio.duck(duckLevel); // dip music while anyone is talking
    active = { id, dur, elapsed: 0, handle };
  }

  function finishActive() {
    if (!active) return;
    played.add(active.id);
    active = null;
    if (missionHud && missionHud.hideSubtitle) missionHud.hideSubtitle();
    if (!queue.length && audio && audio.duck) audio.duck(1); // restore music once nothing more is queued
  }

  function update(dt) {
    if (active) {
      active.elapsed += dt;
      if (active.elapsed >= active.dur) finishActive();
    }
    if (!active && queue.length) startNext();
  }

  function isDone(id) { return played.has(id); }
  function isBusy() { return !!active || queue.length > 0; }

  function clear() {
    if (active && active.handle && active.handle.stop) active.handle.stop();
    queue = [];
    active = null;
    played.clear();
    if (missionHud && missionHud.hideSubtitle) missionHud.hideSubtitle();
    if (audio && audio.duck) audio.duck(1);
  }

  return { load, play, update, isDone, isBusy, clear };
}
