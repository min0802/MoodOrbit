# 무드오빗 정서·루틴 케어 MVP v5

`MVP_01.zip`의 화면과 기능을 기준으로, 실제 ESP32-C3·PN532·24LED 펌웨어 및 Supabase 구조와 맞도록 통합한 버전입니다.

## 1. 이번 업데이트에서 적용한 내용

### 감정 기록

- 7가지 기본감정 색상을 최종 기준으로 통일했습니다.
  - 기쁨 `#FF9F43` 주황색
  - 슬픔 `#8A93A6` 회색
  - 분노 `#FF3B30` 빨간색
  - 놀람 `#FFD43B` 노란색
  - 평화 `#4D96FF` 파란색
  - 설렘 `#FF78B7` 분홍색
  - 짜증 `#62C370` 초록색
- 돔 클릭과 드래그앤드롭을 모두 지원합니다.
- 돔을 올리면 확인 멜로디, 피규어 글로우, 오늘의 감정 기록이 함께 적용됩니다.
- 올려진 돔을 클릭하면 오늘의 감정이 취소되고 조명이 꺼집니다.
- 실제 NFC 돔을 PN532에서 제거하면 펌웨어가 `DOME_REMOVED`를 전송하여 웹 기록도 취소합니다.
- 최근 감정 기록 5개를 오른쪽 패널에 표시합니다.

### 루틴 케어

- 수면, 식사, 정리, 샤워의 기본 루틴을 제공합니다.
- `완료`와 `쉬어감`은 동등한 기록 선택지입니다.
- 직접 작은 루틴을 추가할 수 있습니다.
- 루틴 상태 변경도 Supabase `routine_logs`에 이벤트 형태로 저장합니다.
- 알림 넛지 데모는 3초 뒤 다음 동작을 수행합니다.
  - 브라우저 확인 멜로디
  - 피규어 LED 시뮬레이터 점멸
  - 브라우저 알림
  - BLE 연결 시 실제 24LED 링에 `ROUTINE_ALERT` 명령 전송

현재 실제 펌웨어의 루틴 알림은 LED 점멸입니다. 브라우저에서는 확인 멜로디가 함께 재생됩니다.

### 기록 흐름과 리포트

- 최근 14일을 점수 대신 감정색 파스텔 타일로 표시합니다.
- 각 타일 하단의 작은 막대로 완료와 쉬어감의 흐름을 보여줍니다.
- 주간 리포트 문구를 지적·진단 표현보다 휴식과 회복을 지지하는 문장으로 수정했습니다.
- 빈 기록도 실패로 표현하지 않습니다.

### 내 오빗 등록

- 마이오빗돔 색상과 이름을 저장합니다.
- 등록한 이름이 오른쪽 피규어 플레이트에 즉시 적용됩니다.
- 커스텀 돔은 현재 웹 시뮬레이터 감정으로 기록됩니다.
- 실제 NFC 커스텀 돔 등록은 7가지 고정감정 이후 단계로 분리했습니다.

### 실제 기기 연동

기존 MVP의 FFE0/FFE1 예제 UUID를 제거하고 실제 펌웨어 UUID로 교체했습니다.

- Device: `MOOD_ORBIT_0001`
- Service: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- RX: `6e400002-b5a3-f393-e0a9-e50e24dcca9e`
- TX: `6e400003-b5a3-f393-e0a9-e50e24dcca9e`

BLE Notify 메시지가 여러 조각으로 나뉘어도 줄바꿈까지 재조립하여 처리합니다.

### Supabase

- 감정 기록: `emotion_logs`
- 루틴 기록: `routine_logs`
- 인터넷이 없거나 Supabase 설정이 없으면 브라우저 대기열에 보관합니다.
- 연결 복구 후 자동 재전송합니다.
- `client_event_id` 고유 인덱스로 중복 기록을 방지합니다.
- 브라우저에는 Publishable key 또는 anon key만 입력합니다.

## 2. 폴더 구조

```text
MoodOrbit_MVP_v5
├─ WebApp
│  ├─ index.html
│  ├─ style.css
│  ├─ app.js
│  ├─ service-worker.js
│  ├─ manifest.json
│  ├─ icons
│  └─ img
├─ Firmware
│  └─ MoodOrbit_7Emotions_v5
│     ├─ MoodOrbit_7Emotions_v5.ino
│     └─ Pn532HsuReader.h
├─ Supabase
│  └─ supabase_setup.sql
├─ PROTOCOL.md
└─ README_업데이트.md
```

## 3. Arduino 적용

두 펌웨어 파일은 반드시 같은 폴더에 둡니다.

```text
MoodOrbit_7Emotions_v5
├─ MoodOrbit_7Emotions_v5.ino
└─ Pn532HsuReader.h
```

Arduino IDE 설정:

- Board: `ESP32C3 Dev Module`
- USB CDC On Boot: `Enabled`
- Serial Monitor: `115200 baud`
- 라이브러리: `Adafruit NeoPixel`

배선은 기존 v4와 같습니다.

| 부품 | ESP32-C3 |
|---|---|
| NeoPixel 데이터 | GPIO3 → 74HCT125 → 330Ω → DIN |
| PN532 TXD | GPIO4 RX |
| PN532 RXD | GPIO5 TX |
| PN532 전원 | 3.3V |
| 공통 접지 | GND |

PN532 HSU 스위치는 `OFF / OFF`입니다.

## 4. Supabase 적용

1. Supabase Dashboard에서 SQL Editor를 엽니다.
2. `Supabase/supabase_setup.sql` 전체를 실행합니다.
3. 웹앱의 `연결·NFC·Supabase 설정`을 엽니다.
4. Project URL과 Publishable key 또는 anon key를 입력합니다.
5. `설정 저장`을 누릅니다.

Service Role key와 Secret key는 브라우저에 입력하지 않습니다.

## 5. 웹앱 배포

Web Bluetooth와 브라우저 알림은 보안 컨텍스트가 필요하므로 `WebApp` 폴더를 HTTPS 주소에 배포합니다.

사용 가능한 예:

- Vercel
- Cloudflare Pages
- Netlify
- GitHub Pages

Android Chrome에서 배포 주소를 연 뒤 `실제 ESP32 블루투스 연결`을 누릅니다.

## 6. NFC 등록

1. BLE로 `MOOD_ORBIT_0001`에 연결합니다.
2. `연결·NFC·Supabase 설정`을 엽니다.
3. 감정 옆 `등록`을 누릅니다.
4. 해당 감정돔의 NFC를 PN532에 올립니다.
5. 7가지 감정을 반복합니다.

실제 돔을 올리면 LED와 웹 기록이 함께 적용되고, 돔을 내려 PN532 인식이 끊기면 조명이 꺼지며 오늘의 감정 상태가 취소됩니다.

## 7. 기존 데이터

이전 MVP가 사용한 `moodOrbit_DB` 로컬스토리지를 최초 실행 시 v5 데이터로 마이그레이션합니다. 이후에는 `moodOrbit_DB_v5`를 사용합니다.
