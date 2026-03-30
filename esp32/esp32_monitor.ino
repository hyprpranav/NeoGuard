#include <WiFi.h>
#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <DHT.h>
#include <MAX30100_PulseOximeter.h>
#include <Firebase_ESP_Client.h>
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

const char* WIFI_SSID = "Oppo A77s";
const char* WIFI_PASSWORD = "9080061674";

const char* FIREBASE_API_KEY = "AIzaSyDFL5nYrKTnW6BmD1dKOTrtSsTu7pXBvIY";
const char* FIREBASE_DATABASE_URL = "https://neoguard-88bdb-default-rtdb.asia-southeast1.firebasedatabase.app";
const char* FIREBASE_USER_EMAIL = "harishspranav2006@gmail.com";
const char* FIREBASE_USER_PASSWORD = "927624BEC066";
const char* DEVICE_ID = "neoguard-one";

const unsigned long SENSOR_INTERVAL_MS = 1000;
const unsigned long CLOUD_PUSH_INTERVAL_MS = 3500;
const unsigned long WIFI_RETRY_INTERVAL_MS = 10000;

const int ONE_WIRE_BUS = 4;
const int DHT_PIN = 14;
const int PULSE_SENSOR_PIN = 34;

const uint32_t REPORTING_PERIOD_MS = 1000;

DHT dht(DHT_PIN, DHT11);
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature babySensor(&oneWire);
PulseOximeter pox;

float babyTemp = NAN;
float envTemp = NAN;
float spo2 = NAN;
float heartRate = NAN;
int pulseValue = 0;
bool max30100Ready = false;

unsigned long lastSensorRead = 0;
unsigned long lastMax30100Report = 0;
unsigned long lastCloudPush = 0;
unsigned long lastWifiRetry = 0;

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig firebaseConfig;
bool firebaseReady = false;

void onBeatDetected() {
  // Callback for pulse detection
}

String deviceRoot() {
  return String("/devices/") + DEVICE_ID;
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi connected");
  }
}

bool ensureWifiConnected() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }
  if (millis() - lastWifiRetry >= WIFI_RETRY_INTERVAL_MS) {
    lastWifiRetry = millis();
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
  return false;
}

bool firebasePathSetJson(const String& path, FirebaseJson& json) {
  return Firebase.RTDB.setJSON(&fbdo, path.c_str(), &json);
}

void setupFirebase() {
  firebaseConfig.api_key = FIREBASE_API_KEY;
  firebaseConfig.database_url = FIREBASE_DATABASE_URL;
  firebaseConfig.token_status_callback = tokenStatusCallback;
  auth.user.email = FIREBASE_USER_EMAIL;
  auth.user.password = FIREBASE_USER_PASSWORD;
  Firebase.reconnectWiFi(true);
  Firebase.begin(&firebaseConfig, &auth);
}

void publishTelemetry() {
  if (!firebaseReady || !Firebase.ready()) {
    return;
  }

  FirebaseJson latest;
  latest.set("babyTemp", isnan(babyTemp) ? 0 : babyTemp);
  latest.set("envTemp", isnan(envTemp) ? 0 : envTemp);
  latest.set("spo2", isnan(spo2) ? 0 : spo2);
  latest.set("heartRate", isnan(heartRate) ? 0 : heartRate);
  latest.set("pulse", pulseValue);
  latest.set("wifiConnected", WiFi.status() == WL_CONNECTED);
  latest.set("systemLive", true);
  latest.set("uptimeMs", (int) millis());
  latest.set("updatedAt/.sv", "timestamp");

  firebasePathSetJson(deviceRoot() + "/telemetry/latest", latest);

  FirebaseJson history;
  history.set("babyTemp", isnan(babyTemp) ? 0 : babyTemp);
  history.set("envTemp", isnan(envTemp) ? 0 : envTemp);
  history.set("spo2", isnan(spo2) ? 0 : spo2);
  history.set("heartRate", isnan(heartRate) ? 0 : heartRate);
  history.set("pulse", pulseValue);
  history.set("systemLive", true);
  history.set("createdAt/.sv", "timestamp");

  Firebase.RTDB.pushJSON(&fbdo, (deviceRoot() + "/telemetry/history").c_str(), &history);
}

void readSensors() {
  babySensor.requestTemperatures();
  float nextBabyTemp = babySensor.getTempCByIndex(0);
  float nextEnvTemp = dht.readTemperature();
  int rawPulse = analogRead(PULSE_SENSOR_PIN);

  pulseValue = constrain(map(rawPulse, 0, 4095, 55, 155), 55, 155);

  if (nextBabyTemp != DEVICE_DISCONNECTED_C && nextBabyTemp >= 20.0f && nextBabyTemp <= 45.0f) {
    babyTemp = nextBabyTemp;
  }

  if (!isnan(nextEnvTemp)) {
    envTemp = nextEnvTemp;
  }

  if (max30100Ready && millis() - lastMax30100Report >= REPORTING_PERIOD_MS) {
    heartRate = pox.getHeartRate();
    spo2 = pox.getSpO2();
    lastMax30100Report = millis();
  }
}

void setup() {
  Serial.begin(115200);

  dht.begin();
  babySensor.begin();
  Wire.begin();

  if (!pox.begin()) {
    Serial.println("MAX30100 init failed");
    max30100Ready = false;
  } else {
    max30100Ready = true;
    pox.setIRLedCurrent(MAX30100_LED_CURR_7_6MA);
    pox.setOnBeatDetectedCallback(onBeatDetected);
  }

  connectWifi();
  setupFirebase();
}

void loop() {
  if (max30100Ready) {
    pox.update();
  }

  if (millis() - lastSensorRead >= SENSOR_INTERVAL_MS) {
    lastSensorRead = millis();
    readSensors();
  }

  if (!ensureWifiConnected()) {
    return;
  }

  firebaseReady = Firebase.ready();

  if (firebaseReady && millis() - lastCloudPush >= CLOUD_PUSH_INTERVAL_MS) {
    lastCloudPush = millis();
    publishTelemetry();
  }
}