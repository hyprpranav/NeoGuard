#include <WiFi.h>
#include <WebServer.h>
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

const float BABY_TEMP_MIN = 36.5f;
const float BABY_TEMP_MAX = 37.5f;
const float OVERHEAT_LIMIT = 38.5f;
const unsigned long SENSOR_INTERVAL_MS = 1000;
const unsigned long CLOUD_PUSH_INTERVAL_MS = 3500;
const unsigned long CLOUD_COMMAND_POLL_MS = 1200;
const unsigned long CLOUD_STATUS_INTERVAL_MS = 5000;
const unsigned long WIFI_RETRY_INTERVAL_MS = 10000;

const int ONE_WIRE_BUS = 4;
const int DHT_PIN = 14;
const int PULSE_SENSOR_PIN = 34;
const int HEATER_LED_PIN = 26;
const int SAFETY_RELAY_PIN = 27;
const int UV_RELAY_PIN = 25;

const uint32_t REPORTING_PERIOD_MS = 1000;

DHT dht(DHT_PIN, DHT11);
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature babySensor(&oneWire);
PulseOximeter pox;
WebServer server(80);

float babyTemp = NAN;
float envTemp = NAN;
float spo2 = NAN;
float heartRate = NAN;
int pulseValue = 0;
bool heaterOn = false;
bool uvOn = false;
bool safetyRelayOn = true;
bool sensorFault = false;
bool manualHeaterOverride = false;
bool manualHeaterState = false;
bool max30100Ready = false;
String safetyCondition = "Booting";

unsigned long lastSensorRead = 0;
unsigned long lastMax30100Report = 0;
unsigned long lastCloudPush = 0;
unsigned long lastCommandPoll = 0;
unsigned long lastCloudStatus = 0;
unsigned long lastWifiRetry = 0;
String lastCommandRequestId = "";

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig firebaseConfig;
bool firebaseReady = false;

void onBeatDetected() {
  Serial.println("Beat detected");
}

String deviceRoot() {
  return String("/devices/") + DEVICE_ID;
}

String currentIp() {
  return WiFi.localIP().toString();
}

void setHeater(bool enabled) {
  heaterOn = enabled;
  digitalWrite(HEATER_LED_PIN, enabled ? HIGH : LOW);
}

void setUv(bool enabled) {
  uvOn = enabled;
  digitalWrite(UV_RELAY_PIN, enabled ? LOW : HIGH);
}

void setSafetyRelay(bool enabled) {
  safetyRelayOn = enabled;
  digitalWrite(SAFETY_RELAY_PIN, enabled ? LOW : HIGH);
}

String jsonNumber(float value, int decimals) {
  return isnan(value) ? "null" : String(value, decimals);
}

String buildJson() {
  String json = "{";
  json += "\"deviceIp\":\"http://" + currentIp() + "\",";
  json += "\"babyTemp\":" + jsonNumber(babyTemp, 2) + ",";
  json += "\"envTemp\":" + jsonNumber(envTemp, 2) + ",";
  json += "\"spo2\":" + jsonNumber(spo2, 1) + ",";
  json += "\"heartRate\":" + jsonNumber(heartRate, 1) + ",";
  json += "\"pulse\":" + String(pulseValue) + ",";
  json += "\"heaterOn\":" + String(heaterOn ? "true" : "false") + ",";
  json += "\"uvOn\":" + String(uvOn ? "true" : "false") + ",";
  json += "\"safetyRelayOn\":" + String(safetyRelayOn ? "true" : "false") + ",";
  json += "\"sensorFault\":" + String(sensorFault ? "true" : "false") + ",";
  json += "\"safetyCondition\":\"" + safetyCondition + "\"";
  json += "}";
  return json;
}

void handleData() {
  server.send(200, "application/json", buildJson());
}

void printWifiCloudWarning() {
  Serial.println("WiFi is not connected. Failed to push data to cloud.");
  Serial.println("Connect locally to ESP32 using its IP once WiFi is restored.");
}

void handleHeaterOn() {
  manualHeaterOverride = true;
  manualHeaterState = true;
  updateControlLogic();
  server.send(200, "application/json", buildJson());
}

void handleHeaterOff() {
  manualHeaterOverride = true;
  manualHeaterState = false;
  updateControlLogic();
  server.send(200, "application/json", buildJson());
}

void handleUvOn() {
  setUv(true);
  server.send(200, "application/json", buildJson());
}

void handleUvOff() {
  setUv(false);
  server.send(200, "application/json", buildJson());
}

void handleNotFound() {
  server.send(404, "application/json", "{\"message\":\"Not found\"}");
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.println();
  Serial.print("Connecting to WiFi SSID: ");
  Serial.println(WIFI_SSID);
  Serial.print("Waiting for connection");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print('.');
  }

  Serial.println();
  Serial.println("WiFi connected");
  Serial.print("ESP32 IP Address: ");
  Serial.println(currentIp());
  Serial.println("Type this IP into the NeoGuard dashboard and press Connect.");
}

bool ensureWifiConnected() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }

  if (millis() - lastWifiRetry >= WIFI_RETRY_INTERVAL_MS) {
    lastWifiRetry = millis();
    printWifiCloudWarning();
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

  auth.user.email = FIREBASE_USER_EMAIL;
  auth.user.password = FIREBASE_USER_PASSWORD;

  Firebase.reconnectWiFi(true);
  Firebase.begin(&firebaseConfig, &auth);
}

void publishConnectionStatus() {
  if (!firebaseReady || !Firebase.ready()) {
    return;
  }

  FirebaseJson status;
  status.set("wifiConnected", WiFi.status() == WL_CONNECTED);
  status.set("ip", currentIp());
  status.set("rssi", WiFi.RSSI());
  status.set("systemLive", true);
  status.set("uptimeMs", (int) millis());
  status.set("lastSeen", ".sv");
  status.set("lastSeen/.sv", "timestamp");
  status.set("updatedAt/.sv", "timestamp");

  firebasePathSetJson(deviceRoot() + "/status/connection", status);
}

void publishTelemetry() {
  if (!firebaseReady || !Firebase.ready()) {
    return;
  }

  FirebaseJson latest;
  latest.set("deviceIp", String("http://") + currentIp());
  latest.set("babyTemp", isnan(babyTemp) ? 0 : babyTemp);
  latest.set("envTemp", isnan(envTemp) ? 0 : envTemp);
  latest.set("spo2", isnan(spo2) ? 0 : spo2);
  latest.set("heartRate", isnan(heartRate) ? 0 : heartRate);
  latest.set("pulse", pulseValue);
  latest.set("heaterOn", heaterOn);
  latest.set("uvOn", uvOn);
  latest.set("safetyRelayOn", safetyRelayOn);
  latest.set("sensorFault", sensorFault);
  latest.set("safetyCondition", safetyCondition);
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
  history.set("heaterOn", heaterOn);
  history.set("uvOn", uvOn);
  history.set("safetyRelayOn", safetyRelayOn);
  history.set("sensorFault", sensorFault);
  history.set("safetyCondition", safetyCondition);
  history.set("systemLive", true);
  history.set("uptimeMs", (int) millis());
  history.set("createdAt/.sv", "timestamp");

  if (!Firebase.RTDB.pushJSON(&fbdo, (deviceRoot() + "/telemetry/history").c_str(), &history)) {
    Serial.print("Firebase pushJSON failed: ");
    Serial.println(fbdo.errorReason());
  }
}

bool parseSwitchState(const String& rawValue, bool currentValue, bool* hasValue) {
  String v = rawValue;
  v.trim();
  v.toLowerCase();

  if (v == "on") {
    *hasValue = true;
    return true;
  }

  if (v == "off") {
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
  firebasePathSetJson(deviceRoot() + "/commands/ack", ack);
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

  bool hasHeater = false;
  bool hasUv = false;

  bool nextHeater = parseSwitchState(heaterStateRaw, heaterOn, &hasHeater);
  bool nextUv = parseSwitchState(uvStateRaw, uvOn, &hasUv);

  if (hasHeater) {
    manualHeaterOverride = true;
    manualHeaterState = nextHeater;
  }

  if (hasUv) {
    setUv(nextUv);
  }

  updateControlLogic();
  lastCommandRequestId = requestId;
  acknowledgeCommand(requestId);
  Serial.print("Processed cloud command requestId=");
  Serial.println(requestId);
}

void readSensors() {
  babySensor.requestTemperatures();
  float nextBabyTemp = babySensor.getTempCByIndex(0);
  float nextEnvTemp = dht.readTemperature();
  int rawPulse = analogRead(PULSE_SENSOR_PIN);

  pulseValue = map(rawPulse, 0, 4095, 55, 155);

  sensorFault = false;

  if (nextBabyTemp == DEVICE_DISCONNECTED_C || nextBabyTemp < 20.0f || nextBabyTemp > 45.0f) {
    sensorFault = true;
  } else {
    babyTemp = nextBabyTemp;
  }

  if (isnan(nextEnvTemp)) {
    sensorFault = true;
  } else {
    envTemp = nextEnvTemp;
  }

  if (max30100Ready && millis() - lastMax30100Report >= REPORTING_PERIOD_MS) {
    heartRate = pox.getHeartRate();
    spo2 = pox.getSpO2();
    lastMax30100Report = millis();
  } else if (!max30100Ready) {
    heartRate = NAN;
    spo2 = NAN;
  }

  updateControlLogic();
}

void updateControlLogic() {
  if (sensorFault || (!isnan(babyTemp) && babyTemp >= OVERHEAT_LIMIT)) {
    setSafetyRelay(false);
    setHeater(false);
    safetyCondition = sensorFault ? "Critical sensor fault" : "Critical overheat detected";
    return;
  }

  setSafetyRelay(true);

  bool automaticHeaterState = false;
  if (!isnan(babyTemp) && babyTemp < BABY_TEMP_MIN) {
    automaticHeaterState = true;
  }
  if (!isnan(babyTemp) && babyTemp > BABY_TEMP_MAX) {
    automaticHeaterState = false;
  }

  if (manualHeaterOverride) {
    setHeater(manualHeaterState);
  } else {
    setHeater(automaticHeaterState);
  }

  if (!isnan(babyTemp) && babyTemp >= BABY_TEMP_MIN && babyTemp <= BABY_TEMP_MAX) {
    safetyCondition = "Temperature stable";
  } else if (!isnan(babyTemp) && babyTemp < BABY_TEMP_MIN) {
    safetyCondition = "Baby temperature low";
  } else if (!isnan(babyTemp) && babyTemp > BABY_TEMP_MAX) {
    safetyCondition = "Baby temperature high";
  } else {
    safetyCondition = "Monitoring";
  }
}

void setupRoutes() {
  server.on("/data", HTTP_GET, handleData);
  server.on("/heater/on", HTTP_GET, handleHeaterOn);
  server.on("/heater/off", HTTP_GET, handleHeaterOff);
  server.on("/uv/on", HTTP_GET, handleUvOn);
  server.on("/uv/off", HTTP_GET, handleUvOff);
  server.onNotFound(handleNotFound);
  server.begin();
}

void setup() {
  Serial.begin(115200);

  pinMode(HEATER_LED_PIN, OUTPUT);
  pinMode(SAFETY_RELAY_PIN, OUTPUT);
  pinMode(UV_RELAY_PIN, OUTPUT);
  pinMode(PULSE_SENSOR_PIN, INPUT);

  setHeater(false);
  setSafetyRelay(true);
  setUv(false);

  dht.begin();
  babySensor.begin();
  Wire.begin();

  if (!pox.begin()) {
    Serial.println("MAX30100 initialization failed");
    sensorFault = true;
  } else {
    max30100Ready = true;
    pox.setIRLedCurrent(MAX30100_LED_CURR_7_6MA);
    pox.setOnBeatDetectedCallback(onBeatDetected);
  }

  connectWifi();
  setupFirebase();
  setupRoutes();
}

void loop() {
  server.handleClient();
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

  if (firebaseReady && millis() - lastCloudStatus >= CLOUD_STATUS_INTERVAL_MS) {
    lastCloudStatus = millis();
    publishConnectionStatus();
  }

  if (firebaseReady && millis() - lastCloudPush >= CLOUD_PUSH_INTERVAL_MS) {
    lastCloudPush = millis();
    publishTelemetry();
  }

  if (firebaseReady && millis() - lastCommandPoll >= CLOUD_COMMAND_POLL_MS) {
    lastCommandPoll = millis();
    consumeCloudCommands();
  }
}