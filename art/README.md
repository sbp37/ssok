# art/ — 원본 에셋 (배포 안 됨)

`public/assets/`에 들어가는 WebP의 원본 PNG와 제작 메모. Vite는 `public/`만 복사하므로
이 폴더는 번들에 포함되지 않는다.

- `beads/original/*.png` — 사진에서 잘라낸 비즈 원본 (~250px). `beads/manifest.json`에 크롭 좌표.
- `beads/*.png` — 128px 다운스케일 PNG. 배포용은 `public/assets/beads/*.webp` (Chromium 인코더, q=0.9).
- `collector/glass-empty.png` — 유리병 원본 1195×1316. 배포용은 `public/assets/collector/glass-empty.webp`
  (그릇 영역 37,75,1116,1182 크롭 → 400×424, q=0.86). 제작 프롬프트는 `collector/README.md`.
- `fx/sparkle.png` — 배포용 `public/assets/fx/sparkle.webp`.

다시 변환하려면: 프리뷰 서버를 띄우고 Chromium 캔버스로 `toDataURL("image/webp")` (이 저장소엔 cwebp 의존성이 없다).
