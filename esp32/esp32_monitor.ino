#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <DHT.h>
#include <MAX30100_PulseOximeter.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

const unsigned long SENSOR_INTERVAL_MS = 1000;
const unsigned long DISPLAY_REFRESH_MS = 1000;
const unsigned long SERIAL_REPORT_MS = 1000;

const int ONE_WIRE_BUS = 4;
const int DHT_PIN = 14;
const int PULSE_SENSOR_PIN = 34;
const int HEATER_RELAY_PIN = 26;
const int UV_RELAY_PIN = 25;
const int SAFETY_RELAY_PIN = 27; // Always ON 24/7

const int OLED_WIDTH = 128;
const int OLED_HEIGHT = 64;
const int OLED_RESET = -1;

DHT dht(DHT_PIN, DHT11);
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature babySensor(&oneWire);
PulseOximeter pox;
Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET);

float babyTemp = NAN;
float envTemp = NAN;
float spo2 = NAN;
float heartRate = NAN;
int pulseValue = 0;
float neoWarmHealthScore = 100.0f;
bool max30100Ready = false;
bool babyTempValid = false;
bool envTempValid = false;
bool spo2Valid = false;
bool heartRateValid = false;
bool oledReady = false;
bool emergencyAlertActive = false;

unsigned long lastSensorRead = 0;
unsigned long lastDisplayRefresh = 0;
unsigned long lastSerialReport = 0;
unsigned long lastMax30100Report = 0;

bool heaterOn = false;
bool uvOn = false;
bool safetyRelayOn = true;

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

DecisionResult currentDecision = {100.0f, "Normal", "Continue monitoring", "System booting", "STABLE", false, false, false, false};

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

String boolJson(bool value) {
  return value ? "true" : "false";
}

float clampFloat(float value, float minimumValue, float maximumValue) {
  if (value < minimumValue) return minimumValue;
  if (value > maximumValue) return maximumValue;
  return value;
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

  if (!babyTempValid || !envTempValid) {
    result.sensorFault = true;
    result.healthScore -= 20.0f;
    result.reason = "Temperature sensor fault detected";
  }

  if (babyTempValid && envTempValid) {
    if (babyTemp < 36.5f && envTemp < 30.0f) {
      result.heatingRequired = true;
      result.healthScore -= 10.0f;
      result.reason = "Baby and environment temperature below ideal range";
    } else if (babyTemp > 37.5f) {
      result.coolingRequired = true;
      result.healthScore -= 15.0f;
      result.reason = "Baby temperature above ideal range";
    }

    if (babyTemp < 35.5f || babyTemp > 38.0f) {
      result.emergency = true;
    }
  }

  if (spo2Valid) {
    if (spo2 < 92.0f) result.healthScore -= 15.0f;
    if (spo2 < 90.0f) result.emergency = true;
  }

  if (heartRateValid) {
    if (heartRate < 100.0f || heartRate > 180.0f) result.healthScore -= 12.0f;
    if (heartRate < 80.0f || heartRate > 200.0f) result.emergency = true;
  }

  result.healthScore = clampFloat(result.healthScore, 0.0f, 100.0f);

  if (result.emergency || result.sensorFault || result.healthScore < 35.0f) {
    result.riskLevel = "High";
    result.stateName = result.sensorFault ? "SENSOR_FAULT" : "EMERGENCY";
    result.recommendation = "Check baby immediately";
  } else if (result.healthScore < 60.0f) {
    result.riskLevel = "Moderate";
    result.stateName = result.heatingRequired ? "WARMING" : "COOLING";
    result.recommendation = result.heatingRequired ? "Increasing heat" : "Monitoring";
  } else if (result.healthScore < 80.0f) {
    result.riskLevel = "Low";
    result.stateName = result.heatingRequired ? "WARMING" : "STABLE";
    result.recommendation = result.heatingRequired ? "Maintain warming" : "Continue monitoring";
  } else {
    result.riskLevel = "Normal";
    result.stateName = "STABLE";
    result.recommendation = "Maintain thermal balance";
  }

  return result;
}

void applyDecision(const DecisionResult& decision) {
  currentDecision = decision;
  neoWarmHealthScore = decision.healthScore;

  if (decision.emergency || decision.sensorFault) {
    emergencyAlertActive = true;
    setHeater(false); 
    setUv(false);
    return;
  }

  emergencyAlertActive = false;
  
  // Power supply relay MUST always remain ON for sensors
  setSafetyRelay(true);

  if (decision.heatingRequired) {
    setHeater(true);
  } else if (decision.coolingRequired) {
    setHeater(false);
  } else {
    setHeater(false);
  }
}

String escapeJson(String value) {
  value.replace("\\", "\\\\");
  value.replace("\"", "\\\"");
  return value;
}

void sendSerialData() {
  String payload = "{";
  payload += "\"deviceId\":\"neoguard-one\",";
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
  payload += "\"safetyRelayOn\":" + boolJson(safetyRelayOn);
  payload += "}";
  
  // Sending JSON string to serial port
  Serial.println(payload);
}

void handleSerialCommands() {
  while (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.length() > 0) {
      // Basic JSON string parsing to check overriding commands from dashboard
      if (line.indexOf("\"heaterOn\":true") >= 0) {
        setHeater(true);
      } else if (line.indexOf("\"heaterOn\":false") >= 0) {
        setHeater(false);
      }
      
      if (line.indexOf("\"uvOn\":true") >= 0) {
        setUv(true);
      } else if (line.indexOf("\"uvOn\":false") >= 0) {
        setUv(false);
      }
    }
  }
}

void showMessage(const String& line1, const String& line2, const String& line3 = "") {
  if (!oledReady) return;
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println(line1);
  display.println(line2);
  if (line3.length() > 0) display.println(line3);
  display.display();
}

void initializeDisplay() {
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    oledReady = false;
    return;
  }
  oledReady = true;
  showMessage("NeoGuard", "Booting...", "Please wait");
}

void renderDisplay() {
  if (!oledReady || millis() - lastDisplayRefresh < DISPLAY_REFRESH_MS) return;
  lastDisplayRefresh = millis();
  
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  display.setCursor(0, 0);
  display.println("NeoGuard (Serial)");

  display.setCursor(0, 10);
  display.println(currentDecision.stateName);

  display.setCursor(0, 20);
  display.print("H:");
  display.print(String(neoWarmHealthScore, 0));
  display.print(" ");
  display.println(currentDecision.riskLevel);

  display.setCursor(0, 30);
  display.print("B:");
  if (isnan(babyTemp)) display.print("--C"); else { display.print(babyTemp, 1); display.print("C"); }
  display.print(" E:");
  if (isnan(envTemp)) display.print("--C"); else { display.print(envTemp, 1); display.print("C"); }

  display.setCursor(0, 40);
  display.print("SpO2:");
  display.print(spo2Valid ? String(spo2, 0) : String("--"));
  display.print(" HR:");
  display.print(heartRateValid ? String(heartRate, 0) : String("--"));

  display.setCursor(0, 54);
  display.print(emergencyAlertActive ? "ALERT " : "SAFE ");

  display.display();
}

void readSensors() {
  babySensor.requestTemperatures();
  float nextBabyTemp = babySensor.getTempCByIndex(0);
  float nextEnvTemp = dht.readTemperature();
  int rawPulse = analogRead(PULSE_SENSOR_PIN);

  pulseValue = constrain(map(rawPulse, 0, 4095, 55, 155), 55, 155);

  babyTempValid = (nextBabyTemp != DEVICE_DISCONNECTED_C && nextBabyTemp >= 20.0f && nextBabyTemp <= 45.0f);
  if (babyTempValid) babyTemp = nextBabyTemp; else babyTemp = NAN;

  envTempValid = !isnan(nextEnvTemp);
  if (envTempValid) envTemp = nextEnvTemp; else envTemp = NAN;

  if (max30100Ready && millis() - lastMax30100Report >= 1000) {
    heartRate = pox.getHeartRate();
    spo2 = pox.getSpO2();
    heartRateValid = !isnan(heartRate) && heartRate > 20.0f && heartRate < 250.0f;
    spo2Valid = !isnan(spo2) && spo2 > 50.0f && spo2 <= 100.0f;
    if (!heartRateValid) heartRate = NAN;
    if (!spo2Valid) spo2 = NAN;
    lastMax30100Report = millis();
  }

  currentDecision = evaluateDecision();
  applyDecision(currentDecision);
}

void setup() {
  Serial.begin(115200);

  pinMode(HEATER_RELAY_PIN, OUTPUT);
  pinMode(UV_RELAY_PIN, OUTPUT);
  pinMode(SAFETY_RELAY_PIN, OUTPUT);
  
  // Power supply relay always on 24/7
  setSafetyRelay(true);
  
  setHeater(false);
  setUv(false);

  dht.begin();
  babySensor.begin();
  Wire.begin();
  initializeDisplay();
  
  showMessage("NeoGuard", "Starting sensors...");
  
  if (!pox.begin()) {
    max30100Ready = false;
    showMessage("NeoGuard", "MAX30100 failed");
  } else {
    max30100Ready = true;
    pox.setIRLedCurrent(MAX30100_LED_CURR_7_6MA);
    pox.setOnBeatDetectedCallback(onBeatDetected);
    showMessage("NeoGuard", "Ready.");
  }
}

void loop() {
  if (max30100Ready) {
    pox.update();
  }

  if (millis() - lastSensorRead >= SENSOR_INTERVAL_MS) {
    lastSensorRead = millis();
    readSensors();
  }

  if (millis() - lastSerialReport >= SERIAL_REPORT_MS) {
    lastSerialReport = millis();
    sendSerialData();
  }

  handleSerialCommands();
  renderDisplay();
}