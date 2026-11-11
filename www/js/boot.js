(function () {
  try {
    var raw = localStorage.getItem("west2romaji.settings");
    var theme = raw ? JSON.parse(raw).theme : "";
    if (theme === "dark" || theme === "light") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch (error) {
    /* Keep the system theme if settings are unreadable. */
  }

  // The installed app's safe area starts at 0 and then grows. That growth
  // is what slides the page down. Pin the final insets before the first paint.
  if (location.protocol === "app:" || location.protocol === "file:") {
    document.documentElement.style.setProperty("--safe-top", "59px");
    document.documentElement.style.setProperty("--safe-bottom", "34px");
  }

  window.west2romajiReady = new Promise(function (resolve) {
    var settled = false;
    function finish(inCordova) {
      if (settled) return;
      settled = true;
      resolve(!!inCordova);
    }

    document.addEventListener(
      "deviceready",
      function () {
        finish(true);
      },
      { once: true }
    );

    window.addEventListener("load", function () {
      setTimeout(function () {
        if (!window.cordova) finish(false);
      }, 0);
    });

    setTimeout(function () {
      finish(!!window.cordova);
    }, 8000);
  });
})();
