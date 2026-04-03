const STORAGE_KEY = "build-your-agent-theme"

export function getThemeScript() {
  return `
    (function() {
      try {
        var stored = window.localStorage.getItem("${STORAGE_KEY}");
        var source = stored === "light" || stored === "dark" ? "user" : "system";
        var theme = stored === "light" || stored === "dark"
          ? stored
          : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
        var root = document.documentElement;
        root.dataset.theme = theme;
        root.dataset.themeSource = source;
        root.style.colorScheme = theme;
        if (theme === "dark") root.classList.add("dark");
        else root.classList.remove("dark");
      } catch (error) {}
    })();
  `
}
