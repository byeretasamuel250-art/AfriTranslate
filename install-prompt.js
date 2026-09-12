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
});
