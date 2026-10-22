/**
 * NeoGuard Simulation Results Interactive Script
 */

document.addEventListener('DOMContentLoaded', () => {
  const dialog = document.getElementById('lightbox-dialog');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxBadge = document.getElementById('lightbox-badge');
  const lightboxTitle = document.getElementById('lightbox-title');
  const closeBtn = document.getElementById('lightbox-close-btn');

  // Open Lightbox
  window.openLightbox = function(src, badgeText, titleText) {
    if (!dialog || !lightboxImg) return;

    lightboxImg.src = src;
    if (lightboxBadge) lightboxBadge.textContent = badgeText || 'Simulation Result';
    if (lightboxTitle) lightboxTitle.textContent = titleText || 'Simulation Inspection';

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  };

  // Close Lightbox
  function closeLightbox() {
    if (!dialog) return;
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
    if (lightboxImg) lightboxImg.src = '';
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeLightbox);
  }

  if (dialog) {
    // Close on backdrop click
    dialog.addEventListener('click', (e) => {
      const rect = dialog.getBoundingClientRect();
      const isInDialog = (
        rect.top <= e.clientY &&
        e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX &&
        e.clientX <= rect.left + rect.width
      );
      if (!isInDialog) {
        closeLightbox();
      }
    });

    // Close on Escape key
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeLightbox();
    });
  }

  // Fallback image error handler
  window.handleSimImageError = function(imgElement, simNumber) {
    if (!imgElement) return;
    imgElement.onerror = null;
    imgElement.src = `/assets/simulations/sm${simNumber}.jpeg`;
  };
});
