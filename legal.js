// Afrischool - in-app Terms / Privacy / About viewer.
//
// WHY THIS EXISTS: terms.html, privacy.html, and about.html need to stay
// reachable as plain standalone pages too (Google Play, app-store, and
// Pesapal merchant listings all typically ask for a direct URL to a
// hosted privacy policy). But tapping "Terms" from inside the app itself
// should feel like part of the app, not a jump out to a separate browser
// tab or page reload - that's what this file does: it fetches the same
// standalone page, pulls out just its content (the .page div, minus the
// "back to Afrischool" link, which doesn't make sense inside a modal),
// and shows it in an overlay layered on top of whatever screen the
// person is already on.
//
// Single source of truth: the content only ever lives in terms.html /
// privacy.html / about.html themselves - this file never duplicates the
// legal text, so there's no risk of the in-app copy and the standalone
// page drifting apart.

const legalModalOverlay = document.getElementById("legalModalOverlay");
const legalModalTitle = document.getElementById("legalModalTitle");
const legalModalBody = document.getElementById("legalModalBody");
const legalModalClose = document.getElementById("legalModalClose");

async function openLegalModal(page, title) {
  legalModalTitle.textContent = title;
  legalModalBody.innerHTML = '<p class="placeholder">Loading...</p>';
  legalModalOverlay.style.display = "flex";

  try {
    const response = await fetch(page);
    if (!response.ok) throw new Error("Failed to load " + page);
    const html = await response.text();

    // Parse the fetched page as a standalone document, then pull out
    // just the .page div's content - not the whole <html>/<head>, and
    // not the standalone page's own <style> block (the modal has its
    // own matching styles in style.css instead, see .legal-modal-body).
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const pageContent = parsed.querySelector(".page");

    legalModalBody.innerHTML = pageContent
      ? pageContent.innerHTML
      : "<p>Couldn't load this page.</p>";
  } catch (err) {
    legalModalBody.innerHTML = "<p>Couldn't load this page - please check your connection and try again.</p>";
  }
}

function closeLegalModal() {
  legalModalOverlay.style.display = "none";
}

// Wire up every link marked with data-legal-page, wherever it appears
// (auth screen footer, signed-in app footer, anywhere else added later)
// - no need to touch this file again when a new legal link is added
// elsewhere in index.html.
document.querySelectorAll("[data-legal-page]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    openLegalModal(link.dataset.legalPage, link.dataset.legalTitle || "");
  });
});

legalModalClose.addEventListener("click", closeLegalModal);

// Tapping the dimmed backdrop (outside the card itself) also closes it -
// same pattern as the existing subscription modal.
legalModalOverlay.addEventListener("click", (event) => {
  if (event.target === legalModalOverlay) closeLegalModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && legalModalOverlay.style.display !== "none") {
    closeLegalModal();
  }
});
