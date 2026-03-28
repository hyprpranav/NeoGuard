#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <DHT.h>
#include <MAX30100_PulseOximeter.h>

const char* WIFI_SSID = "Oppo A77s";
const char* WIFI_PASSWORD = "9080061674";

const float BABY_TEMP_MIN = 36.5f;
const float BABY_TEMP_MAX = 37.5f;
const float OVERHEAT_LIMIT = 38.5f;
const unsigned long SENSOR_INTERVAL_MS = 1000;

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

void onBeatDetected() {
  Serial.println("Beat detected");
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

  if (max30100Ready && !pox.update()) {
    sensorFault = true;
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
}