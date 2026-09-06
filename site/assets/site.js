// Copy buttons and the terminal replay. No framework; the page is one file.
for (const el of document.querySelectorAll("[data-copy] .copy")) {
  el.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(el.parentElement.dataset.copy); el.textContent = "Copied"; setTimeout(() => (el.textContent = "Copy"), 1600); } catch { el.textContent = "Select and copy"; }
  });
}
const term = document.getElementById("terminal"), steps = JSON.parse(document.getElementById("replay-data").textContent);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const line = (cls, text) => { const p = document.createElement("pre"); p.className = "t-" + cls; p.textContent = text; term.appendChild(p); return p; };
async function type(el, text, ms = 14) { if (reduced) { el.textContent = text; return; } for (const ch of text) { el.textContent += ch; await new Promise((r) => setTimeout(r, ms)); } }
async function run() {
  term.textContent = "";
  for (const s of steps) {
    if (s.prompt) await type(line("prompt", ""), "› " + s.prompt, 18);
    else if (s.call) await type(line("call", ""), `${s.call.tool}(${JSON.stringify(s.call.args, null, 1).replace(/\n\s*/g, " ")})`, 6);
    else if (s.result) { line("result", "← " + s.result); }
    await new Promise((r) => setTimeout(r, reduced ? 0 : 500));
  }
  if (!reduced) setTimeout(run, 6000);
}
new IntersectionObserver((e, o) => { if (e[0].isIntersecting) { run(); o.disconnect(); } }).observe(term);
