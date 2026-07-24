#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <DHT.h>
#include <MAX30100_PulseOximeter.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
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
const unsigned long CLOUD_PUSH_INTERVAL_MS = 3000;
const unsigned long CLOUD_STATUS_INTERVAL_MS = 5000;
const unsigned long CLOUD_COMMAND_POLL_MS = 1500;
const unsigned long WIFI_RETRY_INTERVAL_MS = 10000;
const unsigned long DISPLAY_REFRESH_MS = 1000;

const int ONE_WIRE_BUS = 4;
const int DHT_PIN = 14;
const int PULSE_SENSOR_PIN = 34;
const int HEATER_RELAY_PIN = 26;
const int UV_RELAY_PIN = 25;
const int SAFETY_RELAY_PIN = 27;

const uint32_t REPORTING_PERIOD_MS = 1000;
const int OLED_WIDTH = 128;
const int OLED_HEIGHT = 64;
const int OLED_RESET = -1;
const uint8_t LOCAL_LOG_CAPACITY = 12;

struct ManualProfile {
  float birthWeightKg;
  int gestationalAgeWeeks;
  int feedingIntervalMinutes;
  int sleepDurationHours;
  String vaccinationStatus;
  String symptoms;
};

struct DecisionResult {
  float healthScore;
  String riskLevel;
  String recommendation;
  String reason;
  String stateName;
  bool emergency;
  bool heatingRequired;
  bool coolingRequired;
  bool sensorFault;
};

struct LocalLogEntry {
  unsigned long capturedAt;
  float babyTemp;
  float envTemp;
  float spo2;
  float heartRate;
  int pulse;
  float healthScore;
  String riskLevel;
  String recommendation;
  String reason;
  bool heaterOn;
  bool safetyRelayOn;
  bool emergency;
};

DHT dht(DHT_PIN, DHT11);
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature babySensor(&oneWire);
PulseOximeter pox;
Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET);
WebServer server(80);

float babyTemp = NAN;
float envTemp = NAN;
float spo2 = NAN;
float heartRate = NAN;
int pulseValue = 0;
float neoWarmHealthScore = 0.0f;
bool max30100Ready = false;
bool babyTempValid = false;
bool envTempValid = false;
bool spo2Valid = false;
bool heartRateValid = false;
bool oledReady = false;
bool connectionStatusWriteAttempted = false;
bool connectionStatusWriteOk = false;
bool telemetryLatestWriteOk = false;
bool telemetryHistoryWriteOk = false;
bool telemetryWriteAttempted = false;
bool emergencyAlertActive = false;
bool offlineQueueDirty = false;

unsigned long lastSensorRead = 0;
unsigned long lastMax30100Report = 0;
unsigned long lastCloudPush = 0;
unsigned long lastCloudStatus = 0;
unsigned long lastCloudCommandPoll = 0;
unsigned long lastWifiRetry = 0;
unsigned long lastDisplayRefresh = 0;
unsigned long lastLocalLogFlush = 0;
bool onlinePublished = false;
bool heaterOn = false;
bool uvOn = false;
bool safetyRelayOn = true;
String lastCommandRequestId = "";
String cloudStatusMessage = "BOOTING";
String lastSyncTimeText = "Never";
ManualProfile manualProfile = {2.7f, 38, 180, 16, "Up to date", "None"};
DecisionResult currentDecision = {100.0f, "Normal", "Continue monitoring", "System booting", "STABLE", false, false, false, false};
LocalLogEntry localLogBuffer[LOCAL_LOG_CAPACITY];
uint8_t localLogHead = 0;
uint8_t localLogCount = 0;

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig firebaseConfig;
bool firebaseReady = false;

void onBeatDetected() {
  // Callback for pulse detection
}

void setHeater(bool enabled) {
  heaterOn = enabled;
  digitalWrite(HEATER_RELAY_PIN, enabled ? HIGH : LOW);
}

void setUv(bool enabled) {
  uvOn = enabled;
  digitalWrite(UV_RELAY_PIN, enabled ? LOW : HIGH);
}

void setSafetyRelay(bool enabled) {
  safetyRelayOn = enabled;
  digitalWrite(SAFETY_RELAY_PIN, enabled ? LOW : HIGH);
}

String deviceRoot() {
  return String("/devices/") + DEVICE_ID;
}

String formatValue(float value, uint8_t digits, const char* unit) {
  if (isnan(value)) {
    return String("--") + unit;
  }

  return String(value, digits) + unit;
}

String formatIntegerValue(int value, const char* unit) {
  return String(value) + unit;
}

String buildSensorStatusMessage() {
  if (!max30100Ready) {
    return "MAX30100 INIT FAIL";
  }

  if (!babyTempValid && !envTempValid && !spo2Valid && !heartRateValid) {
    return "ALL SENSOR READ FAIL";
  }

  if (!babyTempValid) {
    return "BODY TEMP READ FAIL";
  }

  if (!envTempValid) {
    return "ENV TEMP READ FAIL";
  }

  if (!heartRateValid || !spo2Valid) {
    return "MAX30100 READ FAIL";
  }

  return "FETCHING OK";
}

String buildSafetyCondition() {
  if (emergencyAlertActive) {
    return "Emergency alert: heater disabled";
  }

  if (currentDecision.sensorFault) {
    return "Sensor fault: AI fallback active";
  }

  if (currentDecision.coolingRequired) {
    return "AI cooling response active";
  }

  if (currentDecision.heatingRequired) {
    return "AI warming response active";
  }

  if (WiFi.status() != WL_CONNECTED) {
    return "Offline monitoring active";
  }

  if (!firebaseReady) {
    return "Local AI active, cloud sync pending";
  }

  return "Thermal balance maintained";
}

String buildCloudStatusMessage() {
  if (WiFi.status() != WL_CONNECTED) {
    return offlineQueueDirty ? "OFFLINE LOGGING" : "WIFI OFFLINE";
  }

  if (!firebaseReady) {
    return "FIREBASE WAIT";
  }

  if (!connectionStatusWriteAttempted) {
    return "STATUS WAIT";
  }

  if (!connectionStatusWriteOk) {
    return "STATUS PUSH FAIL";
  }

  if (!telemetryWriteAttempted) {
    return "TELEMETRY WAIT";
  }

  if (!telemetryLatestWriteOk) {
    return "CLOUD PUSH FAIL";
  }

  if (!telemetryHistoryWriteOk) {
    return "HISTORY PUSH FAIL";
  }

  return "CLOUD LIVE";
}

bool hasSensorFault() {
  return !max30100Ready || !babyTempValid || !envTempValid || !spo2Valid || !heartRateValid;
}

void updateCloudStatus(const String& message) {
  cloudStatusMessage = message;
  Serial.println(message);
}

void tokenStatusCallback(TokenInfo info) {
  if (info.status == token_status_ready) {
    firebaseReady = true;
    Serial.println("Firebase token ready");
  } else if (info.status == token_status_error) {
    firebaseReady = false;
    Serial.println("Firebase token error");
  }
}

String escapeJson(String value) {
  value.replace("\\", "\\\\");
  value.replace("\"", "\\\"");
  value.replace("\n", " ");
  value.replace("\r", " ");
  value.replace("\t", " ");
  return value;
}

String boolJson(bool value) {
  return value ? "true" : "false";
}

float clampFloat(float value, float minimumValue, float maximumValue) {
  if (value < minimumValue) {
    return minimumValue;
  }

  if (value > maximumValue) {
    return maximumValue;
  }

  return value;
}

void setManualProfileFromArgs() {
  if (server.hasArg("birthWeight")) {
    manualProfile.birthWeightKg = clampFloat(server.arg("birthWeight").toFloat(), 0.5f, 6.0f);
  }

  if (server.hasArg("gestationalAge")) {
    manualProfile.gestationalAgeWeeks = constrain(server.arg("gestationalAge").toInt(), 20, 44);
  }

  if (server.hasArg("feedingInterval")) {
    manualProfile.feedingIntervalMinutes = constrain(server.arg("feedingInterval").toInt(), 15, 360);
  }

  if (server.hasArg("sleepDuration")) {
    manualProfile.sleepDurationHours = constrain(server.arg("sleepDuration").toInt(), 0, 24);
  }

  if (server.hasArg("vaccinationStatus")) {
    manualProfile.vaccinationStatus = server.arg("vaccinationStatus");
  }

  if (server.hasArg("symptoms")) {
    manualProfile.symptoms = server.arg("symptoms");
  }
}

void setManualProfileFromStringArgs(const String& birthWeight, const String& gestationalAge, const String& feedingInterval, const String& sleepDuration, const String& vaccinationStatus, const String& symptoms) {
  if (birthWeight.length() > 0) {
    manualProfile.birthWeightKg = clampFloat(birthWeight.toFloat(), 0.5f, 6.0f);
  }

  if (gestationalAge.length() > 0) {
    manualProfile.gestationalAgeWeeks = constrain(gestationalAge.toInt(), 20, 44);
  }

  if (feedingInterval.length() > 0) {
    manualProfile.feedingIntervalMinutes = constrain(feedingInterval.toInt(), 15, 360);
  }

  if (sleepDuration.length() > 0) {
    manualProfile.sleepDurationHours = constrain(sleepDuration.toInt(), 0, 24);
  }

  if (vaccinationStatus.length() > 0) {
    manualProfile.vaccinationStatus = vaccinationStatus;
  }

  if (symptoms.length() > 0) {
    manualProfile.symptoms = symptoms;
  }
}

bool containsAny(const String& value, const String& needleOne, const String& needleTwo = "", const String& needleThree = "") {
  String haystack = value;
  haystack.toLowerCase();

  if (haystack.indexOf(needleOne) >= 0) {
    return true;
  }

  if (needleTwo.length() > 0 && haystack.indexOf(needleTwo) >= 0) {
    return true;
  }

  if (needleThree.length() > 0 && haystack.indexOf(needleThree) >= 0) {
    return true;
  }

  return false;
}

DecisionResult evaluateDecision() {
  DecisionResult result;
  result.healthScore = 100.0f;
  result.riskLevel = "Normal";
  result.recommendation = "Continue monitoring";
  result.reason = "Vitals stable";
  result.stateName = "STABLE";
  result.emergency = false;
  result.heatingRequired = false;
  result.coolingRequired = false;
  result.sensorFault = false;

  if (!max30100Ready || !babyTempValid || !envTempValid || !spo2Valid || !heartRateValid) {
    result.sensorFault = true;
    result.healthScore -= 35.0f;
    result.reason = "Sensor fault detected";
  }

  if (babyTempValid) {
    if (babyTemp < 36.5f) {
      result.heatingRequired = true;
      result.healthScore -= clampFloat((36.5f - babyTemp) * 20.0f, 4.0f, 30.0f);
      result.reason = "Baby temperature below ideal range";
    } else if (babyTemp > 37.5f) {
      result.coolingRequired = true;
      result.healthScore -= clampFloat((babyTemp - 37.5f) * 28.0f, 5.0f, 35.0f);
      result.reason = "Baby temperature above ideal range";
    }

    if (babyTemp < 35.5f || babyTemp > 38.0f) {
      result.emergency = true;
    }
  } else {
    result.healthScore -= 15.0f;
  }

  if (envTempValid) {
    if (envTemp < 30.0f) {
      result.heatingRequired = true;
      result.healthScore -= 8.0f;
    } else if (envTemp > 36.5f) {
      result.coolingRequired = true;
      result.healthScore -= 10.0f;
    }
  } else {
    result.healthScore -= 10.0f;
  }

  if (spo2Valid) {
    if (spo2 < 92.0f) {
      result.healthScore -= clampFloat((92.0f - spo2) * 4.0f, 8.0f, 24.0f);
      result.reason = "SpO2 below safe threshold";
    }

    if (spo2 < 90.0f) {
      result.emergency = true;
    }
  } else {
    result.healthScore -= 12.0f;
  }

  if (heartRateValid) {
    if (heartRate < 100.0f || heartRate > 180.0f) {
      result.healthScore -= 12.0f;
      result.reason = "Heart rate outside newborn range";
    }

    if (heartRate < 80.0f || heartRate > 200.0f) {
      result.emergency = true;
    }
  } else {
    result.healthScore -= 12.0f;
  }

  if (pulseValue < 60 || pulseValue > 150) {
    result.healthScore -= 4.0f;
  }

  if (manualProfile.birthWeightKg > 0.0f && manualProfile.birthWeightKg < 2.5f) {
    result.healthScore -= 6.0f;
    result.reason = "Low birth weight increases thermal risk";
  }

  if (manualProfile.gestationalAgeWeeks > 0 && manualProfile.gestationalAgeWeeks < 37) {
    result.healthScore -= 8.0f;
    result.reason = "Preterm infant requires closer warming support";
  }

  if (manualProfile.feedingIntervalMinutes > 0 && manualProfile.feedingIntervalMinutes > 240) {
    result.healthScore -= 3.0f;
  }

  if (manualProfile.sleepDurationHours > 0 && manualProfile.sleepDurationHours < 8) {
    result.healthScore -= 2.0f;
  }

  String vaccinationStatus = manualProfile.vaccinationStatus;
  vaccinationStatus.toLowerCase();
  if (vaccinationStatus.indexOf("pending") >= 0 || vaccinationStatus.indexOf("not") >= 0 || vaccinationStatus.indexOf("delayed") >= 0) {
    result.healthScore -= 2.0f;
  }

  String symptoms = manualProfile.symptoms;
  symptoms.toLowerCase();
  if (containsAny(symptoms, "fever", "cyanosis", "apnea") || containsAny(symptoms, "lethargy", "poor feeding", "irritability")) {
    result.healthScore -= 15.0f;
    result.reason = "Caregiver symptoms suggest clinical review";
  }

  if (containsAny(symptoms, "apnea", "cyanosis", "bluish", "unresponsive")) {
    result.emergency = true;
  }

  result.healthScore = clampFloat(result.healthScore, 0.0f, 100.0f);

  if (result.emergency || result.sensorFault || result.healthScore < 35.0f) {
    result.riskLevel = "High";
    result.stateName = result.sensorFault ? "SENSOR_FAULT" : "EMERGENCY";
    result.recommendation = "Disable heater, keep safety relay off, and request urgent review";
  } else if (result.healthScore < 60.0f) {
    result.riskLevel = "Moderate";
    result.stateName = result.heatingRequired ? "WARMING" : "COOLING";
    result.recommendation = result.heatingRequired ? "Increase heating gradually" : "Reduce heat and continue monitoring";
  } else if (result.healthScore < 80.0f) {
    result.riskLevel = "Low";
    result.stateName = result.heatingRequired ? "WARMING" : "STABLE";
    result.recommendation = result.heatingRequired ? "Maintain warming support" : "Continue monitoring";
  } else {
    result.riskLevel = "Normal";
    result.stateName = "STABLE";
    result.recommendation = "Maintain thermal balance and continue monitoring";
  }

  if (result.coolingRequired && !result.emergency && !result.sensorFault) {
    result.recommendation = "Reduce heating output and monitor for recovery";
  }

  return result;
}

void applyDecision(const DecisionResult& decision) {
  currentDecision = decision;
  neoWarmHealthScore = decision.healthScore;

  if (decision.emergency || decision.sensorFault) {
    emergencyAlertActive = true;
    setHeater(false);
    setSafetyRelay(false);
    setUv(false);
    updateCloudStatus(decision.sensorFault ? "EMERGENCY: SENSOR FAULT" : "EMERGENCY: ABNORMAL VITALS");
    return;
  }

  emergencyAlertActive = false;
  setSafetyRelay(true);

  if (decision.heatingRequired && babyTempValid && babyTemp < 36.5f) {
    setHeater(true);
  } else if (decision.coolingRequired || (babyTempValid && babyTemp > 37.5f)) {
    setHeater(false);
  } else {
    setHeater(false);
  }
}

void enqueueLocalLog(const DecisionResult& decision) {
  LocalLogEntry& slot = localLogBuffer[localLogHead];
  slot.capturedAt = millis();
  slot.babyTemp = babyTemp;
  slot.envTemp = envTemp;
  slot.spo2 = spo2;
  slot.heartRate = heartRate;
  slot.pulse = pulseValue;
  slot.healthScore = decision.healthScore;
  slot.riskLevel = decision.riskLevel;
  slot.recommendation = decision.recommendation;
  slot.reason = decision.reason;
  slot.heaterOn = heaterOn;
  slot.safetyRelayOn = safetyRelayOn;
  slot.emergency = decision.emergency || decision.sensorFault;

  localLogHead = (localLogHead + 1) % LOCAL_LOG_CAPACITY;
  if (localLogCount < LOCAL_LOG_CAPACITY) {
    localLogCount++;
  }

  offlineQueueDirty = true;
}

String buildManualProfileJson() {
  String payload = "{";
  payload += "\"birthWeightKg\":" + String(manualProfile.birthWeightKg, 2) + ",";
  payload += "\"gestationalAgeWeeks\":" + String(manualProfile.gestationalAgeWeeks) + ",";
  payload += "\"feedingIntervalMinutes\":" + String(manualProfile.feedingIntervalMinutes) + ",";
  payload += "\"sleepDurationHours\":" + String(manualProfile.sleepDurationHours) + ",";
  payload += "\"vaccinationStatus\":\"" + escapeJson(manualProfile.vaccinationStatus) + "\",";
  payload += "\"symptoms\":\"" + escapeJson(manualProfile.symptoms) + "\"";
  payload += "}";
  return payload;
}

String buildDevicePayloadJson() {
  String payload = "{";
  payload += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";
  payload += "\"babyTemp\":" + String(isnan(babyTemp) ? 0.0f : babyTemp, 2) + ",";
  payload += "\"envTemp\":" + String(isnan(envTemp) ? 0.0f : envTemp, 2) + ",";
  payload += "\"spo2\":" + String(isnan(spo2) ? 0.0f : spo2, 0) + ",";
  payload += "\"heartRate\":" + String(isnan(heartRate) ? 0.0f : heartRate, 0) + ",";
  payload += "\"pulse\":" + String(pulseValue) + ",";
  payload += "\"babyTempValid\":" + boolJson(babyTempValid) + ",";
  payload += "\"envTempValid\":" + boolJson(envTempValid) + ",";
  payload += "\"spo2Valid\":" + boolJson(spo2Valid) + ",";
  payload += "\"heartRateValid\":" + boolJson(heartRateValid) + ",";
  payload += "\"healthScore\":" + String(neoWarmHealthScore, 1) + ",";
  payload += "\"riskLevel\":\"" + currentDecision.riskLevel + "\",";
  payload += "\"recommendation\":\"" + escapeJson(currentDecision.recommendation) + "\",";
  payload += "\"reason\":\"" + escapeJson(currentDecision.reason) + "\",";
  payload += "\"stateName\":\"" + currentDecision.stateName + "\",";
  payload += "\"emergencyAlert\":" + boolJson(emergencyAlertActive) + ",";
  payload += "\"heaterOn\":" + boolJson(heaterOn) + ",";
  payload += "\"uvOn\":" + boolJson(uvOn) + ",";
  payload += "\"safetyRelayOn\":" + boolJson(safetyRelayOn) + ",";
  payload += "\"wifiConnected\":" + boolJson(WiFi.status() == WL_CONNECTED) + ",";
  payload += "\"firebaseReady\":" + boolJson(firebaseReady) + ",";
  payload += "\"offlineLogCount\":" + String(localLogCount) + ",";
  payload += "\"lastSyncAt\":\"" + escapeJson(lastSyncTimeText) + "\",";
  payload += "\"cloudStatus\":\"" + escapeJson(cloudStatusMessage) + "\",";
  payload += "\"safetyCondition\":\"" + escapeJson(buildSafetyCondition()) + "\",";
  payload += "\"manualProfile\":" + buildManualProfileJson();
  payload += "}";
  return payload;
}

void sendDeviceSnapshot() {
  server.send(200, "application/json", buildDevicePayloadJson());
}

void handleRelayCommand(bool heaterCommand, bool enabled) {
  if (heaterCommand) {
    setHeater(enabled);
  } else {
    setUv(enabled);
  }

  server.send(200, "application/json", buildDevicePayloadJson());
}

void handleProfileCommand() {
  setManualProfileFromArgs();
  server.send(200, "application/json", buildDevicePayloadJson());
}

void handleSyncCommand() {
  String payload = "{";
  payload += "\"ok\":true,";
  payload += "\"offlineLogCount\":" + String(localLogCount) + ",";
  payload += "\"lastSyncAt\":\"" + escapeJson(lastSyncTimeText) + "\"";
  payload += "}";
  server.send(200, "application/json", payload);
}

void setupRestServer() {
  server.on("/data", HTTP_GET, sendDeviceSnapshot);
  server.on("/health", HTTP_GET, sendDeviceSnapshot);
  server.on("/profile", HTTP_POST, handleProfileCommand);
  server.on("/profile", HTTP_GET, handleProfileCommand);
  server.on("/sync", HTTP_GET, handleSyncCommand);
  server.on("/heater/on", HTTP_GET, []() { handleRelayCommand(true, true); });
  server.on("/heater/off", HTTP_GET, []() { handleRelayCommand(true, false); });
  server.on("/uv/on", HTTP_GET, []() { handleRelayCommand(false, true); });
  server.on("/uv/off", HTTP_GET, []() { handleRelayCommand(false, false); });
  server.onNotFound([]() {
    server.send(404, "application/json", "{\"ok\":false,\"message\":\"Not found\"}");
  });
  server.begin();
}

void flushQueuedLogs() {
  if (localLogCount == 0 || !firebaseReady || !Firebase.ready()) {
    return;
  }

  while (localLogCount > 0) {
    uint8_t index = (localLogHead + LOCAL_LOG_CAPACITY - localLogCount) % LOCAL_LOG_CAPACITY;
    LocalLogEntry& entry = localLogBuffer[index];

    FirebaseJson offlineHistory;
    offlineHistory.set("babyTemp", isnan(entry.babyTemp) ? 0 : entry.babyTemp);
    offlineHistory.set("envTemp", isnan(entry.envTemp) ? 0 : entry.envTemp);
    offlineHistory.set("spo2", isnan(entry.spo2) ? 0 : entry.spo2);
    offlineHistory.set("heartRate", isnan(entry.heartRate) ? 0 : entry.heartRate);
    offlineHistory.set("pulse", entry.pulse);
    offlineHistory.set("healthScore", entry.healthScore);
    offlineHistory.set("riskLevel", entry.riskLevel.c_str());
    offlineHistory.set("recommendation", entry.recommendation.c_str());
    offlineHistory.set("reason", entry.reason.c_str());
    offlineHistory.set("heaterOn", entry.heaterOn);
    offlineHistory.set("safetyRelayOn", entry.safetyRelayOn);
    offlineHistory.set("emergencyAlert", entry.emergency);
    offlineHistory.set("createdAt/.sv", "timestamp");

    if (!Firebase.RTDB.pushJSON(&fbdo, (deviceRoot() + "/telemetry/history").c_str(), &offlineHistory)) {
      Serial.print("Firebase offline log sync failed: ");
      Serial.println(fbdo.errorReason());
      break;
    }

    localLogCount--;
  }

  if (localLogCount == 0) {
    offlineQueueDirty = false;
    lastSyncTimeText = String(millis()) + " ms";
  }
}

void showBootMessage(const String& line1, const String& line2, const String& line3 = "") {
  if (!oledReady) {
    return;
  }

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println(line1);
  display.println(line2);

  if (line3.length() > 0) {
    display.println(line3);
  }

  display.display();
}

void initializeDisplay() {
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("OLED init failed");
    oledReady = false;
    return;
  }

  oledReady = true;
  showBootMessage("NeoGuard", "Booting...", "Please wait");
}

void renderDisplay() {
  if (!oledReady || millis() - lastDisplayRefresh < DISPLAY_REFRESH_MS) {
    return;
  }

  lastDisplayRefresh = millis();

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  display.setCursor(0, 0);
  display.println("NeoGuard");

  display.setCursor(0, 10);
  display.println(currentDecision.stateName);

  display.setCursor(0, 20);
  display.print("H:");
  display.print(String(neoWarmHealthScore, 0));
  display.print(" ");
  display.println(currentDecision.riskLevel);

  display.setCursor(0, 30);
  display.print("B:");
  display.print(formatValue(babyTemp, 1, "C"));
  display.print(" E:");
  display.print(formatValue(envTemp, 1, "C"));

  display.setCursor(0, 40);
  display.print("SpO2:");
  display.print(spo2Valid ? String(spo2, (uint8_t)0) : String("--"));
  display.print(" HR:");
  display.print(heartRateValid ? String(heartRate, (uint8_t)0) : String("--"));

  display.setCursor(0, 54);
  display.print(emergencyAlertActive ? "ALERT " : "SAFE ");
  display.print(buildCloudStatusMessage());

  display.display();
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi connected");
    updateCloudStatus("WIFI CONNECTED");
  } else {
    updateCloudStatus("WIFI CONNECTING");
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
  if (!Firebase.RTDB.setJSON(&fbdo, path.c_str(), &json)) {
    Serial.print("Firebase setJSON failed: ");
    Serial.println(fbdo.errorReason());
    return false;
  }

  return true;
}

void setupFirebase() {
  firebaseConfig.api_key = FIREBASE_API_KEY;
  firebaseConfig.database_url = FIREBASE_DATABASE_URL;
  firebaseConfig.token_status_callback = tokenStatusCallback;
  firebaseConfig.max_token_generation_retry = 5;
  auth.user.email = FIREBASE_USER_EMAIL;
  auth.user.password = FIREBASE_USER_PASSWORD;
  Firebase.reconnectWiFi(true);
  Firebase.begin(&firebaseConfig, &auth);
  firebaseReady = true;
}

void publishConnectionStatus() {
  connectionStatusWriteAttempted = true;

  if (!firebaseReady || !Firebase.ready()) {
    connectionStatusWriteOk = false;
    updateCloudStatus("FIREBASE WAIT");
    return;
  }

  FirebaseJson status;
  status.set("wifiConnected", WiFi.status() == WL_CONNECTED);
  status.set("firebaseReady", firebaseReady);
  status.set("systemLive", true);
  status.set("uptimeMs", (int) millis());
  status.set("sensorDataAvailable", babyTempValid || envTempValid || spo2Valid || heartRateValid);
  status.set("healthScore", neoWarmHealthScore);
  status.set("riskLevel", currentDecision.riskLevel.c_str());
  status.set("recommendation", currentDecision.recommendation.c_str());
  status.set("reason", currentDecision.reason.c_str());
  status.set("emergencyAlert", emergencyAlertActive);
  status.set("updatedAt/.sv", "timestamp");

  if (firebasePathSetJson(deviceRoot() + "/status/connection", status)) {
    connectionStatusWriteOk = true;
    updateCloudStatus("STATUS OK");
  } else {
    connectionStatusWriteOk = false;
    updateCloudStatus("STATUS PUSH FAIL");
  }
}

void publishTelemetry() {
  if (!firebaseReady || !Firebase.ready()) {
    telemetryLatestWriteOk = false;
    telemetryHistoryWriteOk = false;
    telemetryWriteAttempted = true;
    updateCloudStatus("FIREBASE WAIT");
    return;
  }

  telemetryWriteAttempted = true;

  FirebaseJson latest;
  latest.set("babyTemp", isnan(babyTemp) ? 0 : babyTemp);
  latest.set("envTemp", isnan(envTemp) ? 0 : envTemp);
  latest.set("spo2", isnan(spo2) ? 0 : spo2);
  latest.set("heartRate", isnan(heartRate) ? 0 : heartRate);
  latest.set("pulse", pulseValue);
  latest.set("babyTempValid", babyTempValid);
  latest.set("envTempValid", envTempValid);
  latest.set("spo2Valid", spo2Valid);
  latest.set("heartRateValid", heartRateValid);
  latest.set("sensorDataAvailable", babyTempValid || envTempValid || spo2Valid || heartRateValid);
  latest.set("wifiConnected", WiFi.status() == WL_CONNECTED);
  latest.set("systemLive", true);
  latest.set("uptimeMs", (int) millis());
  latest.set("updatedAt/.sv", "timestamp");
  latest.set("heaterOn", heaterOn);
  latest.set("uvOn", uvOn);
  latest.set("safetyRelayOn", safetyRelayOn);
  latest.set("sensorFault", hasSensorFault());
  latest.set("healthScore", neoWarmHealthScore);
  latest.set("riskLevel", currentDecision.riskLevel.c_str());
  latest.set("recommendation", currentDecision.recommendation.c_str());
  latest.set("reason", currentDecision.reason.c_str());
  latest.set("stateName", currentDecision.stateName.c_str());
  latest.set("emergencyAlert", emergencyAlertActive);
  latest.set("birthWeightKg", manualProfile.birthWeightKg);
  latest.set("gestationalAgeWeeks", manualProfile.gestationalAgeWeeks);
  latest.set("feedingIntervalMinutes", manualProfile.feedingIntervalMinutes);
  latest.set("sleepDurationHours", manualProfile.sleepDurationHours);
  latest.set("vaccinationStatus", manualProfile.vaccinationStatus.c_str());
  latest.set("symptoms", manualProfile.symptoms.c_str());
  latest.set("safetyCondition", buildSafetyCondition());

  if (firebasePathSetJson(deviceRoot() + "/telemetry/latest", latest)) {
    telemetryLatestWriteOk = true;
  } else {
    telemetryLatestWriteOk = false;
    updateCloudStatus("TELEMETRY PUSH FAIL");
  }

  FirebaseJson history;
  history.set("babyTemp", isnan(babyTemp) ? 0 : babyTemp);
  history.set("envTemp", isnan(envTemp) ? 0 : envTemp);
  history.set("spo2", isnan(spo2) ? 0 : spo2);
  history.set("heartRate", isnan(heartRate) ? 0 : heartRate);
  history.set("pulse", pulseValue);
  history.set("babyTempValid", babyTempValid);
  history.set("envTempValid", envTempValid);
  history.set("spo2Valid", spo2Valid);
  history.set("heartRateValid", heartRateValid);
  history.set("sensorDataAvailable", babyTempValid || envTempValid || spo2Valid || heartRateValid);
  history.set("systemLive", true);
  history.set("createdAt/.sv", "timestamp");
  history.set("heaterOn", heaterOn);
  history.set("uvOn", uvOn);
  history.set("safetyRelayOn", safetyRelayOn);
  history.set("sensorFault", hasSensorFault());
  history.set("healthScore", neoWarmHealthScore);
  history.set("riskLevel", currentDecision.riskLevel.c_str());
  history.set("recommendation", currentDecision.recommendation.c_str());
  history.set("reason", currentDecision.reason.c_str());
  history.set("stateName", currentDecision.stateName.c_str());
  history.set("emergencyAlert", emergencyAlertActive);
  history.set("birthWeightKg", manualProfile.birthWeightKg);
  history.set("gestationalAgeWeeks", manualProfile.gestationalAgeWeeks);
  history.set("feedingIntervalMinutes", manualProfile.feedingIntervalMinutes);
  history.set("sleepDurationHours", manualProfile.sleepDurationHours);
  history.set("vaccinationStatus", manualProfile.vaccinationStatus.c_str());
  history.set("symptoms", manualProfile.symptoms.c_str());
  history.set("safetyCondition", buildSafetyCondition());

  if (!Firebase.RTDB.pushJSON(&fbdo, (deviceRoot() + "/telemetry/history").c_str(), &history)) {
    Serial.print("Firebase pushJSON failed: ");
    Serial.println(fbdo.errorReason());
    telemetryHistoryWriteOk = false;
    updateCloudStatus("HISTORY PUSH FAIL");
  } else {
    telemetryHistoryWriteOk = true;
    lastSyncTimeText = String(millis()) + " ms";
  }
}

bool parseSwitchState(const String& rawValue, bool currentValue, bool* hasValue) {
  String value = rawValue;
  value.trim();
  value.toLowerCase();

  if (value == "on") {
    *hasValue = true;
    return true;
  }

  if (value == "off") {
    *hasValue = true;
    return false;
  }

  *hasValue = false;
  return currentValue;
}

void acknowledgeCommand(const String& requestId) {
  FirebaseJson ack;
  ack.set("requestId", requestId);
  ack.set("heaterOn", heaterOn);
  ack.set("uvOn", uvOn);
  ack.set("safetyRelayOn", safetyRelayOn);
  ack.set("systemLive", true);
  ack.set("processedAt/.sv", "timestamp");

  if (!firebasePathSetJson(deviceRoot() + "/commands/ack", ack)) {
    Serial.println("Failed to write command ack");
  }
}

void consumeCloudCommands() {
  if (!firebaseReady || !Firebase.ready()) {
    return;
  }

  const String commandPath = deviceRoot() + "/commands/manual";
  if (!Firebase.RTDB.getJSON(&fbdo, commandPath.c_str())) {
    return;
  }

  FirebaseJsonData jsonData;
  FirebaseJson& commandJson = fbdo.jsonObject();

  String requestId = "";
  String heaterStateRaw = "";
  String uvStateRaw = "";
  String birthWeightRaw = "";
  String gestationalAgeRaw = "";
  String feedingIntervalRaw = "";
  String sleepDurationRaw = "";
  String vaccinationStatusRaw = "";
  String symptomsRaw = "";

  if (commandJson.get(jsonData, "requestId") && jsonData.success) {
    requestId = jsonData.stringValue;
  }

  if (requestId.length() == 0 || requestId == lastCommandRequestId) {
    return;
  }

  if (commandJson.get(jsonData, "heaterState") && jsonData.success) {
    heaterStateRaw = jsonData.stringValue;
  }

  if (commandJson.get(jsonData, "uvState") && jsonData.success) {
    uvStateRaw = jsonData.stringValue;
  }

  if (commandJson.get(jsonData, "birthWeight") && jsonData.success) {
    birthWeightRaw = jsonData.stringValue;
  }

  if (commandJson.get(jsonData, "gestationalAge") && jsonData.success) {
    gestationalAgeRaw = jsonData.stringValue;
  }

  if (commandJson.get(jsonData, "feedingInterval") && jsonData.success) {
    feedingIntervalRaw = jsonData.stringValue;
  }

  if (commandJson.get(jsonData, "sleepDuration") && jsonData.success) {
    sleepDurationRaw = jsonData.stringValue;
  }

  if (commandJson.get(jsonData, "vaccinationStatus") && jsonData.success) {
    vaccinationStatusRaw = jsonData.stringValue;
  }

  if (commandJson.get(jsonData, "symptoms") && jsonData.success) {
    symptomsRaw = jsonData.stringValue;
  }

  bool hasHeater = false;
  bool hasUv = false;
  bool nextHeater = parseSwitchState(heaterStateRaw, heaterOn, &hasHeater);
  bool nextUv = parseSwitchState(uvStateRaw, uvOn, &hasUv);

  if (hasHeater) {
    setHeater(nextHeater);
  }

  if (hasUv) {
    setUv(nextUv);
  }

  setManualProfileFromStringArgs(
    birthWeightRaw,
    gestationalAgeRaw,
    feedingIntervalRaw,
    sleepDurationRaw,
    vaccinationStatusRaw,
    symptomsRaw
  );

  lastCommandRequestId = requestId;
  acknowledgeCommand(requestId);
  Serial.print("Processed command ");
  Serial.println(requestId);
}

void readSensors() {
  babySensor.requestTemperatures();
  float nextBabyTemp = babySensor.getTempCByIndex(0);
  float nextEnvTemp = dht.readTemperature();
  int rawPulse = analogRead(PULSE_SENSOR_PIN);

  pulseValue = constrain(map(rawPulse, 0, 4095, 55, 155), 55, 155);

  babyTempValid = (nextBabyTemp != DEVICE_DISCONNECTED_C && nextBabyTemp >= 20.0f && nextBabyTemp <= 45.0f);
  if (babyTempValid) {
    babyTemp = nextBabyTemp;
  } else {
    babyTemp = NAN;
  }

  envTempValid = !isnan(nextEnvTemp);
  if (envTempValid) {
    envTemp = nextEnvTemp;
  } else {
    envTemp = NAN;
  }

  if (max30100Ready && millis() - lastMax30100Report >= REPORTING_PERIOD_MS) {
    heartRate = pox.getHeartRate();
    spo2 = pox.getSpO2();
    heartRateValid = !isnan(heartRate) && heartRate > 20.0f && heartRate < 250.0f;
    spo2Valid = !isnan(spo2) && spo2 > 50.0f && spo2 <= 100.0f;
    if (!heartRateValid) {
      heartRate = NAN;
    }
    if (!spo2Valid) {
      spo2 = NAN;
    }
    lastMax30100Report = millis();
  } else if (!max30100Ready) {
    heartRate = NAN;
    spo2 = NAN;
    heartRateValid = false;
    spo2Valid = false;
  }

  currentDecision = evaluateDecision();
  applyDecision(currentDecision);

  if (!WiFi.isConnected() || !firebaseReady || !Firebase.ready()) {
    enqueueLocalLog(currentDecision);
  } else if (offlineQueueDirty && millis() - lastLocalLogFlush >= CLOUD_PUSH_INTERVAL_MS) {
    lastLocalLogFlush = millis();
    flushQueuedLogs();
  }

  if (currentDecision.emergency || currentDecision.sensorFault) {
    updateCloudStatus(currentDecision.recommendation);
  } else {
    updateCloudStatus(currentDecision.riskLevel + String(" - ") + currentDecision.recommendation);
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(HEATER_RELAY_PIN, OUTPUT);
  pinMode(UV_RELAY_PIN, OUTPUT);
  pinMode(SAFETY_RELAY_PIN, OUTPUT);
  setHeater(false);
  setUv(false);
  setSafetyRelay(true);

  dht.begin();
  babySensor.begin();
  Wire.begin();
  initializeDisplay();
  showBootMessage("NeoGuard", "Starting sensors...");

  if (!pox.begin()) {
    Serial.println("MAX30100 init failed");
    max30100Ready = false;
    showBootMessage("NeoGuard", "MAX30100 failed", "Check wiring");
  } else {
    max30100Ready = true;
    pox.setIRLedCurrent(MAX30100_LED_CURR_7_6MA);
    pox.setOnBeatDetectedCallback(onBeatDetected);
    showBootMessage("NeoGuard", "MAX30100 ready");
  }

  showBootMessage("NeoGuard", "Connecting WiFi...");
  connectWifi();
  showBootMessage("NeoGuard", WiFi.status() == WL_CONNECTED ? "WiFi ready" : "WiFi waiting");
  setupFirebase();
  setupRestServer();
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
    onlinePublished = false;
    Serial.println("WiFi not connected, retrying...");
  }

  firebaseReady = Firebase.ready();

  if (WiFi.status() == WL_CONNECTED) {
    server.handleClient();
  }

  if ((!firebaseReady || !Firebase.ready()) && offlineQueueDirty && millis() - lastLocalLogFlush >= CLOUD_PUSH_INTERVAL_MS) {
    lastLocalLogFlush = millis();
    flushQueuedLogs();
  }

  if (firebaseReady && !onlinePublished) {
    publishConnectionStatus();
    onlinePublished = true;
  }

  if (firebaseReady && millis() - lastCloudStatus >= CLOUD_STATUS_INTERVAL_MS) {
    lastCloudStatus = millis();
    publishConnectionStatus();
  }

  if (firebaseReady && millis() - lastCloudPush >= CLOUD_PUSH_INTERVAL_MS) {
    lastCloudPush = millis();
    publishTelemetry();
  }

  if (firebaseReady && millis() - lastCloudCommandPoll >= CLOUD_COMMAND_POLL_MS) {
    lastCloudCommandPoll = millis();
    consumeCloudCommands();
  }

  renderDisplay();
}