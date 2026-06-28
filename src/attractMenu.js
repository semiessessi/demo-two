// Attract-mode title menu: the logo sat above a glassy panel with New Game / Multiplayer / Options.
// New Game + Options are disabled for now; Multiplayer is the only live entry (-> the skirmish/lobby screen).
// Self-contained: injects its own <style> once, builds the DOM, returns { el, show, hide }. It sits OVER the
// running attract cinematic (pointer-events pass through except on the panel).

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const css = `
  #attract-menu {
    position: fixed; inset: 0; z-index: 150;
    display: none; flex-direction: column; align-items: center; justify-content: center; gap: 30px;
    pointer-events: none;
  }
  #attract-menu.show { display: flex; }
  #attract-menu .am-logo {
    width: min(520px, 74vw); height: auto; user-select: none;
    filter: drop-shadow(0 6px 26px rgba(0, 0, 0, 0.75));
  }
  #attract-menu .am-panel {
    display: flex; flex-direction: column; gap: 10px;
    min-width: 268px; padding: 22px 24px;
    background: rgba(12, 14, 22, 0.62); border: 1px solid rgba(150, 180, 255, 0.12);
    border-radius: 18px; backdrop-filter: blur(8px);
    pointer-events: auto;
  }
  #attract-menu .am-btn {
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 15px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; text-align: center;
    color: #cdd6ea; background: rgba(150, 180, 255, 0.06);
    border: 1px solid rgba(150, 180, 255, 0.14); border-radius: 11px;
    padding: 12px 18px; cursor: pointer;
    transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
  }
  #attract-menu .am-btn:hover:not(:disabled) {
    background: rgba(150, 180, 255, 0.16); border-color: rgba(150, 180, 255, 0.34); color: #fff;
  }
  #attract-menu .am-btn.am-primary { color: #bcd2ff; border-color: rgba(150, 180, 255, 0.3); }
  #attract-menu .am-btn:disabled { opacity: 0.32; cursor: default; }
  `;
  const el = document.createElement('style');
  el.id = 'attract-menu-css';
  el.textContent = css;
  document.head.appendChild(el);
}

export function createAttractMenu({ onMultiplayer } = {}) {
  injectStyle();
  const wrap = document.createElement('div');
  wrap.id = 'attract-menu';
  wrap.innerHTML = `
    <img class="am-logo" src="/text-logo.png" alt="SA-43: Hammerhead" draggable="false" />
    <div class="am-panel">
      <button class="am-btn" data-act="new" disabled>New Game</button>
      <button class="am-btn am-primary" data-act="mp">Multiplayer</button>
      <button class="am-btn" data-act="opt" disabled>Options</button>
    </div>`;
  wrap.querySelector('[data-act="mp"]').addEventListener('click', () => { if (onMultiplayer) onMultiplayer(); });
  document.body.appendChild(wrap);
  return {
    el: wrap,
    show() { wrap.classList.add('show'); },
    hide() { wrap.classList.remove('show'); },
  };
}
