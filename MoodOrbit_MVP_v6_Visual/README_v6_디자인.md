# Mood Orbit MVP v6 — 피규어·감정돔 시각화 버전

## 이번 버전의 핵심 변경

- 사용자가 제공한 `device.png`와 감정돔 PNG 7개를 웹앱의 실제 UI 리소스로 사용
- 영상처럼 어두운 스튜디오 안에서 피규어와 돔이 조명과 함께 보이도록 구성
- 돔 원클릭 및 드래그앤드롭 지원
- 선택한 돔 색상에 따라 피규어 뒤 LED 글로우, 바닥광, 상태 카드 색상이 함께 변경
- 돔을 다시 클릭하면 돔 제거, LED 소등, 감정 취소 기록
- 데스크톱에서는 정서·루틴 패널 + 피규어 시뮬레이터의 2단 구성
- 모바일에서는 영상과 유사하게 피규어 시뮬레이터를 상단에 배치
- 기존 BLE, NFC, Supabase, 루틴, 기록 흐름, 주간 리포트 기능 유지
- v5 브라우저 저장 데이터를 v6으로 자동 마이그레이션

## 파일 구조

```text
WebApp/
├─ index.html
├─ style.css
├─ app.js
├─ manifest.json
├─ service-worker.js
├─ icons/
└─ assets/
   ├─ device.png
   ├─ dome_joy.png
   ├─ dome_sad.png
   ├─ dome_anger.png
   ├─ dome_surprise.png
   ├─ dome_peace.png
   ├─ dome_flutter.png
   └─ dome_irritation.png
```

## 실행

로컬 테스트는 파일을 직접 더블클릭하기보다 로컬 서버에서 실행합니다.

```bash
cd WebApp
python -m http.server 8000
```

브라우저에서 `http://localhost:8000`으로 접속합니다.

Web Bluetooth는 Android Chrome과 HTTPS 배포 주소에서 사용하세요.
