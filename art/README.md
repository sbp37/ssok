# art/ — 원본 에셋 (배포 안 됨)

`public/assets/`에 들어가는 WebP의 원본 PNG와 제작 메모. Vite는 `public/`만 복사하므로
이 폴더는 번들에 포함되지 않는다.

- `beads/original/*.png` — 사진에서 잘라낸 비즈 원본 (~250px). `beads/manifest.json`에 크롭 좌표.
- `beads/*.png` — 128px 다운스케일 PNG. 배포용은 `public/assets/beads/*.webp` (Chromium 인코더, q=0.9).
- `collector/glass-empty.png` — 유리병 원본 1195×1316. 배포용은 `public/assets/collector/glass-empty.webp`
  (그릇 영역 37,75,1116,1182 크롭 → 400×424, q=0.86). 제작 프롬프트는 `collector/README.md`.
- `fx/sparkle.png` — 배포용 `public/assets/fx/sparkle.webp`.

다시 변환하려면: 프리뷰 서버를 띄우고 Chromium 캔버스로 `toDataURL("image/webp")` (이 저장소엔 cwebp 의존성이 없다).

## 월간 테마 보물 12종

`leaf-red`, `leaf-amber`, `acorn`, `snowflake`, `snowflake-ice`, `mitten`,
`sakura`, `sprout`, `sakura-pearl`, `watermelon`, `shell-blue`, `shell-pearl`은
내장 `image_gen`으로 생성한 참 이미지다. 기존 사진인 `original/heart.png`,
`flower.png`, `pearl.png`, `holostar.png`를 매번 참고 이미지로 제공했다.

프롬프트는 작은 실물 레진·유리·진주광택 참 하나를 정면에 가까운 탑뷰로 촬영하고,
둥글고 도톰한 가장자리, 왼쪽 위의 큰 부드러운 흰 반사광, 오른쪽의 작은 반사광,
파스텔 색상과 내부 굴절을 기존 비즈에 맞추도록 지정했다. 각 모양·색·재질의
프롬프트 요지는 `beads/manifest.json`에 기록한다. 일러스트·벡터·문자·추가 물체를 제외했다.

순수 검정 배경으로 생성한 후 외부와 연결된 검정 배경을 제거하고 경계 픽셀의
검정 매트를 보정했다. 오브젝트에 맞춰 크롭한 투명 PNG를 긴 변 250px로,
게임용 PNG와 WebP를 긴 변 128px로 줄였다(Lanczos, Pillow WebP quality=90).
새 이미지는 색상 틴트 없이 표시하며, 로드 실패 시 기존 코드 그림을 사용한다.

## 일반 숨은 보물 — 포근 세트 4종

`cloud-charm`(구름 참, 하늘빛·흰 말랑 레진), `paw-charm`(발바닥 참, 분홍 젤리 고양이 발바닥),
`gummy-bear`(곰젤리, 반투명 주황·딸기빛), `ribbon-charm`(리본 참, 연보라·분홍 반짝 레진)은
내장 `image_gen`으로 각각 생성했다. 월간 테마 보물과 동일하게 기존 사진 비즈
`original/heart.png`, `flower.png`, `pearl.png`, `holostar.png`를 매번 참고 이미지로 제공했다.
정면에 가까운 탑뷰 제품 사진, 도톰하고 둥근 가장자리, 왼쪽 위의 큰 부드러운 흰 반사광과
오른쪽의 작은 반사광, 파스텔 색상·내부 굴절을 지정했다. 전체 프롬프트와 출처·크기는
`beads/manifest.json`에 기록했다.

검정 배경 생성 → 외부와 연결된 배경 제거·검정 매트 경계 보정 → 오브젝트 크롭 →
긴 변 250px 원본 PNG / 128px 게임 PNG·WebP(Lanczos, Pillow quality=90) 순서로 처리했다.
사진 색상은 틴트 없이 사용하며, 이미지 로드 실패 시 기존 모양의 코드 그림으로 대체한다.
`../newtreasure-check.png`(저장소 상위 폴더)에 기존 사진 4종과 새 4종을 밝고 어두운 배경으로
나란히 비교해 재질·반사광·테두리 헤일로를 직접 확인했다.
