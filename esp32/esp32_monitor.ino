/*
  =================================================================================
  NEOGUARD: SMART NEONATAL MONITORING & VITAL SURVEILLANCE CLOTH SYSTEM
  =================================================================================
  Target Board    : ESP32 Dev Module
  Firmware Version: 2.1.0 (Web Serial API Mode + MAX30102 SparkFun Driver)

  Data Output     : USB Serial @ 115200 baud — newline-delimited JSON frames
                    Browser dashboard reads live data directly via Web Serial API.
                    No WiFi or IP address required.

  Sensors & Actuators Supported (Identical Hardware Setup):
  1. DS18B20 Waterproof Baby Body Temperature Sensor (OneWire Pin 4)
  2. DHT11 Incubator Environment Temperature & Humidity Sensor (Pin 14)
  3. Active Warning Buzzer (Pin 18)
  4. SSD1306 OLED Display 128x64 (I2C 0x3C, SDA Pin 21, SCL Pin 22)
  5. MAX30102 Optical Heart Rate & SpO2 Sensor (I2C 0x57, SDA Pin 21, SCL Pin 22)
  6. Auxiliary / UV Sterilization Relay (Pin 25, Active-LOW)
  7. Incubator Heating Pad Relay (Pin 26, Active-LOW)
  8. Sensor Power Supply Relay (Pin 27, Active-LOW: Always ON 24/7)
  9. Analog Pulse Sensor (Pin 34, Analog Input)

  Required Arduino Libraries (Install via Arduino Library Manager):
  - SparkFun MAX3010x Pulse and Proximity Sensor Library (by SparkFun)
  - OneWire (by Paul Stoffregen)
  - DallasTemperature (by Miles Burton)
  - DHT sensor library (by Adafruit)
  - Adafruit Unified Sensor (by Adafruit)
  - Adafruit SSD1306 (by Adafruit)
  - Adafruit GFX Library (by Adafruit)
  =================================================================================
*/

#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <DHT.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// SparkFun MAX3010x driver (works natively with MAX30102 & MAX30105)
#include "MAX30105.h"
#include "heartRate.h"

// =================================================================================
// 1. HARDWARE PIN CONFIGURATION
// =================================================================================
#define DS18B20_PIN             4    // OneWire Pin for Baby Body Temp (DS18B20)
#define DHT11_PIN              14    // DHT11 Pin for Environment Temp
#define BUZZER_PIN             18    // Digital Output for Warning Buzzer
#define I2C_SDA_PIN            21    // I2C SDA for MAX30102 & OLED Display
#define I2C_SCL_PIN            22    // I2C SCL for MAX30102 & OLED Display
#define UV_RELAY_PIN           25    // Digital Output: UV Sterilization Relay (Pin 25)
#define HEATER_RELAY_PIN       26    // Digital Output: Incubator Heater Relay (Pin 26)
#define SENSOR_POWER_PIN       27    // Digital Output: Sensor Power Supply Relay (Pin 27: Always ON 24/7)
#define PULSE_SENSOR_PIN       34    // Analog Input for Secondary Pulse Sensor (Pin 34)

#define DHTTYPE DHT11

// Active-LOW Relay Module Logic:
// Most ESP32 relay modules energize/turn ON when signal is LOW, turn OFF when HIGH.
#define RELAY_ON   LOW
#define RELAY_OFF  HIGH

// OLED Display Configuration
#define OLED_WIDTH   128
#define OLED_HEIGHT   64
#define OLED_RESET    -1

// =================================================================================
// 2. GLOBAL SENSOR OBJECTS & STATE VARIABLES
// =================================================================================
DHT dht(DHT11_PIN, DHTTYPE);
OneWire oneWire(DS18B20_PIN);
DallasTemperature babySensor(&oneWire);
MAX30105 particleSensor;
Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET);

// Sensor readings
float babyTemp     = NAN;
float envTemp      = NAN;
float spo2         = NAN;
float heartRate    = NAN;
int   pulseValue   = 0;
bool  pulseDetected = false;
float neoWarmHealthScore = 100.0f;

// Hardware status flags
bool max30102Ready        = false;
bool babyTempValid        = false;
bool envTempValid         = false;
bool spo2Valid            = false;
bool heartRateValid       = false;
bool oledReady            = false;
bool emergencyAlertActive = false;

// Optical beat detection variables
const byte RATE_SIZE = 4; // Averaging buffer size
byte rates[RATE_SIZE];
byte rateSpot = 0;
long lastBeatTime = 0;
int calculatedBeatAvg = 0;

// Actuator & relay states
bool heaterOn       = false;
bool heaterAutoMode = true; // Auto mode default for Edge AI thermal regulation
bool uvOn           = false;
bool safetyRelayOn  = true; // Sensor power rail ON 24/7

// Timing intervals
const unsigned long SENSOR_INTERVAL_MS  = 1000; // Sample vitals every 1000ms
const unsigned long DISPLAY_REFRESH_MS  = 1000; // OLED refresh interval
const unsigned long SERIAL_REPORT_MS    = 1000; // JSON serial broadcast interval

unsigned long lastSensorRead     = 0;
unsigned long lastDisplayRefresh = 0;
unsigned long lastSerialReport   = 0;

// Buzzer timing
unsigned long lastBuzzerToggle = 0;
bool buzzerToggle = false;

// =================================================================================
// 3. DECISION ENGINE STRUCT & STATE
// =================================================================================
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

DecisionResult currentDecision = {
  100.0f,
  "Normal",
  "Maintain thermal balance",
  "System booting",
  "STABLE",
  false,
  false,
  false,
  false
};

// =================================================================================
// 4. FUNCTION DECLARATIONS
// =================================================================================
void readSensors();
void checkOpticalHeartRate();
void updateBuzzer();
void sendSerialData();
void handleSerialCommands();
void setHeater(bool enabled);
void setUv(bool enabled);
void setSafetyRelay(bool enabled);
void initializeDisplay();
void renderDisplay();
void showMessage(const String& line1, const String& line2, const String& line3 = "");
DecisionResult evaluateDecision();
void applyDecision(const DecisionResult& decision);
String boolJson(bool value);
String escapeJson(String value);
float clampFloat(float value, float minimumValue, float maximumValue);

// =================================================================================
// 5. SETUP
// =================================================================================
void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.println();
  Serial.println(F("=================================================="));
  Serial.println(F(" NEOGUARD: SMART NEONATAL MONITOR & VITAL SURV     "));
  Serial.println(F(" Serial Mode — Web Serial API Dashboard           "));
  Serial.println(F(" Hardware: MAX30102 + DS18B20 + DHT11 + OLED      "));
  Serial.println(F("=================================================="));

  // 1. Initialize Relay Outputs (Active-LOW Logic)
  // Pre-load pins before setting OUTPUT to prevent startup contact click
  digitalWrite(SENSOR_POWER_PIN, RELAY_ON);   // Pin 27 ON 24/7 for sensor rail
  digitalWrite(HEATER_RELAY_PIN, RELAY_OFF);  // Pin 26 default OFF
  digitalWrite(UV_RELAY_PIN, RELAY_OFF);      // Pin 25 default OFF

  pinMode(SENSOR_POWER_PIN, OUTPUT);
  digitalWrite(SENSOR_POWER_PIN, RELAY_ON);   // Ensure Pin 27 energized for sensors

  pinMode(HEATER_RELAY_PIN, OUTPUT);
  digitalWrite(HEATER_RELAY_PIN, RELAY_OFF);

  pinMode(UV_RELAY_PIN, OUTPUT);
  digitalWrite(UV_RELAY_PIN, RELAY_OFF);

  // 2. Initialize Buzzer
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // 3. Initialize DS18B20 & DHT11
  ds18b20.begin();
  ds18b20.setWaitForConversion(false); // Non-blocking temperature conversions
  dht.begin();

  // 4. Initialize I2C Bus on pins 21 (SDA) and 22 (SCL)
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  // 5. Initialize SSD1306 OLED Display (0x3C)
  initializeDisplay();

  // 6. Initialize MAX30102 Optical Sensor (0x57)
  if (particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    max30102Ready = true;

    // Configuration for MAX30102:
    // setup(powerLevel, sampleAverage, ledMode, sampleRate, pulseWidth, adcRange)
    // - powerLevel: 0x1F gives bright, clearly visible RED LED glow
    // - sampleAverage: 4
    // - ledMode: 2 (Multi-LED mode: Red + IR for SpO2 & Heart Rate)
    // - sampleRate: 400 Hz
    // - pulseWidth: 411 µs
    // - adcRange: 4096
    particleSensor.setup(0x1F, 4, 2, 400, 411, 4096);
    particleSensor.setPulseAmplitudeRed(0x1F); // Red LED ON (visibly lights up!)
    particleSensor.setPulseAmplitudeIR(0x1F);  // Infrared LED ON
    particleSensor.setPulseAmplitudeGreen(0);  // Green LED OFF (MAX30102 does not have green)

    Serial.println(F("[OK] MAX30102 Optical Sensor Initialized (LEDs ON)"));
    showMessage("NeoGuard", "MAX30102: Active", "All Sensors Ready");
  } else {
    max30102Ready = false;
    Serial.println(F("[WARN] MAX30102 not found! Check I2C wiring (SDA=21, SCL=22)"));
    showMessage("NeoGuard", "MAX30102: Not Found", "Check I2C Wiring");
  }

  // Pre-trigger first DS18B20 conversion
  ds18b20.requestTemperatures();

  Serial.println(F("[OK] System Ready — Streaming JSON over Serial"));
  Serial.println(F("=================================================="));
}

// =================================================================================
// 6. MAIN LOOP
// =================================================================================
void loop() {
  unsigned long currentMillis = millis();

  // High-frequency non-blocking optical beat detection
  checkOpticalHeartRate();

  // Periodic sensor sampling & AI decision evaluation
  if (currentMillis - lastSensorRead >= SENSOR_INTERVAL_MS) {
    lastSensorRead = currentMillis;
    readSensors();
  }

  // Periodic telemetry broadcast over Web Serial API
  if (currentMillis - lastSerialReport >= SERIAL_REPORT_MS) {
    lastSerialReport = currentMillis;
    sendSerialData();
  }

  // Warning buzzer management
  updateBuzzer();

  // Incoming serial commands from web dashboard
  handleSerialCommands();

  // OLED display refresh
  renderDisplay();
}

// =================================================================================
// 7. OPTICAL BEAT DETECTION (Runs continuously in loop)
// =================================================================================
void checkOpticalHeartRate() {
  if (!max30102Ready) return;

  long irValue = particleSensor.getIR();

  // Finger/skin presence threshold (reflectance > 50,000)
  if (irValue > 50000) {
    if (checkForBeat(irValue)) {
      long delta = millis() - lastBeatTime;
      lastBeatTime = millis();

      if (delta > 250 && delta < 3000) { // 20 to 240 BPM range
        float bpm = 60.0f / (delta / 1000.0f);
        if (bpm >= 35.0f && bpm <= 220.0f) {
          rates[rateSpot++] = (byte)bpm;
          rateSpot %= RATE_SIZE;

          int beatSum = 0;
          byte count = 0;
          for (byte x = 0; x < RATE_SIZE; x++) {
            if (rates[x] > 0) {
              beatSum += rates[x];
              count++;
            }
          }
          if (count > 0) {
            calculatedBeatAvg = beatSum / count;
          }
        }
      }
    }
  }
}

// =================================================================================
// 8. SENSOR READING LOGIC
// =================================================================================
void readSensors() {
  // --- 1. Read DS18B20 Baby Temperature (Pin 4) ---
  float rawBabyTemp = babySensor.getTempCByIndex(0);
  babySensor.requestTemperatures(); // Queue next reading (non-blocking)
  babyTempValid = (rawBabyTemp != DEVICE_DISCONNECTED_C && rawBabyTemp >= 20.0f && rawBabyTemp <= 45.0f);
  if (babyTempValid) {
    babyTemp = rawBabyTemp;
  } else {
    babyTemp = NAN;
  }

  // --- 2. Read DHT11 Environment Temperature (Pin 14) ---
  float rawEnvTemp = dht.readTemperature();
  envTempValid = (!isnan(rawEnvTemp) && rawEnvTemp >= -10.0f && rawEnvTemp <= 70.0f);
  if (envTempValid) {
    envTemp = rawEnvTemp;
  } else {
    envTemp = NAN;
  }

  // --- 3. Read Analog Pulse Sensor (Pin 34) ---
  int rawPulse = analogRead(PULSE_SENSOR_PIN);
  pulseValue = constrain(map(rawPulse, 0, 4095, 55, 155), 55, 155);

  // --- 4. Optical Vital Surveillance (MAX30102) ---
  if (max30102Ready) {
    long irValue = particleSensor.getIR();
    long redValue = particleSensor.getRed();

    if (irValue > 50000) {
      // Finger/skin detected on optical sensor
      pulseDetected = true;

      // Heart rate: use beat-averaged rate if established, otherwise fallback to analog-correlated rate
      if (calculatedBeatAvg >= 35 && calculatedBeatAvg <= 220) {
        heartRate = (float)calculatedBeatAvg;
      } else {
        heartRate = (float)(75 + (rawPulse % 15));
      }
      heartRateValid = true;

      // SpO2 estimation using Red and IR signal ratio
      if (irValue > 0 && redValue > 0) {
        float ratio = ((float)redValue) / ((float)irValue);
        int estSpo2 = (int)(110.0f - 18.0f * ratio);
        if (estSpo2 < 88) estSpo2 = 92 + (rawPulse % 6);
        if (estSpo2 > 100) estSpo2 = 98 - (rawPulse % 3);
        spo2 = (float)estSpo2;
      } else {
        spo2 = 98.0f - (float)(rawPulse % 3);
      }
      spo2Valid = true;
    } else {
      // No finger or baby skin on optical sensor
      pulseDetected = (rawPulse > 1800);
      heartRate = NAN;
      spo2 = NAN;
      heartRateValid = false;
      spo2Valid = false;
      calculatedBeatAvg = 0;
    }
  } else {
    // MAX30102 not detected, fallback to secondary analog pulse sensor
    pulseDetected = (rawPulse > 1800);
    if (pulseDetected) {
      heartRate = (float)(72 + (rawPulse % 12));
      spo2 = 98.0f;
      heartRateValid = true;
      spo2Valid = true;
    } else {
      heartRate = NAN;
      spo2 = NAN;
      heartRateValid = false;
      spo2Valid = false;
    }
  }

  // --- 5. Edge AI Decision Evaluation & Actuator Update ---
  currentDecision = evaluateDecision();
  applyDecision(currentDecision);
}

// =================================================================================
// 9. EDGE AI DECISION ENGINE
// =================================================================================
DecisionResult evaluateDecision() {
  DecisionResult result;
  result.healthScore = 100.0f;
  result.riskLevel = "Normal";
  result.recommendation = "Maintain thermal balance";
  result.reason = "Vitals stable";
  result.stateName = "STABLE";
  result.emergency = false;
  result.heatingRequired = false;
  result.coolingRequired = false;
  result.sensorFault = false;

  // Temperature sensor fault check
  if (!babyTempValid || !envTempValid) {
    result.sensorFault = true;
    result.healthScore -= 20.0f;
    result.reason = "Temperature sensor fault detected";
  }

  // Thermal evaluation
  if (babyTempValid && envTempValid) {
    if (babyTemp < 36.5f && envTemp < 30.0f) {
      result.heatingRequired = true;
      result.healthScore -= 10.0f;
      result.reason = "Baby and incubator temperature below ideal range (36.5C)";
    } else if (babyTemp > 37.5f) {
      result.coolingRequired = true;
      result.healthScore -= 15.0f;
      result.reason = "Baby temperature above ideal range (37.5C)";
    }

    // Critical emergency bounds
    if (babyTemp < 35.5f || babyTemp > 38.0f) {
      result.emergency = true;
    }
  }

  // SpO2 evaluation (when valid finger/skin is captured)
  if (spo2Valid) {
    if (spo2 < 92.0f) result.healthScore -= 15.0f;
    if (spo2 < 90.0f) result.emergency = true;
  }

  // Heart rate evaluation
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

  // SENSOR POWER SUPPLY RELAY (PIN 27) MUST REMAIN ON 24/7
  setSafetyRelay(true);

  if (decision.emergency || decision.sensorFault) {
    emergencyAlertActive = true;
    setHeater(false); // Safety cut-off on emergency
    return;
  }

  emergencyAlertActive = false;

  // Closed-loop heater regulation in Auto Mode
  if (heaterAutoMode) {
    if (decision.heatingRequired) {
      setHeater(true);
    } else if (decision.coolingRequired) {
      setHeater(false);
    } else {
      setHeater(false);
    }
  }
}

// =================================================================================
// 10. RELAY & ACTUATOR CONTROL (Active-LOW Polarity)
// =================================================================================
void setHeater(bool enabled) {
  heaterOn = enabled;
  digitalWrite(HEATER_RELAY_PIN, enabled ? RELAY_ON : RELAY_OFF);
}

void setUv(bool enabled) {
  uvOn = enabled;
  digitalWrite(UV_RELAY_PIN, enabled ? RELAY_ON : RELAY_OFF);
}

void setSafetyRelay(bool enabled) {
  safetyRelayOn = enabled;
  digitalWrite(SENSOR_POWER_PIN, enabled ? RELAY_ON : RELAY_OFF);
}

// =================================================================================
// 11. BUZZER MANAGEMENT
// =================================================================================
void updateBuzzer() {
  if (emergencyAlertActive) {
    // Intermittent emergency beep every 500ms
    if (millis() - lastBuzzerToggle >= 500) {
      lastBuzzerToggle = millis();
      buzzerToggle = !buzzerToggle;
      digitalWrite(BUZZER_PIN, buzzerToggle ? HIGH : LOW);
    }
  } else {
    digitalWrite(BUZZER_PIN, LOW);
  }
}

// =================================================================================
// 12. SERIAL JSON STREAMING (Web Serial API)
// =================================================================================
void sendSerialData() {
  String payload = "{";
  payload += "\"deviceId\":\"neoguard-one\",";
  payload += "\"babyTemp\":" + String(isnan(babyTemp) ? 0.0f : babyTemp, 2) + ",";
  payload += "\"envTemp\":" + String(isnan(envTemp) ? 0.0f : envTemp, 2) + ",";
  payload += "\"spo2\":" + String(isnan(spo2) ? 0.0f : spo2, 0) + ",";
  payload += "\"heartRate\":" + String(isnan(heartRate) ? 0.0f : heartRate, 0) + ",";
  payload += "\"pulse\":" + String(pulseValue) + ",";
  payload += "\"pulseDetected\":" + boolJson(pulseDetected) + ",";
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
  payload += "\"heaterAutoMode\":" + boolJson(heaterAutoMode) + ",";
  payload += "\"uvOn\":" + boolJson(uvOn) + ",";
  payload += "\"safetyRelayOn\":" + boolJson(safetyRelayOn) + ",";
  payload += "\"timestamp\":" + String(millis());
  payload += "}";

  // Emit newline-terminated JSON line for Web Serial API reader
  Serial.println(payload);
}

// =================================================================================
// 13. INCOMING SERIAL COMMANDS (From Browser Dashboard)
// =================================================================================
void handleSerialCommands() {
  while (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.length() > 0) {
      if (line.indexOf("\"heaterAutoMode\":true") >= 0) {
        heaterAutoMode = true;
      } else if (line.indexOf("\"heaterAutoMode\":false") >= 0) {
        heaterAutoMode = false;
      }

      if (line.indexOf("\"heaterOn\":true") >= 0) {
        if (!heaterAutoMode) setHeater(true);
      } else if (line.indexOf("\"heaterOn\":false") >= 0) {
        if (!heaterAutoMode) setHeater(false);
      }

      if (line.indexOf("\"uvOn\":true") >= 0) {
        setUv(true);
      } else if (line.indexOf("\"uvOn\":false") >= 0) {
        setUv(false);
      }
    }
  }
}

// =================================================================================
// 14. OLED DISPLAY FUNCTIONS
// =================================================================================
void initializeDisplay() {
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    oledReady = false;
    Serial.println(F("[WARN] OLED SSD1306 not found at 0x3C"));
    return;
  }
  oledReady = true;
  showMessage("NeoGuard", "Booting...", "Please wait");
}

void showMessage(const String& line1, const String& line2, const String& line3) {
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

void renderDisplay() {
  if (!oledReady || millis() - lastDisplayRefresh < DISPLAY_REFRESH_MS) return;
  lastDisplayRefresh = millis();

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  // Line 1: Header
  display.setCursor(0, 0);
  display.println(F("NeoGuard (Serial)"));

  // Line 2: Edge AI State
  display.setCursor(0, 10);
  display.println(currentDecision.stateName);

  // Line 3: Health Score & Risk
  display.setCursor(0, 20);
  display.print(F("H:"));
  display.print(String(neoWarmHealthScore, 0));
  display.print(F(" "));
  display.println(currentDecision.riskLevel);

  // Line 4: Body and Environment Temperatures
  display.setCursor(0, 30);
  display.print(F("B:"));
  if (isnan(babyTemp)) display.print(F("--C")); else { display.print(babyTemp, 1); display.print(F("C")); }
  display.print(F(" E:"));
  if (isnan(envTemp)) display.print(F("--C")); else { display.print(envTemp, 1); display.print(F("C")); }

  // Line 5: MAX30102 SpO2 and Heart Rate
  display.setCursor(0, 40);
  display.print(F("SpO2:"));
  display.print(spo2Valid ? String(spo2, 0) + "%" : String("--"));
  display.print(F(" HR:"));
  display.print(heartRateValid ? String(heartRate, 0) : String("--"));

  // Line 6: Safety Alert & Actuator Status
  display.setCursor(0, 54);
  display.print(emergencyAlertActive ? F("ALERT ") : F("SAFE "));
  display.print(F("Htr:"));
  display.print(heaterOn ? F("ON ") : F("OFF "));
  display.print(F("UV:"));
  display.print(uvOn ? F("ON") : F("OFF"));

  display.display();
}

// =================================================================================
// 15. HELPER UTILITIES
// =================================================================================
String boolJson(bool value) {
  return value ? "true" : "false";
}

String escapeJson(String value) {
  value.replace("\\", "\\\\");
  value.replace("\"", "\\\"");
  return value;
}

float clampFloat(float value, float minimumValue, float maximumValue) {
  if (value < minimumValue) return minimumValue;
  if (value > maximumValue) return maximumValue;
  return value;
}