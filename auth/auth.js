if (!window.NEOGUARD_FIREBASE_CONFIG) {
  alert('Missing firebase-config.js');
  throw new Error('Missing NEOGUARD_FIREBASE_CONFIG');
}

firebase.initializeApp(window.NEOGUARD_FIREBASE_CONFIG);
const auth = firebase.auth();
const database = firebase.database();

function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  document.getElementById(tabName + '-tab').classList.add('active');
  event.target.classList.add('active');
}

function showStatus(tabName, message, type) {
  const statusEl = document.getElementById(tabName + '-status');
  statusEl.textContent = message;
  statusEl.className = `status-message show ${type}`;
  setTimeout(() => statusEl.classList.remove('show'), 4000);
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
  showStatus('signup', 'Creating account...', 'info');

  try {
    const result = await auth.createUserWithEmailAndPassword(email, password);
    const user = result.user;

    await user.sendEmailVerification();

    const userRef = database.ref(`users/${user.uid}`);
    await userRef.set({
      name: name,
      email: email,
      status: 'pending',
      role: 'operator',
      createdAt: new Date().toISOString(),
      emailVerified: false
    });

    showStatus('signup', 'Account created! Check your email to verify. Admin will approve soon.', 'success');
    
    setTimeout(() => {
      document.getElementById('signup-name').value = '';
      document.getElementById('signup-email').value = '';
      document.getElementById('signup-password').value = '';
      switchTab('signin');
    }, 3000);
  } catch (error) {
    console.error(error);
    if (error.code === 'auth/email-already-in-use') {
      showStatus('signup', 'Email already registered', 'error');
    } else {
      showStatus('signup', error.message, 'error');
    }
    document.getElementById('signup-btn').disabled = false;
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
  if (user && localStorage.getItem('neoguard-auth') === 'true') {
    const role = JSON.parse(localStorage.getItem('neoguard-user') || '{}').role;
    if (role === 'admin') {
      window.location.href = './admin.html';
    } else {
      window.location.href = './web/index.html';
    }
  }
});
