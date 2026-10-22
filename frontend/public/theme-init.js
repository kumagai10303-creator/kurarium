(function () {
  try {
    var theme = localStorage.getItem('nmv-theme');
    if (
      theme === 'dark' ||
      (theme === null && window.matchMedia('(prefers-color-scheme: dark)').matches)
    ) {
      document.documentElement.classList.add('dark');
    }
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
})();
