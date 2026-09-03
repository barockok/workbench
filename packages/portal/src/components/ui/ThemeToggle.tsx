function currentTheme(): "light" | "dark" {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "dark" || explicit === "light") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  function handleClick() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("wb-theme", next);
    } catch {
      // Storage may be unavailable (private mode); the DOM attribute still
      // switches for this page load.
    }
  }

  return (
    <button type="button" className="theme-toggle" onClick={handleClick} aria-label="Toggle theme">
      <span className="theme-toggle-sun" aria-hidden>☀</span>
      <span className="theme-toggle-moon" aria-hidden>☾</span>
    </button>
  );
}
