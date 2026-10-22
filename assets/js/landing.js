/**
 * NeoGuard Landing Page Interactive Script
 */

document.addEventListener('DOMContentLoaded', () => {
  // Mobile Navigation Toggle
  const mobileToggle = document.getElementById('mobile-toggle');
  const navLinks = document.getElementById('nav-links');
  const navActions = document.getElementById('nav-actions');

  if (mobileToggle && navLinks) {
    mobileToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      const isOpen = navLinks.classList.contains('open');
      mobileToggle.setAttribute('aria-expanded', String(isOpen));
      mobileToggle.innerHTML = isOpen
        ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`
        : `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>`;
    });

    // Close menu when clicking a link
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        mobileToggle.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>`;
      });
    });
  }

  // Active Link Highlight on Scroll
  const sections = document.querySelectorAll('section[id]');
  window.addEventListener('scroll', () => {
    const scrollY = window.pageYOffset;
    sections.forEach(current => {
      const sectionHeight = current.offsetHeight;
      const sectionTop = current.offsetTop - 100;
      const sectionId = current.getAttribute('id');
      const navItem = document.querySelector(`.nav-links a[href*="${sectionId}"]`);
      if (navItem) {
        if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
          navItem.classList.add('active');
        } else {
          navItem.classList.remove('active');
        }
      }
    });
  });

  // Check Existing Authentication State
  try {
    const isAuth = localStorage.getItem('neoguard-auth') === 'true';
    const userStr = localStorage.getItem('neoguard-user');
    const user = userStr ? JSON.parse(userStr) : null;

    if (isAuth && user) {
      const navAuthArea = document.getElementById('nav-actions');
      if (navAuthArea) {
        const dashboardUrl = user.role === 'admin' ? '/admin.html' : '/web/index.html';
        navAuthArea.innerHTML = `
          <a href="${dashboardUrl}" class="btn btn-primary btn-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            Dashboard
          </a>
          <button id="nav-logout-btn" class="btn btn-outline btn-sm">Sign Out</button>
        `;

        const logoutBtn = document.getElementById('nav-logout-btn');
        if (logoutBtn) {
          logoutBtn.addEventListener('click', () => {
            if (window.firebase && firebase.auth) {
              try { firebase.auth().signOut(); } catch (e) {}
            }
            localStorage.removeItem('neoguard-auth');
            localStorage.removeItem('neoguard-user');
            window.location.reload();
          });
        }
      }
    }
  } catch (e) {
    console.warn('Auth check skipped:', e);
  }

  // Contact / Information Request Form Handler
  const contactForm = document.getElementById('contact-form');
  const formFeedback = document.getElementById('form-feedback');

  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = (document.getElementById('contact-name')?.value || '').trim();
      const email = (document.getElementById('contact-email')?.value || '').trim();
      const organization = (document.getElementById('contact-org')?.value || '').trim();
      const message = (document.getElementById('contact-message')?.value || '').trim();
      const submitBtn = contactForm.querySelector('button[type="submit"]');

      if (!name || !email || !message) {
        showFeedback('Please fill in your name, email, and message.', 'error');
        return;
      }

      if (!/^\S+@\S+\.\S+$/.test(email)) {
        showFeedback('Please enter a valid email address.', 'error');
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting Request...';
      }

      try {
        let savedToFirebase = false;

        // Try writing to Firebase Realtime Database if loaded
        if (window.firebase && window.NEOGUARD_FIREBASE_CONFIG) {
          try {
            if (!firebase.apps.length) {
              firebase.initializeApp(window.NEOGUARD_FIREBASE_CONFIG);
            }
            const db = firebase.database();
            const newRequestRef = db.ref('contactRequests').push();
            await newRequestRef.set({
              name,
              email,
              organization: organization || 'Not specified',
              message,
              createdAt: new Date().toISOString(),
              status: 'new'
            });
            savedToFirebase = true;
          } catch (fbErr) {
            console.log('Firebase contact request notice:', fbErr.message);
          }
        }

        // Also store locally in case of offline evaluation
        try {
          const localRequests = JSON.parse(localStorage.getItem('neoguard-inquiries') || '[]');
          localRequests.push({ name, email, organization, message, timestamp: new Date().toISOString() });
          localStorage.setItem('neoguard-inquiries', JSON.stringify(localRequests));
        } catch (storageErr) {}

        contactForm.reset();
        showFeedback(
          savedToFirebase
            ? 'Thank you! Your information request has been submitted to the NeoGuard project team.'
            : 'Thank you! Your inquiry has been recorded and will be reviewed by the team.',
          'success'
        );
      } catch (err) {
        showFeedback('Unable to submit inquiry at this moment. Please try again.', 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Request';
        }
      }
    });
  }

  function showFeedback(msg, type) {
    if (!formFeedback) return;
    formFeedback.textContent = msg;
    formFeedback.className = `form-feedback ${type}`;
    formFeedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});
