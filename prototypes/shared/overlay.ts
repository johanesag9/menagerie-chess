import './overlay.css';

const DIRS = [
  { id: 'a', path: '../a-shoreline/', name: 'Shoreline diorama' },
  { id: 'b', path: '../b-whale/', name: "Whale's back" },
  { id: 'c', path: '../c-giant-table/', name: "Giant's dinner table" },
];

export function overlay(current: 'a' | 'b' | 'c', mood: string) {
  const d = DIRS.find((x) => x.id === current)!;
  const el = document.createElement('div');
  el.className = 'ov';
  el.innerHTML = `
    <header class="ov-card">
      <a class="ov-back" href="../index.html" aria-label="All directions">←</a>
      <div>
        <div class="ov-kicker">Direction ${current.toUpperCase()}</div>
        <h1>${d.name}</h1>
        <p>${mood}</p>
      </div>
    </header>
    <nav class="ov-nav">
      ${DIRS.map((x) => `<a href="${x.path}" class="${x.id === current ? 'on' : ''}">${x.id.toUpperCase()}</a>`).join('')}
    </nav>
    <footer class="ov-foot">
      <span>Drag to orbit · scroll or pinch to zoom</span>
      <span class="ov-note">Stand-in animals from Phase 0. The cast session builds the real ones.</span>
    </footer>`;
  document.body.appendChild(el);
}
