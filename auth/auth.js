if (!window.NEOGUARD_FIREBASE_CONFIG) {
  alert('Missing firebase-config.js');
  throw new Error('Missing NEOGUARD_FIREBASE_CONFIG');
}

firebase.initializeApp(window.NEOGUARD_FIREBASE_CONFIG);
const auth = firebase.auth();
const database = firebase.database();
const BOOTSTRAP_ADMIN_EMAILS = ['harishspranav2006@gmail.com'];

const signupState = {
  accountCreated: false,
};

function isBootstrapAdmin(email) {
  return BOOTSTRAP_ADMIN_EMAILS.includes((email || '').toLowerCase());
}

function switchTab(tabName, clickedButton) {
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  document.getElementById(tabName + '-tab').classList.add('active');
  const targetBtn = clickedButton || document.getElementById(`${tabName}-tab-btn`);
  if (targetBtn) {
    targetBtn.classList.add('active');
  }
}

function showStatus(tabName, message, type) {
  const statusEl = document.getElementById(tabName + '-status');
  statusEl.textContent = message;
  statusEl.className = `status-message show ${type}`;
  if (type !== 'warning') {
    setTimeout(() => statusEl.classList.remove('show'), 5000);
  }
}

function clearErrors(prefix) {
  document.querySelectorAll(`[id^="${prefix}-"][id$="-error"]`).forEach(el => {
    el.textContent = '';
    el.classList.remove('show');
  });
}

async function handleSignIn() {
  clearErrors('signin');
  const email = document.getElementById('signin-email').value.trim();
  const password = document.getElementById('signin-password').value.trim();

  if (!email || !password) {
    showStatus('signin', 'Please fill in all fields', 'error');
    return;
  }

  document.getElementById('signin-btn').disabled = true;
  showStatus('signin', 'Signing in...', 'info');

  try {
    await auth.signInWithEmailAndPassword(email, password);
    
    const user = auth.currentUser;
    
    if (!user.emailVerified) {
      showStatus('signin', 'Please verify your email first. Check your mail inbox.', 'error');
      document.getElementById('signin-btn').disabled = false;
      await auth.signOut();
      return;
    }

    if (isBootstrapAdmin(user.email)) {
      try {
        await database.ref(`users/${user.uid}`).update({
          name: user.displayName || 'System Admin',
          email: user.email,
          role: 'admin',
          status: 'approved',
          emailVerified: true,
          updatedAt: new Date().toISOString()
        });
      } catch (e) {
        console.log('Bootstrap admin profile update skipped:', e.message);
      }

      localStorage.setItem('neoguard-auth', 'true');
      localStorage.setItem('neoguard-user', JSON.stringify({
        uid: user.uid,
        email: user.email,
        role: 'admin'
      }));
      window.location.href = './admin.html';
      return;
    }

    let userData = { role: 'operator' };
    try {
      const userRef = database.ref(`users/${user.uid}`);
      const snapshot = await userRef.once('value');
      userData = snapshot.val() || { role: 'operator' };
    } catch (dbError) {
      console.log('Reading user data from database...');
    }

    if (!userData || userData.status !== 'approved') {
      await auth.signOut();
      showStatus('signin', 'Account not approved yet. Please check email for admin confirmation.', 'error');
      document.getElementById('signin-btn').disabled = false;
      return;
    }

    localStorage.setItem('neoguard-auth', 'true');
    localStorage.setItem('neoguard-user', JSON.stringify({
      uid: user.uid,
      email: user.email,
      role: userData.role || 'operator'
    }));

    if (userData.role === 'admin') {
      window.location.href = './admin.html';
    } else {
      window.location.href = './web/index.html';
    }
  } catch (error) {
    console.error(error);
    if (error.code === 'auth/user-not-found') {
      showStatus('signin', 'User not found. Sign up instead.', 'error');
    } else if (error.code === 'auth/wrong-password') {
      showStatus('signin', 'Wrong password', 'error');
    } else {
      showStatus('signin', error.message, 'error');
    }
    document.getElementById('signin-btn').disabled = false;
  }
}

async function handleSignUp() {
  clearErrors('signup');
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value.trim();

  if (!name || !email || !password) {
    showStatus('signup', 'Please fill in all fields', 'error');
    return;
  }

  if (password.length < 6) {
    showStatus('signup', 'Password must be at least 6 characters', 'error');
    return;
  }

  document.getElementById('signup-btn').disabled = true;
  showStatus('signup', 'Creating account and sending verification mail...', 'info');

  try {
    let user = auth.currentUser;
    if (!user || user.email !== email) {
      const result = await auth.createUserWithEmailAndPassword(email, password);
      user = result.user;
    }

    await user.sendEmailVerification();
    signupState.accountCreated = true;

    document.getElementById('request-access-btn').style.display = 'block';
    showStatus('signup', 'IMPORTANT: Please verify your email from INBOX/SPAM/JUNK, then click REQUEST ACCESS below.', 'warning');
  } catch (error) {
    console.error(error);
    if (error.code === 'auth/email-already-in-use') {
      showStatus('signup', 'Email already registered. Sign in first, verify email, then request access.', 'error');
    } else {
      showStatus('signup', error.message, 'error');
    }
  }

  document.getElementById('signup-btn').disabled = false;
}

async function handleRequestAccess() {
  clearErrors('signup');

  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value.trim();

  if (!name || !email || !password) {
    showStatus('signup', 'Fill name, email, password first.', 'error');
    return;
  }

  let user = auth.currentUser;

  try {
    if (!user || user.email !== email) {
      const result = await auth.signInWithEmailAndPassword(email, password);
      user = result.user;
    }

    await user.reload();

    if (!user.emailVerified) {
      showStatus('signup', 'You have not verified email yet. Please verify from inbox/spam/junk and then click REQUEST ACCESS.', 'warning');
      return;
    }

    await database.ref(`users/${user.uid}`).set({
      name,
      email,
      status: 'pending',
      role: 'operator',
      createdAt: new Date().toISOString(),
      emailVerified: true
    });

    signupState.accountCreated = false;
    showStatus('signup', 'Request submitted successfully. Admin will now see your account in pending approvals.', 'success');

    await auth.signOut();

    setTimeout(() => {
      document.getElementById('signup-name').value = '';
      document.getElementById('signup-email').value = '';
      document.getElementById('signup-password').value = '';
      document.getElementById('request-access-btn').style.display = 'none';
      switchTab('signin');
    }, 2500);
  } catch (error) {
    console.error(error);
    showStatus('signup', error.message || 'Unable to request access. Please try again.', 'error');
  }
}

async function handleForgotPassword() {
  const email = document.getElementById('signin-email').value.trim();
  if (!email) {
    showStatus('signin', 'Enter your email first', 'error');
    return;
  }

  try {
    await auth.sendPasswordResetEmail(email);
    showStatus('signin', 'Password reset email sent. Check your inbox.', 'success');
  } catch (error) {
    showStatus('signin', error.message, 'error');
  }
}

auth.onAuthStateChanged((user) => {
  if (!localStorage.getItem('neoguard-auth')) {
    const requestBtn = document.getElementById('request-access-btn');
    if (requestBtn) {
      requestBtn.style.display = user ? 'block' : 'none';
    }
  }

  if (user && localStorage.getItem('neoguard-auth') === 'true') {
    const role = JSON.parse(localStorage.getItem('neoguard-user') || '{}').role;
    if (role === 'admin') {
      window.location.href = './admin.html';
    } else {
      window.location.href = './web/index.html';
    }
  }
});
