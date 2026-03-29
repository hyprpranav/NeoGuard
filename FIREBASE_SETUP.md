# NeoGuard Vercel + Firebase Step-by-Step Guide

This project is simplified for easy hosting:

1. Dashboard is a static website on Vercel.
2. ESP32 sends telemetry directly to Firebase Realtime Database.
3. Dashboard reads telemetry from Firebase in real-time.
4. Dashboard writes manual commands to Firebase.
5. ESP32 reads commands from Firebase and applies ON/OFF states.

## A. Exactly what you must create in Firebase

1. Open Firebase Console.
2. Click Create project.
3. Project name: choose any (example: `neoguard-cloud`).
4. In left menu, open Authentication.
5. Click Get started.
6. Open Sign-in method tab.
7. Enable Email/Password provider.
8. Save.
9. Open Build -> Realtime Database.
10. Click Create Database.
11. Choose location nearest to your country.
12. Start in Locked mode.
13. Open Project settings -> General.
14. Under Your apps, click Web icon and register app.
15. Copy the Firebase config object values.

## B. Put Firebase web config in project

1. Open [web/firebase-config.js](web/firebase-config.js).
2. Replace all placeholder values using your Firebase web config.
3. Save.

## C. Create users for authentication

Create two users in Firebase Authentication -> Users:

1. Device user (for ESP32 firmware), example `esp32-device@yourdomain.com`.
2. Dashboard user (for phone/laptop login), example `nurse@yourdomain.com`.

Use strong passwords for both.

## D. Update ESP32 firmware credentials

Open [esp32/esp32_monitor.ino](esp32/esp32_monitor.ino) and replace these constants:

1. `WIFI_SSID`
2. `WIFI_PASSWORD`
3. `FIREBASE_API_KEY`
4. `FIREBASE_DATABASE_URL`
5. `FIREBASE_USER_EMAIL` (device auth email)
6. `FIREBASE_USER_PASSWORD` (device auth password)
7. `DEVICE_ID` (example `esp32-001`)

Important: use the same `DEVICE_ID` in dashboard input.

## E. Apply Realtime Database Rules (important)

1. Open Firebase -> Realtime Database -> Rules.
2. Copy all rules from [firebase.database.rules.json](firebase.database.rules.json).
3. Paste and click Publish.

## F. Add device ownership row (required for rule access)

1. Open Authentication -> Users.
2. Copy UID of your device user.
3. Open Realtime Database -> Data.
4. Create path: `deviceOwners/<DEVICE_ID>/uid`.
5. Set value to copied UID.

Example:

- Path: `deviceOwners/esp32-001/uid`
- Value: `Yh8...actual_uid...3K`

## G. Upload ESP32 and verify cloud logs

1. Install Arduino libraries:
   - Firebase Arduino Client Library for ESP8266 and ESP32 (mobizt)
   - OneWire
   - DallasTemperature
   - DHT sensor library
   - MAX30100 pulse oximeter library
2. Select correct ESP32 board and COM port.
3. Upload firmware.
4. Open Serial Monitor at 115200.

Expected output flow:

1. Wi-Fi connected.
2. IP address printed.
3. Firebase ready.
4. Regular telemetry push.
5. If Wi-Fi drops, message prints:
   - `WiFi is not connected. Failed to push data to cloud.`

## H. Deploy website to Vercel (easy path)

1. Push code to GitHub.
2. Open Vercel dashboard.
3. Click Add New -> Project.
4. Import this repository.
5. No build command required.
6. No output directory required.
7. Click Deploy.
8. Open deployed URL.
9. Sign in with dashboard user.
10. Enter `DEVICE_ID` and click Set Device.

## I. Test full system end-to-end

1. Check sensor values appear on website.
2. Press Heater ON -> verify ESP32 applies.
3. Press Heater OFF -> verify ESP32 applies.
4. Press UV ON/OFF -> verify relay state changes.
5. Confirm status tiles show Wi-Fi and Cloud sync.

## J. Data paths used by the app

Telemetry current:

- `devices/<DEVICE_ID>/telemetry/latest`

Telemetry history:

- `devices/<DEVICE_ID>/telemetry/history`

Connection status:

- `devices/<DEVICE_ID>/status/connection`

Manual command from dashboard:

- `devices/<DEVICE_ID>/commands/manual`

ESP32 command acknowledgment:

- `devices/<DEVICE_ID>/commands/ack`

## K. What I need from you next

Send me these 7 items and I will finalize your files exactly:

1. Firebase `apiKey`
2. Firebase `databaseURL`
3. Firebase `projectId`
4. Device auth email
5. Device auth password
6. Your Wi-Fi SSID
7. Your Wi-Fi password

Optional but useful:

1. Preferred `DEVICE_ID`
2. Firebase region
3. Whether you want Sign Up button disabled after first setup

## L. Cable and COM clarification

USB cable is for power, flashing, and serial logs only.

Cloud data still needs Wi-Fi internet path:

ESP32 -> Wi-Fi -> Firebase -> Vercel dashboard

Without Wi-Fi, cloud updates cannot happen.
