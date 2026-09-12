// Captures the browser's "install this app" event so we can show it
// on our own timing (see Step 3), instead of letting the browser show
// its own small, easy-to-miss mini-prompt.

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  // Stop the browser's automatic mini-prompt from appearing.
  event.preventDefault();
  // Save it for later - we'll use this to trigger the real prompt
  // ourselves when we show our popup.
  deferredInstallPrompt = event;

  // Show our own popup now that we know installing is possible.
  const overlay = document.getElementById("installPromptOverlay");
  if (overlay) {
    overlay.style.display = "flex";
  }
});

window.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("installPromptOverlay");
  const installBtn = document.getElementById("installAppBtn");
  const dismissBtn = document.getElementById("installDismissBtn");

  installBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    overlay.style.display = "none";
    // Show the real, browser-native install dialog.
    deferredInstallPrompt.prompt();
    // This resolves once the person accepts or dismisses that dialog.
    await deferredInstallPrompt.userChoice;
    // Each event can only be used once.
    deferredInstallPrompt = null;
  });

  dismissBtn.addEventListener("click", () => {
    overlay.style.display = "none";
  });
});
