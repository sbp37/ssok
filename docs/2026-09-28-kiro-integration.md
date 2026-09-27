# 키로 품질 개선을 최신 촉감 버전에 통합

## 기준과 범위

- 키로 PR: https://github.com/sbp37/ssok/pull/3, head `aad028700cb293d1644a3313c568b20e4a6c52db`.
- 로컬 기준: `codex/colored-fibers`, HEAD `cf9259fd0913177ae0e77a81284149a11a37866a` **및 기존 미커밋 최신 작업**.
- PR을 통째로 덮지 않고 공통 기준/최신 로컬/PR을 대조했다. 최신 실·구슬줄·소용돌이·막, 첫 소리, 광고 2판 간격, 시작 로딩 및 패드 이름을 유지했다.
- 이 환경의 `.git` 쓰기 제한으로 새 브랜치 생성은 실패했다. 로컬 파일만 수정했으며 커밋/머지/푸시/토스 제출/운영 배포는 하지 않았다.
- 작업 전 백업: `/tmp/ssok-before-kiro-20260928.patch`, `/tmp/ssok-before-kiro-20260928-src.tgz`. 이전 AIT도 `output/kiro-integration/ssok-before-kiro-20260924.ait`에 보존했다.

## 흡수한 변경

| 파일 | 이유 |
| --- | --- |
| `.github/workflows/ci.yml`, `deploy.yml`, `package.json` | PR 검사 및 배포 전 테스트, 운영 프로모션 빌드 명령 |
| `vite.config.ts` | `VITE_PROMOTION_MODE` 오타를 빌드 실패로 처리, TEST/LIVE 명시 |
| `Game.ts`, `render/{EmbeddedBead,PullNeck,Flight,Finale}.ts`, `util/Emitter.ts` | 기존 그리기를 책임별로 분리. 최신 촉감 비행/반동은 별도 재통합 |
| `util/PerfProbe.ts` | 선택적 `?perf=1` 프레임 간격/CPU 작업 시간 측정 |
| `gel/MeshGL.ts`, `input/Pointer.ts` | 매 프레임 배열 할당 일부 제거, 이벤트 해제 누락 정리 |
| `gel/Gel.ts` | 기존 320 해상도/6개 캐시 상수화. 해상도·광원 계산·재질 변화 없음 |
| `ui/App.tsx`, `ui/Sheets.tsx`, `ui/share.ts`, `ui/styles.css` | 완료 후 자랑하기와 기존 컬렉션 공유를 공통화, 취소/실패/중복 탭 처리 |
| `index.html`, `public/branding/app-icon-{64,180}.png` | 기존 600px 아이콘에서 작은 브라우저 아이콘 파생; 새 아트 아님 |
| `tests/load.mjs`, `promotion.mjs`, 기존 광고/판 길이/캐시 검사 | 공통 TS 로더, 프로모션 중복/실패/모드 검증. 최신 실·오디오 검사도 CI에 포함 |
| `tests/share.mjs` | 추가 안전망: 토스/샌드박스, 웹 공유, 취소, 클립보드 대체, 실패, 연속 탭 |
| `README.md`, `docs/ad-policy.md` | 최신 구성/검증 방법 반영. 과거 시간 간격 정책의 화면 검사를 현재 결과로 오인하지 않게 구분 |

사용하지 않던 `modes/Challenge.ts`, `storage/records.ts` 및 타이머/콤보 UI 잔여 코드 제거. 기존 로컬 저장소를 삭제하거나 초기화하지 않는다. 지운 소스는 작업 전 백업과 Git 이력으로 복구 가능하다.

## 최신 작업 보호

- `audio/Sfx.ts`, `beads/Bead.ts`, `collector/Collector.ts`, `haptics.ts`, `pads/pacing.ts`, `ads/AdPolicy.ts`, `physics/pull.ts`, `rewards/PromotionRewards.ts`, `fibers/*.ts`는 통합 직전 백업과 바이트 단위로 동일하다.
- `Game.ts`의 구슬줄/실 말림 비행을 새 `render/Flight.ts`에 이식했다. 구슬을 드러내는 막/큰 알 줄과 말려 수집되는 실/줄/소용돌이를 구별한다.
- 첫 판 구슬 줄 1 + 실 2, 이후 매 판 실 1 + 대표 촉감 1, 소용돌이 격판, 첫 완료 소리의 지연 해제, 네이티브 터치 해제 이벤트 유지.
- 보상 확률, 뽑기 물리 기본값, 수집통 sleep, 저장 포맷, 배너 위치/시트 숨김은 변경하지 않았다.

## 검증 결과

- `pnpm check`: 타입 검사 및 **7개 테스트 스크립트 PASS**. 광고/프로모션/3,080 생성 판/캐시/촉감 배치·추출/첫 소리/공유.
- `node output/kiro-integration/compare-render.cjs`: **15,462개 통합 전후 Canvas 명령 대조 PASS**. 360/390/430 비율, 모션 줄이기, 깊이/리프트, 왕비즈 목, 일반 및 촉감 비행, 점착 실, 마무리 별. 스프라이트/Canvas를 기록기로 대체한 명령 비교이며 픽셀·실제 브라우저 검사가 아니다. 작업 전 `/tmp/ssok-kiro-review/ours/src/game/Game.ts`가 필요하다.
- `pnpm build`: TEST 모드 PASS.
- `pnpm toss:build:live`: LIVE 모드 및 AIT 생성 PASS. 실제 지급/업로드/배포 실행 아님.
- `VITE_PROMOTION_MODE=LIVE pnpm build`: 의도대로 실패(대문자 오타 차단). 그 뒤 최종 산출물은 다시 `toss:build:live`로 생성.
- `git diff --check`: PASS. 충돌 마커 없음. 의존성/lockfile 변경 없음.
- 운영 JS 409,804 bytes / gzip 133,305 bytes, CSS 12,756 bytes. 번들 크기이지 프레임 성능 측정값이 아니다.

## 남은 검증: 출시 전 필수

`quality-handoff`: 정적/단위/명령 동등성 검사 PASS. **실제 화면·기기 QA는 보류(NEEDS FIX/검증 환경 필요)**.

현재 환경에서 로컬 서버 바인딩이 EPERM, Chrome 실행이 SIGABRT로 막혔다. 이번 통합의 브라우저 스크린샷, 360/390/430 실제 레이아웃, 안드로이드/아이폰 소리·햅틱, 토스 공유 시트, 실광고·실지급은 검증하지 못했다. 과거 버전의 스크린샷이나 테스트를 이번 통합 결과로 재사용하지 않았다.

토스 실기기에서 첫 뽑기 소리 → 줄/소용돌이/막 → 마지막 알/병 수집 → 자랑하기 → 다음 패드 → 2판 간격 광고 → 설정/컬렉션 배너 숨김을 확인해야 한다. `?perf=1`은 측정 도구만 추가했으며 60fps나 실기기 성능 향상을 보장하지 않는다. `frame P95 < 20ms`만으로 안정적인 60fps라고 단정하지 않는다.
