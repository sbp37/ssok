# 하트 패드용 스튜디오 비즈

2026-09-13. 사용자 하트 패드 참고 그림을 바탕으로 imagegen으로 각각 따로 생성했다.
원본 4개 모두 1254×1254 RGBA PNG이며 검은 배경이 아니라 실제 알파가 있다.
패드/구멍/배경 그림을 잘라 붙인 에셋은 아니다. 생성 원본을 그대로 보존한다.

| 원본 | 알파 0 비율 | 원본 크롭 x,y,w,h | 배포 WebP | 크기 | 바이트 |
|---|---:|---|---|---|---:|
| glass.png | 49.68% | 127,126,1000,1002 | public/assets/beads/studio-glass.webp | 255×256 | 21636 |
| pearl.png | 56.10% | 156,166,941,939 | public/assets/beads/studio-pearl.webp | 256×255 | 15844 |
| heart.png | 55.40% | 104,171,1049,912 | public/assets/beads/studio-heart.webp | 256×223 | 22582 |
| gold.png | 44.26% | 111,113,1032,1018 | public/assets/beads/studio-gold.webp | 256×253 | 30636 |

WebP: q94 / alphaQuality100, Lanczos3 비율 유지 축소. 알파 >8 경계에 2px 원본 여유를 더해 크롭했다.
각 표시 중심은 (0.5,0.5), 긴 변은 실제 비즈 반경의 2배. 256px 기준 이미지를 프레임마다 다시 만들지 않는다.
배포 합계 90,698바이트. PNG는 art/에만 있어 Vite 배포에 포함되지 않는다.

연결은 패드 스킨과 분리된 비즈 재질 기준으로 모든 패드에 적용된다.

- studio-glass → tiny / marble / bigglass (기존 비즈 컬러로 color 블렌드)
- studio-pearl → pearl / bigpearl (원본 진주광)
- studio-heart → heart (원본 분홍 레진)
- studio-gold → gold (원본 금색 쿠션컷, 재염색 없음)
- 나머지 종류 → 기존 에셋/렌더러

파일 실패 시 이전 비즈 WebP, 그것도 실패하면 기존 절차적 렌더러를 사용한다.
종류 ID, 희귀도, 추첨 가중치, 저장 데이터는 이미지에 맞춰 바꾸지 않는다.
