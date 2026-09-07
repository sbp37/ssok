# 쏙!

젤 패드에서 비즈를 하나씩 **쏙** 뽑는 손맛 미니게임. 모바일 브라우저 우선.

이 프로젝트의 핵심은 기능 개수가 아니라 **촉감의 착각**이다 — 젤을 누르고, 벌리고, 비즈를 잡고, 저항을 느끼며 당기다가, 툭 하고 빠지는 순간.

## 실행

```bash
pnpm install
pnpm dev          # http://localhost:5173  (--host 로 같은 Wi-Fi의 폰에서 접속 가능)
pnpm build        # 타입체크 + dist/ 빌드
pnpm preview      # 빌드 결과 미리보기 (4173)
```

`main`에 push하면 GitHub Actions가 GitHub Pages로 자동 배포한다 (`.github/workflows/deploy.yml`).

## 테스트 / 튜닝

- **`?test=5`** — 비즈 5개만 넓게 박힌 테스트 패드. 젤 누르기 → 잡기 → 늘리기 → POP → 복원 손맛을 볼 때 쓴다. (`?test=12` 처럼 개수 지정 가능)
- 브라우저 콘솔에서 `window.__ssok` 으로 Game 인스턴스에 접근할 수 있다.
  - `__ssok.debugBeads()` — 잡을 수 있는 비즈의 화면 좌표와 임계 거리(`t1`, `t2`)
  - `__ssok.gel` — 젤 상태 (fingers, wobble, shocks, R)
- 소리는 첫 터치 이후에 켜진다(브라우저 정책). 진동은 Android Chrome에서만 동작한다.

## 구조

```
src/game/
  Game.ts             프레임 루프, 입력→젤/비즈 연결, POP 시퀀스(30ms/40ms 지연), 렌더 순서
  gel/Gel.ts          젤 모델: 변위장 warp(), 스프링(딤플/드래그/출렁임/충격), 베이스 텍스처, 오버레이
  gel/MeshGL.ts       젤 메시를 WebGL 삼각형으로 그리는 아주 작은 렌더러 (이음선 없는 텍스처 변형)
  beads/BeadTypes.ts  비즈 카탈로그 — 촉감을 바꾸는 값은 전부 여기 (grip/pull/friction/minSpeed/mass/bounce)
  beads/Bead.ts       비즈 엔티티 + 패드 레이아웃(표면층/깊은층)
  beads/BeadSprites.ts 비즈/그림자/메니스커스 스프라이트 프리렌더
  physics/pull.ts     붙잡힘 → 미끄러짐(stick-slip) → POP / 미끄러져 빠짐(5~8%) 상태기계
  physics/spring.ts   감쇠 스프링
  audio/Sfx.ts        Web Audio 프로시저럴 효과음 (매번 ±5~10% 변형)
  haptics.ts          navigator.vibrate 패턴 + ON/OFF
  collector/Collector.ts  수집통 + 간단한 구슬 물리
  modes/Challenge.ts  30초 챌린지 상태 (점수/콤보)
  storage/records.ts  로컬 최고기록. RankingProvider 인터페이스만 정의 (가짜 랭킹 없음)
src/ui/               React 오버레이 (HUD, 힌트, 결과, 토글) — 최소한만
```

### 젤 렌더링 방식

1. **베이스 텍스처** — 측면 벽, 반투명 윗면(중앙 옅고 가장자리 진함), 결, 소켓, 묻힌 비즈, 젤 틴트, 프레넬 림을 오프스크린 캔버스에 한 번 그린다. 비즈를 잡거나/놓거나/뽑을 때만 다시 그린다.
2. **메시 변형** — 매 프레임 22×22 격자의 정점을 `Gel.warp()`(손가락 딤플·드래그, 당기는 비즈 쪽 텐트, POP 충격, 전체 출렁임)로 밀어서 WebGL 삼각형으로 텍스처를 그린다. 실루엣까지 같이 찌그러진다. WebGL이 없으면 Canvas 2D 셀 단위 폴백.
3. **동적 오버레이** — 딤플 음영, 뽑힌 자리 움푹함, 미끄러지는 하이라이트, 당기는 비즈의 구멍/텐트/목, 들려 나오는 비즈는 2D 캔버스에 매 프레임 그린다.
