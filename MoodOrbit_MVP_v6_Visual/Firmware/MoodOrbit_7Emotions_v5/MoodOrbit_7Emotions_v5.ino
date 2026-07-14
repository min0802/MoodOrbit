/*
  Mood Orbit 7 Emotions v5.0

  Hardware
  - ESP32-C3 SuperMini
  - WS2812B / NeoPixel 24 LED ring
  - PN532 V3 / VLT-RF008 in HSU (UART) mode
  - 74HCT125 level shifter between ESP32 and NeoPixel

  Architecture
  NFC tag -> PN532 -> ESP32-C3 -> NeoPixel color
                                -> BLE DOME_EVENT
                                -> Android Chrome web app
                                -> Supabase emotion_logs

  Important
  - ESP32 Wi-Fi is not used.
  - Host WebApp/index.html on HTTPS.
  - PN532 switch: Channel 1 OFF, Channel 2 OFF (HSU mode).
  - PN532 SDA/TXD -> ESP32 RX GPIO4.
  - PN532 SCL/RXD -> ESP32 TX GPIO5.
  - NeoPixel data -> GPIO3 through 74HCT125 and 330 ohm resistor.
*/

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include <Preferences.h>
#include <esp_system.h>
#include "Pn532HsuReader.h"
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// -----------------------------------------------------------------------------
// Hardware
// -----------------------------------------------------------------------------
constexpr uint8_t NEOPIXEL_PIN = 3;
constexpr uint16_t LED_COUNT = 24;
constexpr uint8_t DEFAULT_BRIGHTNESS = 40;
constexpr int8_t PN532_RX_PIN = 4;
constexpr int8_t PN532_TX_PIN = 5;

constexpr unsigned long TAG_REMOVAL_MS = 300;
constexpr unsigned long BLE_HELLO_DELAY_MS = 700;
constexpr size_t BLE_CHUNK_SIZE = 18;
constexpr uint8_t PENDING_EVENT_CAPACITY = 24;

// -----------------------------------------------------------------------------
// BLE Nordic UART style service
// -----------------------------------------------------------------------------
#define SERVICE_UUID           "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_RX "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_TX "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

const char* BLE_DEVICE_NAME = "MOOD_ORBIT_0001";
const char* DEVICE_ID = "ORBIT_0001";
const char* FIRMWARE_VERSION = "5.0.0";

// -----------------------------------------------------------------------------
// Seven fixed emotions
// Preference keys must remain short because ESP32 NVS keys are limited.
// -----------------------------------------------------------------------------
struct EmotionDefinition {
  const char* code;
  const char* colorHex;
  const char* preferenceKey;
};

constexpr uint8_t EMOTION_COUNT = 7;
const EmotionDefinition EMOTIONS[EMOTION_COUNT] = {
  {"JOY",        "FF9F43", "uid_joy"}, // 기쁨 · 주황색
  {"SADNESS",    "8A93A6", "uid_sad"}, // 슬픔 · 회색
  {"ANGER",      "FF3B30", "uid_ang"}, // 분노 · 빨간색
  {"SURPRISE",   "FFD43B", "uid_sur"}, // 놀람 · 노란색
  {"PEACE",      "4D96FF", "uid_pea"}, // 평화 · 파란색
  {"EXCITEMENT", "FF78B7", "uid_exc"}, // 설렘 · 분홍색
  {"IRRITATION", "62C370", "uid_irr"}  // 짜증 · 초록색
};

// -----------------------------------------------------------------------------
// Devices and state
// -----------------------------------------------------------------------------
Adafruit_NeoPixel strip(LED_COUNT, NEOPIXEL_PIN, NEO_GRB + NEO_KHZ800);
Pn532HsuReader nfc(Serial1, PN532_RX_PIN, PN532_TX_PIN);
Preferences preferences;

BLEServer* bleServer = nullptr;
BLECharacteristic* txCharacteristic = nullptr;
volatile bool deviceConnected = false;
bool previousDeviceConnected = false;
bool pendingBleHello = false;
unsigned long bleConnectedAt = 0;

bool nfcReady = false;
String emotionTagUids[EMOTION_COUNT];
int8_t learningEmotionIndex = -1;
int8_t currentEmotionIndex = -1;
bool ledOutputEnabled = false;
uint8_t currentBrightness = DEFAULT_BRIGHTNESS;

bool tagPresent = false;
bool activeTagCreatedEmotionEvent = false;
String uidInField;
unsigned long lastTagSeenAt = 0;

String pendingEvents[PENDING_EVENT_CAPACITY];
uint8_t pendingEventStart = 0;
uint8_t pendingEventCount = 0;

// -----------------------------------------------------------------------------
// Forward declarations
// -----------------------------------------------------------------------------
void initializeNeoPixel();
void initializeNfc();
void startBleServer();
void readNfcTag();
void handleNfcUid(const String& uid);
void handleBleCommand(String command);

int8_t emotionIndexFromCode(String code);
int8_t emotionIndexFromUid(const String& uid);
String learningEmotionCode();
String uidToString(const uint8_t* uid, uint8_t uidLength);
void saveEmotionTag(uint8_t index, const String& uid);
void clearEmotionTag(uint8_t index);
void clearAllEmotionTags();

void applyEmotion(uint8_t index, const String& source, const String& uid, bool emitEvent);
void turnOffAllLeds();
void flashUnknownTag();
void runRoutineAlert();
void emitDomeRemoved(uint8_t index, const String& uid);
void renderEmotion(uint8_t index);

void sendBleLine(const String& line);
void emitDeviceEvent(const String& line);
void queueDeviceEvent(const String& line);
void flushPendingDeviceEvents();
void sendDeviceInfo();
void sendTagStatus();
void sendLedStatus();

String createEventUuid();
String attachEventId(const String& line);
String safeProtocolValue(String value);
bool isValidBrightness(int value);
uint32_t hexToNeoPixelColor(const String& value);

// -----------------------------------------------------------------------------
// Utility
// -----------------------------------------------------------------------------
String safeProtocolValue(String value) {
  value.replace("|", "_");
  value.replace("=", "_");
  value.replace("\n", "_");
  value.replace("\r", "_");
  return value;
}

String createEventUuid() {
  uint8_t bytes[16];
  for (uint8_t i = 0; i < sizeof(bytes); i += 4) {
    const uint32_t value = esp_random();
    bytes[i] = (value >> 24) & 0xFF;
    bytes[i + 1] = (value >> 16) & 0xFF;
    bytes[i + 2] = (value >> 8) & 0xFF;
    bytes[i + 3] = value & 0xFF;
  }

  bytes[6] = (bytes[6] & 0x0F) | 0x40;
  bytes[8] = (bytes[8] & 0x3F) | 0x80;

  char uuid[37];
  snprintf(
    uuid,
    sizeof(uuid),
    "%02X%02X%02X%02X-%02X%02X-%02X%02X-%02X%02X-%02X%02X%02X%02X%02X%02X",
    bytes[0], bytes[1], bytes[2], bytes[3],
    bytes[4], bytes[5],
    bytes[6], bytes[7],
    bytes[8], bytes[9],
    bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
  );
  return String(uuid);
}

String attachEventId(const String& line) {
  if (line.indexOf("|event_id=") >= 0) {
    return line;
  }

  const int separator = line.indexOf('|');
  if (separator < 0) {
    return line + "|event_id=" + createEventUuid();
  }

  return line.substring(0, separator) +
         "|event_id=" + createEventUuid() +
         line.substring(separator);
}

int8_t emotionIndexFromCode(String code) {
  code.trim();
  code.toUpperCase();

  for (uint8_t i = 0; i < EMOTION_COUNT; i++) {
    if (code == EMOTIONS[i].code) {
      return static_cast<int8_t>(i);
    }
  }
  return -1;
}

int8_t emotionIndexFromUid(const String& uid) {
  for (uint8_t i = 0; i < EMOTION_COUNT; i++) {
    if (emotionTagUids[i].length() > 0 && emotionTagUids[i] == uid) {
      return static_cast<int8_t>(i);
    }
  }
  return -1;
}

String learningEmotionCode() {
  if (learningEmotionIndex < 0 || learningEmotionIndex >= EMOTION_COUNT) {
    return "NONE";
  }
  return String(EMOTIONS[learningEmotionIndex].code);
}

bool isValidBrightness(int value) {
  return value >= 0 && value <= 255;
}

uint32_t hexToNeoPixelColor(const String& value) {
  const unsigned long number = strtoul(value.c_str(), nullptr, 16);
  const uint8_t red = (number >> 16) & 0xFF;
  const uint8_t green = (number >> 8) & 0xFF;
  const uint8_t blue = number & 0xFF;
  return strip.Color(red, green, blue);
}

// -----------------------------------------------------------------------------
// NeoPixel
// -----------------------------------------------------------------------------
void initializeNeoPixel() {
  strip.begin();
  strip.setBrightness(currentBrightness);
  strip.clear();
  strip.show();
}

void renderEmotion(uint8_t index) {
  if (index >= EMOTION_COUNT) {
    return;
  }

  strip.fill(hexToNeoPixelColor(EMOTIONS[index].colorHex));
  strip.show();
}

void applyEmotion(uint8_t index, const String& source, const String& uid, bool emitEvent) {
  if (index >= EMOTION_COUNT) {
    return;
  }

  currentEmotionIndex = static_cast<int8_t>(index);
  ledOutputEnabled = true;
  renderEmotion(index);

  if (emitEvent) {
    String line = "DOME_EVENT";
    line += "|emotion=" + String(EMOTIONS[index].code);
    line += "|color=" + String(EMOTIONS[index].colorHex);
    line += "|source=" + safeProtocolValue(source);
    line += "|uid=" + safeProtocolValue(uid.length() ? uid : "NONE");
    line += "|action=EMOTION_SET";
    line += "|nfc=" + String(nfcReady ? "OK" : "ERROR");
    line += "|device_ms=" + String(millis());
    emitDeviceEvent(line);
  }

  sendLedStatus();
}

void turnOffAllLeds() {
  ledOutputEnabled = false;
  currentEmotionIndex = -1;
  strip.clear();
  strip.show();
  sendLedStatus();
}

void flashUnknownTag() {
  const bool wasEnabled = ledOutputEnabled;
  const int8_t savedEmotion = currentEmotionIndex;
  const uint32_t purple = strip.Color(89, 44, 130);

  for (uint8_t repeat = 0; repeat < 2; repeat++) {
    strip.fill(purple);
    strip.show();
    delay(120);
    strip.clear();
    strip.show();
    delay(90);
  }

  if (wasEnabled && savedEmotion >= 0) {
    renderEmotion(static_cast<uint8_t>(savedEmotion));
  }
}


void runRoutineAlert() {
  const bool wasEnabled = ledOutputEnabled;
  const int8_t savedEmotion = currentEmotionIndex;
  const uint32_t alertColor = strip.Color(139, 124, 246);

  sendBleLine("ROUTINE_ALERT_STARTED|device_ms=" + String(millis()));

  for (uint8_t repeat = 0; repeat < 3; repeat++) {
    strip.fill(alertColor);
    strip.show();
    delay(180);
    strip.clear();
    strip.show();
    delay(150);
  }

  if (wasEnabled && savedEmotion >= 0) {
    currentEmotionIndex = savedEmotion;
    ledOutputEnabled = true;
    renderEmotion(static_cast<uint8_t>(savedEmotion));
  } else {
    currentEmotionIndex = -1;
    ledOutputEnabled = false;
    strip.clear();
    strip.show();
  }

  sendBleLine("ALERT_STOPPED|device_ms=" + String(millis()));
  sendLedStatus();
}

void emitDomeRemoved(uint8_t index, const String& uid) {
  if (index >= EMOTION_COUNT) {
    return;
  }

  String line = "DOME_REMOVED";
  line += "|emotion=" + String(EMOTIONS[index].code);
  line += "|color=" + String(EMOTIONS[index].colorHex);
  line += "|source=NFC";
  line += "|uid=" + safeProtocolValue(uid);
  line += "|action=EMOTION_CANCEL";
  line += "|nfc=" + String(nfcReady ? "OK" : "ERROR");
  line += "|device_ms=" + String(millis());
  emitDeviceEvent(line);
}

// -----------------------------------------------------------------------------
// BLE transport
// -----------------------------------------------------------------------------
void sendBleLine(const String& line) {
  Serial.print("BLE TX: ");
  Serial.println(line);

  if (!deviceConnected || txCharacteristic == nullptr) {
    return;
  }

  const String framed = line + "\n";
  for (size_t offset = 0; offset < framed.length(); offset += BLE_CHUNK_SIZE) {
    size_t end = offset + BLE_CHUNK_SIZE;
    if (end > framed.length()) {
      end = framed.length();
    }

    const String chunk = framed.substring(offset, end);
    txCharacteristic->setValue(chunk.c_str());
    txCharacteristic->notify();
    delay(14);
  }
}

void queueDeviceEvent(const String& line) {
  if (pendingEventCount < PENDING_EVENT_CAPACITY) {
    const uint8_t index = (pendingEventStart + pendingEventCount) % PENDING_EVENT_CAPACITY;
    pendingEvents[index] = line;
    pendingEventCount++;
    return;
  }

  pendingEvents[pendingEventStart] = line;
  pendingEventStart = (pendingEventStart + 1) % PENDING_EVENT_CAPACITY;
}

void emitDeviceEvent(const String& line) {
  const String identified = attachEventId(line);

  Serial.print("DEVICE EVENT: ");
  Serial.println(identified);

  if (deviceConnected) {
    sendBleLine(identified);
  } else {
    queueDeviceEvent(identified);
  }
}

void flushPendingDeviceEvents() {
  while (deviceConnected && pendingEventCount > 0) {
    const String line = pendingEvents[pendingEventStart];
    pendingEvents[pendingEventStart] = "";
    pendingEventStart = (pendingEventStart + 1) % PENDING_EVENT_CAPACITY;
    pendingEventCount--;
    sendBleLine(line);
  }
}

void sendDeviceInfo() {
  String line = "DEVICE_INFO";
  line += "|id=" + safeProtocolValue(DEVICE_ID);
  line += "|fw=" + safeProtocolValue(FIRMWARE_VERSION);
  line += "|leds=" + String(LED_COUNT);
  line += "|emotions=" + String(EMOTION_COUNT);
  line += "|nfc=" + String(nfcReady ? "OK" : "ERROR");
  sendBleLine(line);
}

void sendTagStatus() {
  String line = "TAG_STATUS";
  line += "|learn=" + learningEmotionCode();
  line += "|nfc=" + String(nfcReady ? "OK" : "ERROR");

  for (uint8_t i = 0; i < EMOTION_COUNT; i++) {
    line += "|" + String(EMOTIONS[i].code) + "=";
    line += safeProtocolValue(emotionTagUids[i].length() ? emotionTagUids[i] : "NONE");
  }

  sendBleLine(line);
}

void sendLedStatus() {
  String line = "LED_STATUS";
  line += "|enabled=" + String(ledOutputEnabled ? "1" : "0");
  line += "|emotion=";
  line += currentEmotionIndex >= 0 ? String(EMOTIONS[currentEmotionIndex].code) : "NONE";
  line += "|color=";
  line += currentEmotionIndex >= 0 ? String(EMOTIONS[currentEmotionIndex].colorHex) : "000000";
  line += "|brightness=" + String(currentBrightness);
  sendBleLine(line);
}

// -----------------------------------------------------------------------------
// PN532 HSU
// -----------------------------------------------------------------------------
void initializeNfc() {
  Serial.println();
  Serial.println("Starting PN532 in HSU mode...");

  Serial1.setRxBufferSize(256);
  nfc.begin();
  delay(120);

  uint32_t versionData = 0;
  if (!nfc.getFirmwareVersion(versionData)) {
    nfcReady = false;
    Serial.println("PN532 not found.");
    Serial.println("Check switch OFF/OFF, crossed TX/RX, 3.3V and GND.");
    return;
  }

  if (!nfc.samConfig()) {
    nfcReady = false;
    Serial.println("PN532 SAM configuration failed.");
    return;
  }

  nfc.setPassiveActivationRetries(0x00);
  nfcReady = true;

  Serial.print("PN532 chip: 0x");
  Serial.println((versionData >> 24) & 0xFF, HEX);
  Serial.print("PN532 firmware: ");
  Serial.print((versionData >> 16) & 0xFF, DEC);
  Serial.print(".");
  Serial.println((versionData >> 8) & 0xFF, DEC);
  Serial.println("PN532 ready.");
}

String uidToString(const uint8_t* uid, uint8_t uidLength) {
  String value;
  value.reserve(uidLength * 2);

  for (uint8_t i = 0; i < uidLength; i++) {
    if (uid[i] < 0x10) {
      value += "0";
    }
    value += String(uid[i], HEX);
  }

  value.toUpperCase();
  return value;
}

void saveEmotionTag(uint8_t index, const String& uid) {
  if (index >= EMOTION_COUNT) {
    return;
  }

  // One physical tag belongs to one emotion only.
  for (uint8_t i = 0; i < EMOTION_COUNT; i++) {
    if (i != index && emotionTagUids[i] == uid) {
      clearEmotionTag(i);
    }
  }

  emotionTagUids[index] = uid;
  preferences.putString(EMOTIONS[index].preferenceKey, uid);
}

void clearEmotionTag(uint8_t index) {
  if (index >= EMOTION_COUNT) {
    return;
  }

  emotionTagUids[index] = "";
  preferences.remove(EMOTIONS[index].preferenceKey);
}

void clearAllEmotionTags() {
  for (uint8_t i = 0; i < EMOTION_COUNT; i++) {
    clearEmotionTag(i);
  }
  learningEmotionIndex = -1;
  sendTagStatus();
}

void handleNfcUid(const String& uid) {
  if (learningEmotionIndex >= 0) {
    const uint8_t index = static_cast<uint8_t>(learningEmotionIndex);
    saveEmotionTag(index, uid);
    learningEmotionIndex = -1;
    activeTagCreatedEmotionEvent = false;
    applyEmotion(index, "REGISTER", uid, false);

    emitDeviceEvent(
      "TAG_REGISTERED|emotion=" + String(EMOTIONS[index].code) +
      "|uid=" + uid +
      "|device_ms=" + String(millis())
    );
    sendTagStatus();
    return;
  }

  const int8_t emotionIndex = emotionIndexFromUid(uid);
  if (emotionIndex >= 0) {
    activeTagCreatedEmotionEvent = true;
    applyEmotion(static_cast<uint8_t>(emotionIndex), "NFC", uid, true);
    return;
  }

  activeTagCreatedEmotionEvent = false;
  flashUnknownTag();
  emitDeviceEvent(
    "UNKNOWN_TAG|uid=" + uid +
    "|nfc=" + String(nfcReady ? "OK" : "ERROR") +
    "|device_ms=" + String(millis())
  );
}

void readNfcTag() {
  if (!nfcReady) {
    return;
  }

  uint8_t uid[7] = {0};
  uint8_t uidLength = 0;
  const bool detected = nfc.readPassiveTargetId(uid, uidLength, 180);
  const unsigned long now = millis();

  if (!detected) {
    if (tagPresent && now - lastTagSeenAt >= TAG_REMOVAL_MS) {
      const String removedUid = uidInField;
      const int8_t removedEmotionIndex = emotionIndexFromUid(removedUid);

      tagPresent = false;
      uidInField = "";

      if (removedEmotionIndex >= 0 && currentEmotionIndex == removedEmotionIndex) {
        turnOffAllLeds();
        if (activeTagCreatedEmotionEvent) {
          emitDomeRemoved(static_cast<uint8_t>(removedEmotionIndex), removedUid);
        }
      }
      activeTagCreatedEmotionEvent = false;
    }
    return;
  }

  const String uidValue = uidToString(uid, uidLength);
  lastTagSeenAt = now;

  if (tagPresent && uidValue == uidInField) {
    return;
  }

  tagPresent = true;
  uidInField = uidValue;

  Serial.print("NFC UID: ");
  Serial.println(uidValue);
  handleNfcUid(uidValue);
}

// -----------------------------------------------------------------------------
// BLE commands
// -----------------------------------------------------------------------------
void handleBleCommand(String command) {
  command.trim();
  if (command.length() == 0) {
    sendBleLine("ERR|code=EMPTY_COMMAND");
    return;
  }

  Serial.print("BLE RX: ");
  Serial.println(command);

  String normalized = command;
  normalized.toUpperCase();

  if (normalized == "PING") {
    sendBleLine("ACK|command=PING|value=PONG");
    return;
  }

  if (normalized == "STATUS") {
    sendBleLine("ACK|command=STATUS");
    sendDeviceInfo();
    sendTagStatus();
    sendLedStatus();
    return;
  }

  if (normalized == "OFF") {
    turnOffAllLeds();
    sendBleLine("ACK|command=OFF");
    return;
  }

  if (normalized == "ROUTINE_ALERT") {
    sendBleLine("ACK|command=ROUTINE_ALERT");
    runRoutineAlert();
    return;
  }

  if (normalized == "TAGS:RESET") {
    clearAllEmotionTags();
    sendBleLine("ACK|command=TAGS_RESET");
    return;
  }

  if (normalized == "LEARN:CANCEL") {
    learningEmotionIndex = -1;
    sendBleLine("ACK|command=LEARN_CANCEL");
    sendTagStatus();
    return;
  }

  if (normalized.startsWith("LEARN:")) {
    const String code = normalized.substring(6);
    const int8_t index = emotionIndexFromCode(code);
    if (index < 0) {
      sendBleLine("ERR|code=INVALID_EMOTION");
      return;
    }

    learningEmotionIndex = index;
    sendBleLine("ACK|command=LEARN|emotion=" + String(EMOTIONS[index].code));
    sendTagStatus();
    return;
  }

  if (normalized.startsWith("TAG:CLEAR:")) {
    const String code = normalized.substring(10);
    const int8_t index = emotionIndexFromCode(code);
    if (index < 0) {
      sendBleLine("ERR|code=INVALID_EMOTION");
      return;
    }

    clearEmotionTag(static_cast<uint8_t>(index));
    sendBleLine("ACK|command=TAG_CLEAR|emotion=" + String(EMOTIONS[index].code));
    sendTagStatus();
    return;
  }

  if (normalized.startsWith("EMOTION:")) {
    const String code = normalized.substring(8);
    const int8_t index = emotionIndexFromCode(code);
    if (index < 0) {
      sendBleLine("ERR|code=INVALID_EMOTION");
      return;
    }

    applyEmotion(static_cast<uint8_t>(index), "WEB", "NONE", true);
    sendBleLine("ACK|command=EMOTION|emotion=" + String(EMOTIONS[index].code));
    return;
  }

  if (normalized.startsWith("BRIGHTNESS:")) {
    const int value = normalized.substring(11).toInt();
    if (!isValidBrightness(value)) {
      sendBleLine("ERR|code=INVALID_BRIGHTNESS");
      return;
    }

    currentBrightness = static_cast<uint8_t>(value);
    strip.setBrightness(currentBrightness);
    if (ledOutputEnabled && currentEmotionIndex >= 0) {
      renderEmotion(static_cast<uint8_t>(currentEmotionIndex));
    }
    sendBleLine("ACK|command=BRIGHTNESS|value=" + String(currentBrightness));
    sendLedStatus();
    return;
  }

  sendBleLine("ERR|code=UNKNOWN_COMMAND");
}

class OrbitServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* server) override {
    deviceConnected = true;
    pendingBleHello = true;
    bleConnectedAt = millis();
    Serial.println("BLE client connected.");
  }

  void onDisconnect(BLEServer* server) override {
    deviceConnected = false;
    pendingBleHello = false;
    Serial.println("BLE client disconnected.");
  }
};

class OrbitCommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    String command = characteristic->getValue();
    handleBleCommand(command);
  }
};

void startBleServer() {
  BLEDevice::init(BLE_DEVICE_NAME);

  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new OrbitServerCallbacks());

  BLEService* service = bleServer->createService(SERVICE_UUID);

  txCharacteristic = service->createCharacteristic(
    CHARACTERISTIC_UUID_TX,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  txCharacteristic->addDescriptor(new BLE2902());
  txCharacteristic->setValue("READY\n");

  BLECharacteristic* rxCharacteristic = service->createCharacteristic(
    CHARACTERISTIC_UUID_RX,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  rxCharacteristic->setCallbacks(new OrbitCommandCallbacks());

  service->start();

  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->setMaxPreferred(0x12);
  advertising->start();

  Serial.println("BLE advertising started.");
  Serial.print("BLE device name: ");
  Serial.println(BLE_DEVICE_NAME);
}

// -----------------------------------------------------------------------------
// Arduino lifecycle
// -----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(700);

  Serial.println();
  Serial.println("============================================");
  Serial.println("Mood Orbit 7 Emotions v5.0");
  Serial.println("ESP32-C3 + PN532 HSU + BLE + 24 NeoPixel");
  Serial.println("============================================");

  initializeNeoPixel();

  preferences.begin("moodorbit", false);
  for (uint8_t i = 0; i < EMOTION_COUNT; i++) {
    emotionTagUids[i] = preferences.getString(EMOTIONS[i].preferenceKey, "");
  }

  initializeNfc();
  startBleServer();

  Serial.println("Saved emotion tags:");
  for (uint8_t i = 0; i < EMOTION_COUNT; i++) {
    Serial.print("  ");
    Serial.print(EMOTIONS[i].code);
    Serial.print(": ");
    Serial.println(emotionTagUids[i].length() ? emotionTagUids[i] : "NONE");
  }

  Serial.println("Use the web app to register each emotion NFC tag.");
}

void loop() {
  readNfcTag();

  if (!deviceConnected && previousDeviceConnected) {
    delay(350);
    bleServer->startAdvertising();
    Serial.println("BLE advertising restarted.");
    previousDeviceConnected = false;
  }

  if (deviceConnected && !previousDeviceConnected) {
    previousDeviceConnected = true;
  }

  if (deviceConnected && pendingBleHello &&
      millis() - bleConnectedAt >= BLE_HELLO_DELAY_MS) {
    pendingBleHello = false;
    sendDeviceInfo();
    sendTagStatus();
    sendLedStatus();
    flushPendingDeviceEvents();
  }

  delay(8);
}
