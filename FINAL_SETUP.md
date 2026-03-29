# NeoGuard - Final Deployment Checklist

## Status: Code Complete ✓

All code changes have been implemented and pushed to GitHub.

Device ID: **neoguard-one**
Dashboard type: **Pre-login page + Operator + Admin dashboard**
Authentication: **Email/Password with admin approval**

---

## Final Setup Steps (Before Testing)

### Step 1: Verify Firebase Database Rules (Critical)

1. Open Firebase Console → neoguard-88bdb
2. Go to Realtime Database → Rules
3. Copy all content from `firebase.database.rules.json` in your repo
4. Paste into Firebase Rules editor
5. Click Publish

**Expected rules summary:**
- Devices can write only to their own paths
- Users need approval to read data
- Commands are request-based

### Step 2: Create Device Ownership Record (Critical)

**Action in Firebase Console:**

1. Go to Realtime Database → Data
2. Click Add child to create new paths
3. Create: `deviceOwners` (parent)
4. Under deviceOwners, create: `neoguard-one` (child)
5. Under neoguard-one, create: `uid` (child)
6. Set value to the device user UID: **L1ktU1QEfGf2LiEuxI0xXKRICO03**

**Final path structure:**
```
deviceOwners
  └── neoguard-one
      └── uid: "L1ktU1QEfGf2LiEuxI0xXKRICO03"
```

**Why:** Rules check this to authorize ESP32 to write telemetry.

### Step 3: Verify Users Exist in Firebase Auth

Go to Firebase → Authentication → Users

Check:
- [ ] harishspranav2006@gmail.com (Device user) - UID copied above
- [ ] a.ravindra200@gmail.com (Operator user)
- [ ] suruthi@gmail.com (Second operator or admin)

### Step 4: Make One User an Admin

1. Go to Firebase → Authentication → Users
2. Click on one user (example: suruthi@gmail.com)
3. Compare their UID
4. Go to Realtime Database → Data
5. Create or find: `users/{UID_of_admin_user}`
6. Set `role: "admin"`

**Result:**
```
users
  └── <suruthi_UID>
      ├── name: "suruthi"
      ├── email: "suruthi@gmail.com"
      ├── role: "admin"
      ├── status: "approved"
      └── emailVerified: true
```

### Step 5: Upload ESP32 Firmware

1. Open Arduino IDE
2. Install libraries (Sketch → Include Library → Manage Libraries):
   - Firebase Arduino Client Library for ESP8266 and ESP32 (by mobizt)
   - OneWire
   - DallasTemperature
   - DHT sensor library
   - MAX30100 library

3. Open: `esp32/esp32_monitor.ino`
4. Select Tools → Board → ESP32 Dev Module (or your exact board)
5. Select Tools → Port → COM## (your USB port)
6. Click Upload arrow
7. Wait for "Uploading..."
8. When done, click Serial Monitor (Tools → Serial Monitor)
9. Set baud: 115200
10. Watch for messages:
    - "WiFi connected"
    - "IP Address: 192.168.x.x"
    - "Firebase ready"
    - Periodic "telemetry push" messages

### Step 6: Deploy to Vercel

1. Go to vercel.com (sign in with GitHub)
2. Click "Add New" → "Project"
3. Select your NeoGuard GitHub repo
4. Leave settings as default (no build command needed)
5. Click "Deploy"
6. Wait for deployment (1-2 minutes)
7. Copy the .vercel.app URL

### Step 7: Test Complete Flow

**Test 1: Sign Up**
1. Open your Vercel URL (e.g., neoguard.vercel.app)
2. Redirected to auth.html
3. Click "Sign Up" tab
4. Enter: Test Name, testemail@yourdomain.com, password123
5. Click "Request Account"
6. Check email (may b in spam) for verification link
7. Click verification link
8. Email now verified

**Test 2: Admin Approval**
1. In another tab/incognito window, open admin.html on your Vercel URL
2. Sign in as admin user (suruthi@gmail.com with password)
3. Should land in admin dashboard
4. Click "Pending Approvals"
5. See your test user
6. Click "Approve"
7. Test user now approved

**Test 3: Operator Login**
1. In original incognito tab, refresh
2. Try signing in with: testemail@yourdomain.com / password123
3. Should reach operator dashboard
4. Should see: "Listening for device neoguard-one"

**Test 4: Live Data**
1. Check Serial Monitor on ESP32
2. If it shows "firebase ready" and telemetry pushes, data should appear on dashboard
3. Metrics should update every few seconds

**Test 5: Manual Control**
1. On operator dashboard, click "Heater ON"
2. Watch Serial Monitor, should see command processed
3. Check acknowledgment in database

---

## What People See After This Setup

### New User Experience:
1. Opens website → Sign up
2. Verifies email
3. Admin approves
4. Logs in
5. Sees live device data

### Admin Experience:
1. Logs in with admin account
2. Reviews pending user signups
3. Approves users
4. Can reset passwords
5. Can download device logs
6. Can manage all users

### Operator Experience:
1. Logs in
2. Sees real-time sensor data
3. Can turn heater on/off
4. Can turn UV sterilizer on/off
5. Sees device status (Wi-Fi, Cloud Sync)

---

## File Summary

**New Files Created:**
- `auth.html` - Pre-login landing page
- `auth/auth.js` - Sign in/up logic with email verification
- `admin.html` - Admin dashboard
- `admin/admin.js` - User approval and log management
- `SYSTEM_FLOW.md` - This document + detailed architecture
- `firebase.database.rules.json` - Security rules to paste
- `vercel.json` - Vercel configuration

**Modified Files:**
- `esp32/esp32_monitor.ino` - Updated with device `neoguard-one`
- `web/index.html` - Removed auth cards, added logout
- `web/app.js` - Auth guard, removed internal login logic
- `web/firebase-config.js` - Your real Firebase config
- `index.html` - Redirects to auth.html

---

## Quick Reference

| Component | Value |
|-----------|-------|
| Device ID | `neoguard-one` |
| Firebase Project | `neoguard-88bdb` |
| Region | `asia-southeast1` |
| Device User | `harishspranav2006@gmail.com` |
| Database URL | `https://neoguard-88bdb-default-rtdb.asia-southeast1.firebasedatabase.app` |
| Vercel URL | (generated during deploy) |

---

## Still Blocked On?

If you get stuck, check:

1. **"Firebase not ready" in Serial Monitor:**
   - Device password might be wrong
   - Device user might not exist
   - Device ownership record missing
   - Rules not published

2. **Cannot sign in to dashboard:**
   - Email not verified
   - User not approved yet
   - Wrong password
   - User doesn't exist in Firebase Auth

3. **No device data on dashboard:**
   - ESP32 Wi-Fi connection failed
   - Device offline
   - Wrong device ID in code vs config
   - Database rules blocking reads

4. **Admin dashboard won't show:**
   - User role not set to "admin"
   - Not viewing correct admin.html URL
   - localStorage corrupted (clear cache)

---

## You're Almost Done!

Once steps 1-7 complete and tests pass, you have:
- ✓ Cloud-based device data logging
- ✓ Email verification for security
- ✓ Admin approval workflow
- ✓ Real-time dashboard
- ✓ Manual device control
- ✓ Admin logs & management
- ✓ Public web deployment

All data flows through Firebase Realtime Database, so you can access from any device, anywhere!
