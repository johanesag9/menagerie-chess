// Integration lands in Phase 2 (orchestrator). Until then this page only links to the stream demos.
const app = document.getElementById('app')!;
app.innerHTML = `
  <main style="font-family: system-ui, sans-serif; max-width: 560px; margin: 48px auto; padding: 0 16px; line-height: 1.5">
    <h1>Menagerie Chess</h1>
    <p>Phase 1 in progress. Stream demos:</p>
    <ul>
      <li><a href="/src/core/demo.html">core</a></li>
      <li><a href="/src/world/demo.html">world</a></li>
      <li><a href="/src/cast/demo.html">cast</a></li>
      <li><a href="/src/ui/demo.html">ui + audio</a></li>
    </ul>
  </main>`;
