# NeoGuard Complete System Architecture & Flow

## Overview

NeoGuard is a cloud-based neonatal monitoring system with three main components:

1. **ESP32 Device** - Collects sensor data and uploads to Firebase
2. **Firebase Cloud** - Stores data and handles authentication
3. **Web Dashboard** - Pre-login page and operator/admin dashboard

## System Components

### 1. ESP32 Firmware (`esp32/esp32_monitor.ino`)

**What it does:**
- Reads 6 sensors: baby temperature, environment temperature, SpO2, heart rate, pulse, relay states
- Connects to Wi-Fi
- Uploads telemetry data to Firebase every 3.5 seconds
- Polls Firebase every 1.2 seconds for manual commands (heater on/off, UV on/off)
- Prints Wi-Fi/cloud status to Serial Monitor

**Data paths it writes:**
- `devices/neoguard-one/telemetry/latest` - Current sensor values
- `devices/neoguard-one/telemetry/history` - Historical readings
- `devices/neoguard-one/status/connection` - Wi-Fi and IP info
- `devices/neoguard-one/commands/ack` - Acknowledgment of commands received

**Data paths it reads:**
- `devices/neoguard-one/commands/manual` - Heater and UV control commands

### 2. Firebase Project (`neoguard-88bdb`)

**Authentication:** Email/Password with email verification
**Database:** Realtime Database (asia-southeast1 region)

**User types:**
- Device user: `harishspranav2006@gmail.com` (firmware uses this to post data)
- Operator users: Sign in to dashboard (example: `a.ravindra200@gmail.com`)
- Admin user: Manages users and views logs

**Database structure:**
```
users/
  {uid}/
    name
    email
    status: "pending" | "approved" | "rejected"
    role: "operator" | "admin"
    emailVerified: boolean

deviceOwners/
  neoguard-one/
    uid: "L1ktU1QEfGf2LiEuxI0xXKRICO03"

devices/
  neoguard-one/
    telemetry/
      latest/ {babyTemp, envTemp, spo2, heartRate, pulse, heaterOn, uvOn, ...}
      history/ {multiple readings}
    status/
      connection/ {wifiConnected, ip, rssi, lastSeen}
    commands/
      manual/ {requestId, heaterState, uvState, requestedAt}
      ack/ {requestId, processedAt}
```

### 3. Web Application

#### Landing Page (`auth.html`)

**What happens:**
1. User opens website
2. Transparent login form overlay with background image
3. Two tabs: Sign In | Sign Up

**Sign In Flow:**
1. Enter email + password
2. Firebase validates credentials
3. System checks if user is approved by admin
4. System checks if email is verified
5. If all pass, redirect to dashboard
6. If pending approval, shows error message
7. If password wrong, shows error message

**Sign Up Flow:**
1. Enter name, email, password
2. Firebase creates account
3. Sends email verification link
4. Creates user record with status: "pending"
5. Admin must approve before user can log in
6. Once approved AND email verified, user can log in

#### Operator Dashboard (`web/index.html`)

**Visible only after login:**
1. User email shown in header
2. Device name: `neoguard-one`
3. Live sensor readings updated every 1-2 seconds:
   - Baby Temperature
   - Environment Temperature
   - SpO2 (blood oxygen)
   - Heart Rate
   - Pulse
4. Status indicators:
   - Heater: ON/OFF
   - Safety Relay: ARMED/DISABLED
   - Wi-Fi: CONNECTED/OFFLINE
   - Cloud Sync: SYNCED/WAITING
5. Safe status message (color-coded green/yellow/red)
6. Manual controls:
   - Heater ON/OFF buttons
   - UV ON/OFF buttons
   - Status messages confirm commands sent

#### Admin Dashboard (`admin.html`)

**Visible only to admin users:**

**Pending Approvals Section:**
- List of users waiting for approval
- Shows name, email
- Approve button → Sets status to "approved", sends email
- Reject button → Sets status to "rejected"

**User Management Section:**
- Table of all users (name, email, status, role)
- Reset Password button → Sends password reset email

**Device Logs Section:**
- Last 20 device readings (latest first)
- Shows: baby temp, SpO2, heart rate, timestamp
- Download Logs button → Exports as CSV

**Settings Section:**
- Device Name: neoguard-one
- Device ID: neoguard-one
- Database Region: asia-southeast1
- Auth settings: Email verification on, Admin approval on

## Complete User Journey

### New User Signup:
1. User opens neoguard.vercel.app
2. Redirected to auth.html
3. Clicks "Sign Up" tab
4. Enters name, email, password
5. Clicks "Request Account"
6. Email verification link sent
7. User clicks link in email (or spam folder)
8. Returns to website, email now verified
9. Wait for admin approval

### Admin Reviews Signup:
1. Admin goes to admin.html
2. Logs in with admin account
3. Opens "Pending Approvals"
4. Sees new user request
5. Clicks "Approve" button
6. New user receives approval email

### Approved User First Login:
1. User returns to auth.html
2. Enters email + password
3. System checks: verified email ✓ + approved ✓
4. Redirected to operator dashboard
5. Sees live device data
6. Can control heater and UV

### Device sends data (automatic):
1. ESP32 reads sensors every 1 second
2. Every 3.5 seconds uploads to Firebase
3. Dashboard listens in real-time
4. Displays updated values instantly

### User sends command (manual):
1. Click "Heater ON" button on dashboard
2. Command sent to Firebase commands/manual
3. ESP32 polls every 1.2 seconds
4. Finds new command
5. Applies it (turns on heater)
6. Writes acknowledgment to commands/ack
7. Dashboard confirms: "HEATER ON sent"

## Data Flow Diagram

```
ESP32 (neoguard-one)
  |
  | Sensor Data every 3.5s
  | Device Status every 5s
  | Command Poll every 1.2s
  |
  v
Firebase Cloud
  |
  |---> Realtime Database
  |       |-> telemetry/latest
  |       |-> telemetry/history
  |       |-> status/connection
  |       |-> commands/manual
  |       |-> commands/ack
  |
  |---> Authentication
  |       |-> Device user (firmware)
  |       |-> Operator users (app)
  |       |-> Admin user
  |
  v
Web Dashboard (Vercel)
  |---> auth.html
  |       |-> Sign In / Sign Up
  |       |-> Email verification
  |       |-> Admin approval wait
  |
  |---> web/index.html (operator)
  |       |-> Live telemetry
  |       |-> Manual controls
  |       |-> Status indicators
  |
  |---> admin.html (admin only)
  |       |-> User approvals
  |       |-> User management
  |       |-> Device logs
  |       |-> Settings
```

## Important Details

### Authentication Types:

1. **Device Authentication:**
   - User: `harishspranav2006@gmail.com`
   - Password: `927624BEC066`
   - Used ONLY by ESP32 firmware
   - Posts data to Firebase
   - Cannot access dashboard

2. **Operator Authentication:**
   - User: `a.ravindra200@gmail.com` (or other operators)
   - Requires admin approval
   - Requires email verification
   - Can view real-time data
   - Can control heater/UV

3. **Admin Authentication:**
   - Same as operator but with role: "admin"
   - Extra access to pending approvals and user management
   - Can reset user passwords
   - Can download device logs

### Email Verification:
- When user signs up, verification email sent
- Email may go to spam folder
- User must click link to verify
- Without verification, cannot log in even if approved

### Admin Approval:
- New signups are "pending" status
- Admin sees them in "Pending Approvals"
- Admin clicks "Approve"
- User status changes to "approved"
- Now user can log in (if also email verified)

### Password Reset:
- On auth.html, click "Forgot?" button
- Enter email
- Firebase sends password reset email
- User clicks link
- Sets new password
- Logs in with new password

### Device/Admin sees password reset:**
- Admin dashboard "User Management"
- Click "Reset Password" button for any user
- Password reset email sent to that user

## Security & Access Control

### Firebase Rules (`firebase.database.rules.json`):

```
- Only authenticated users can read/write
- Device can only write to its own paths
- Device can only read commands for its device
- Operators can only read telemetry they're authorized for
- Device ownership tracked for authorization
```

### File Access:
- `web/firebase-config.js` is committed (contains Firebase config)
- Real devices cannot see user passwords (hashed in Firebase)
- logs are accessible to admin only

## Testing Checklist

### Before deployment:
1. [ ] Device user created in Firebase Auth
2. [ ] Operator user created in Firebase Auth
3. [ ] Admin user created with role: "admin"
4. [ ] Device ownership record created: `deviceOwners/neoguard-one/uid`
5. [ ] Firebase rules published from `firebase.database.rules.json`
6. [ ] ESP32 firmware compiled with correct credentials
7. [ ] ESP32 flashed and Serial Monitor shows cloud connection
8. [ ] Root index.html redirects to auth.html

### After Vercel deployment:
1. [ ] Open production URL
2. [ ] Redirected to auth.html
3. [ ] Sign up as new user
4. [ ] Receive verification email
5. [ ] Verify email
6. [ ] Wait for admin approval
7. [ ] Log in to dashboard with operator account
8. [ ] See device data if ESP32 is online
9. [ ] Click Heater ON → check Serial Monitor
10. [ ] Check admin dashboard approvals
11. [ ] Check user management
12. [ ] Download logs as CSV

## Next Steps

1. **Verify Firebase setup:**
   - All 3 users created
   - Device ownership record set
   - Rules published

2. **Upload ESP32 firmware:**
   - Install Arduino libraries
   - Compile and upload
   - Check Serial Monitor output

3. **Deploy to Vercel:**
   - Push to GitHub
   - Import repo in Vercel
   - Deploy (no build command needed)

4. **Test full workflow:**
   - Sign up
   - Wait for approval
   - Log in
   - View data
   - Control device

## Troubleshooting

**Device not sending data:**
- Check Serial Monitor for Wi-Fi connection
- Check Firebase rules are published
- Check device credentials are correct
- Check device ownership record exists

**Cannot sign in:**
- Check email is verified
- Check user is approved
- Check Firebase Auth has user
- Check password is correct

**No data on dashboard:**
- Device may be offline (check Wi-Fi status)
- Database rules may be wrong
- Device may not be configured correctly

**Admin dashboard access denied:**
- Check user role is "admin"
- Check localStorage has correct role
- Check Firebase Auth sees user as signed in
