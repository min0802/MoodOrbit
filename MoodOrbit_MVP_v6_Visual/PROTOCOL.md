# Mood Orbit BLE Protocol v5

## BLE service

- Device name: `MOOD_ORBIT_0001`
- Service: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- RX, Web → ESP32: `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
- TX, ESP32 → Web: `6e400003-b5a3-f393-e0a9-e50e24dcca9e`

각 메시지는 줄바꿈 `\n`으로 끝납니다. Notify 데이터는 여러 조각으로 나뉠 수 있으므로 웹앱은 줄바꿈까지 버퍼링한 뒤 한 줄씩 처리합니다.

## 감정 코드

| 감정 | 코드 | 색상 |
|---|---|---|
| 기쁨 | `JOY` | `#FF9F43` |
| 슬픔 | `SADNESS` | `#8A93A6` |
| 분노 | `ANGER` | `#FF3B30` |
| 놀람 | `SURPRISE` | `#FFD43B` |
| 평화 | `PEACE` | `#4D96FF` |
| 설렘 | `EXCITEMENT` | `#FF78B7` |
| 짜증 | `IRRITATION` | `#62C370` |

## Web → ESP32

- `STATUS`
- `PING`
- `EMOTION:JOY` 등 7개 감정 직접 점등
- `OFF`
- `BRIGHTNESS:40`
- `ROUTINE_ALERT`: 보라색 LED 알림 3회 점멸
- `LEARN:JOY` 등 NFC 등록 대기
- `LEARN:CANCEL`
- `TAG:CLEAR:JOY`
- `TAGS:RESET`

## ESP32 → Web

### 돔 감정 기록

```text
DOME_EVENT|event_id=<uuid>|emotion=PEACE|color=4D96FF|source=NFC|uid=04AABBCC|action=EMOTION_SET|nfc=OK|device_ms=12345
```

### 실제 NFC 돔 제거

```text
DOME_REMOVED|event_id=<uuid>|emotion=PEACE|color=4D96FF|source=NFC|uid=04AABBCC|action=EMOTION_CANCEL|nfc=OK|device_ms=15200
```

웹앱은 오늘의 감정 상태를 비우고 Supabase에 `action=CANCEL` 이벤트를 추가합니다.

### 루틴 알림

```text
ROUTINE_ALERT_STARTED|device_ms=20000
ALERT_STOPPED|device_ms=21800
```

### NFC 등록과 상태

```text
TAG_REGISTERED|event_id=<uuid>|emotion=JOY|uid=04AABBCC|device_ms=12345
TAG_STATUS|learn=NONE|nfc=OK|JOY=<uid>|SADNESS=<uid>|ANGER=<uid>|SURPRISE=<uid>|PEACE=<uid>|EXCITEMENT=<uid>|IRRITATION=<uid>
```

### 기타

```text
LED_STATUS|enabled=1|emotion=PEACE|color=4D96FF|brightness=40
UNKNOWN_TAG|event_id=<uuid>|uid=04AABBCC|nfc=OK|device_ms=12345
DEVICE_INFO|id=ORBIT_0001|firmware=5.0.0|leds=24|emotions=7
```
