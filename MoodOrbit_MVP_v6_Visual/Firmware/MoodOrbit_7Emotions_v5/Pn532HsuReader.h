#pragma once

#include <Arduino.h>

// Minimal PN532 HSU (UART) reader used by the Mood Orbit prototype.
// It implements only the commands required for firmware detection,
// SAM configuration, passive retry configuration and ISO14443A UID reading.
// No external PN532 library is required.
class Pn532HsuReader {
public:
  Pn532HsuReader(HardwareSerial& serial, int8_t rxPin, int8_t txPin)
    : serial_(serial), rxPin_(rxPin), txPin_(txPin) {}

  void begin() {
    serial_.begin(115200, SERIAL_8N1, rxPin_, txPin_);
    delay(80);
    wakeup();
    clearInput();
  }

  bool getFirmwareVersion(uint32_t& version) {
    uint8_t response[8] = {0};
    size_t responseLength = 0;

    if (!transceive(
          COMMAND_GET_FIRMWARE_VERSION,
          nullptr,
          0,
          response,
          sizeof(response),
          responseLength,
          1000)) {
      return false;
    }

    if (responseLength < 4) {
      return false;
    }

    version = (static_cast<uint32_t>(response[0]) << 24) |
              (static_cast<uint32_t>(response[1]) << 16) |
              (static_cast<uint32_t>(response[2]) << 8) |
              static_cast<uint32_t>(response[3]);
    return true;
  }

  bool samConfig() {
    const uint8_t params[] = {
      0x01,  // Normal mode
      0x14,  // Timeout: 50 ms x 20
      0x01   // Use IRQ internally
    };

    uint8_t response[4] = {0};
    size_t responseLength = 0;
    return transceive(
      COMMAND_SAM_CONFIGURATION,
      params,
      sizeof(params),
      response,
      sizeof(response),
      responseLength,
      1000
    );
  }

  bool setPassiveActivationRetries(uint8_t maxRetries) {
    const uint8_t params[] = {
      0x05,       // RFConfiguration item: MaxRetries
      0xFF,       // MxRtyATR
      0x01,       // MxRtyPSL
      maxRetries  // MxRtyPassiveActivation
    };

    uint8_t response[4] = {0};
    size_t responseLength = 0;
    return transceive(
      COMMAND_RF_CONFIGURATION,
      params,
      sizeof(params),
      response,
      sizeof(response),
      responseLength,
      1000
    );
  }

  bool readPassiveTargetId(
    uint8_t* uid,
    uint8_t& uidLength,
    uint16_t timeoutMs = 180
  ) {
    uidLength = 0;

    // One ISO14443A target at 106 kbps.
    const uint8_t params[] = {0x01, 0x00};
    uint8_t response[32] = {0};
    size_t responseLength = 0;

    if (!transceive(
          COMMAND_IN_LIST_PASSIVE_TARGET,
          params,
          sizeof(params),
          response,
          sizeof(response),
          responseLength,
          timeoutMs)) {
      return false;
    }

    // Payload:
    // [0] NbTg, [1] Tg, [2..3] SENS_RES, [4] SEL_RES,
    // [5] NFCID length, [6...] NFCID bytes.
    if (responseLength < 6 || response[0] < 1) {
      return false;
    }

    const uint8_t length = response[5];
    if (length == 0 || length > 7 || responseLength < static_cast<size_t>(6 + length)) {
      return false;
    }

    memcpy(uid, response + 6, length);
    uidLength = length;
    return true;
  }

private:
  static constexpr uint8_t HOST_TO_PN532 = 0xD4;
  static constexpr uint8_t PN532_TO_HOST = 0xD5;

  static constexpr uint8_t COMMAND_GET_FIRMWARE_VERSION = 0x02;
  static constexpr uint8_t COMMAND_SAM_CONFIGURATION = 0x14;
  static constexpr uint8_t COMMAND_RF_CONFIGURATION = 0x32;
  static constexpr uint8_t COMMAND_IN_LIST_PASSIVE_TARGET = 0x4A;

  HardwareSerial& serial_;
  int8_t rxPin_;
  int8_t txPin_;

  void clearInput() {
    while (serial_.available() > 0) {
      serial_.read();
    }
  }

  void wakeup() {
    const uint8_t wakeBytes[] = {0x55, 0x55, 0x00, 0x00, 0x00};
    serial_.write(wakeBytes, sizeof(wakeBytes));
    serial_.flush();
    delay(8);
  }

  bool readByte(uint8_t& value, uint32_t deadline) {
    while (static_cast<int32_t>(deadline - millis()) > 0) {
      const int incoming = serial_.read();
      if (incoming >= 0) {
        value = static_cast<uint8_t>(incoming);
        return true;
      }
      delay(1);
    }
    return false;
  }

  bool findPreamble(uint32_t deadline) {
    uint8_t state = 0;
    uint8_t value = 0;

    while (static_cast<int32_t>(deadline - millis()) > 0) {
      if (!readByte(value, deadline)) {
        return false;
      }

      if (state == 0) {
        state = (value == 0x00) ? 1 : 0;
      } else if (state == 1) {
        state = (value == 0x00) ? 2 : 0;
      } else {
        if (value == 0xFF) {
          return true;
        }
        state = (value == 0x00) ? 2 : 0;
      }
    }
    return false;
  }

  bool writeCommand(uint8_t command, const uint8_t* params, size_t paramsLength) {
    if (paramsLength > 250) {
      return false;
    }

    // Drop a late response from an earlier timed-out polling command.
    clearInput();

    const uint8_t frameLength = static_cast<uint8_t>(paramsLength + 2); // TFI + CMD + params
    const uint8_t lengthChecksum = static_cast<uint8_t>(~frameLength + 1);

    uint8_t dataChecksumSum = HOST_TO_PN532 + command;
    for (size_t i = 0; i < paramsLength; i++) {
      dataChecksumSum = static_cast<uint8_t>(dataChecksumSum + params[i]);
    }
    const uint8_t dataChecksum = static_cast<uint8_t>(~dataChecksumSum + 1);

    const uint8_t header[] = {
      0x00, 0x00, 0xFF,
      frameLength,
      lengthChecksum,
      HOST_TO_PN532,
      command
    };

    serial_.write(header, sizeof(header));
    if (paramsLength > 0 && params != nullptr) {
      serial_.write(params, paramsLength);
    }
    serial_.write(dataChecksum);
    serial_.write(static_cast<uint8_t>(0x00));
    serial_.flush();
    return true;
  }

  bool readAck(uint16_t timeoutMs) {
    const uint32_t deadline = millis() + timeoutMs;
    if (!findPreamble(deadline)) {
      return false;
    }

    uint8_t length = 0;
    uint8_t lengthChecksum = 0;
    uint8_t postamble = 0;

    if (!readByte(length, deadline) ||
        !readByte(lengthChecksum, deadline) ||
        !readByte(postamble, deadline)) {
      return false;
    }

    return length == 0x00 && lengthChecksum == 0xFF && postamble == 0x00;
  }

  bool readResponse(
    uint8_t command,
    uint8_t* response,
    size_t responseCapacity,
    size_t& responseLength,
    uint16_t timeoutMs
  ) {
    responseLength = 0;
    const uint32_t deadline = millis() + timeoutMs;

    if (!findPreamble(deadline)) {
      return false;
    }

    uint8_t frameLength = 0;
    uint8_t lengthChecksum = 0;
    if (!readByte(frameLength, deadline) || !readByte(lengthChecksum, deadline)) {
      return false;
    }

    if (static_cast<uint8_t>(frameLength + lengthChecksum) != 0x00 || frameLength < 2) {
      return false;
    }

    uint8_t frameData[64] = {0};
    if (frameLength > sizeof(frameData)) {
      return false;
    }

    uint8_t checksumSum = 0;
    for (uint8_t i = 0; i < frameLength; i++) {
      if (!readByte(frameData[i], deadline)) {
        return false;
      }
      checksumSum = static_cast<uint8_t>(checksumSum + frameData[i]);
    }

    uint8_t dataChecksum = 0;
    uint8_t postamble = 0;
    if (!readByte(dataChecksum, deadline) || !readByte(postamble, deadline)) {
      return false;
    }

    if (static_cast<uint8_t>(checksumSum + dataChecksum) != 0x00 || postamble != 0x00) {
      return false;
    }

    if (frameData[0] != PN532_TO_HOST || frameData[1] != static_cast<uint8_t>(command + 1)) {
      return false;
    }

    const size_t payloadLength = frameLength - 2;
    if (payloadLength > responseCapacity) {
      return false;
    }

    if (payloadLength > 0) {
      memcpy(response, frameData + 2, payloadLength);
    }
    responseLength = payloadLength;
    return true;
  }

  bool transceive(
    uint8_t command,
    const uint8_t* params,
    size_t paramsLength,
    uint8_t* response,
    size_t responseCapacity,
    size_t& responseLength,
    uint16_t responseTimeoutMs
  ) {
    if (!writeCommand(command, params, paramsLength)) {
      return false;
    }

    if (!readAck(1000)) {
      return false;
    }

    return readResponse(
      command,
      response,
      responseCapacity,
      responseLength,
      responseTimeoutMs
    );
  }
};
