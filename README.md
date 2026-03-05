# UN-AD

대량 상품 리뷰를 자동 수집/필터링하고, 쿠팡 링크/CSV/XLSX 기반으로 `1~2점 리뷰 단점 요약`을 제공하는 파이프라인입니다.

## 구성

- `web`: 사용자용 프론트 (`index.html`, `main.js`, `style.css`)
- `backend/ingestion-service.js`: 리뷰 원천(CSV/쿠팡 어댑터) 수집 후 큐 적재
- `worker/filter-worker.js`: 큐에서 리뷰를 가져와 광고성/가짜 의심 분석
- `backend/api-server.js`: 상품/리뷰/통계 조회 API
- `data/runtime/db.json`: 로컬 저장소(JSON DB)
- `data/runtime/review-queue.ndjson`: 분석 대기 큐

## 빠른 시작

```bash
npm run seed:sample
npm run pipeline:run
npm run api:start
npm start
```

- 웹 UI: `http://localhost:3000`
- API: `http://localhost:4000`

## 스모크 점검(권장)

```bash
npm run smoke:check
```

`seed -> ingest+worker -> api health/products`를 한 번에 검증합니다.  
도커 크롤러까지 확인하려면:

```bash
RUN_DOCKER_CRAWLER=1 npm run smoke:check
```

## API 예시

- `GET /products`
- `GET /products/:id/stats`
- `GET /products/:id/reviews?label=real&limit=50`
- `POST /ingestion/run` (body: `{ "source": "csv|coupang|all" }`)
- `POST /insights/from-link` (body: `{ "url": "https://www.coupang.com/..." }`)
- `POST /insights/from-csv` (body: `{ "csvText": "<csv-content>" }`)
- `POST /insights/from-upload` (body: `{ "fileName": "reviews.xlsx", "fileBase64": "..." }`)
- `POST /reviews/:id/feedback`

`/insights/from-link`는 아래를 한 번에 수행합니다.
1. 링크에서 상품 ID 추출
2. 해당 상품 리뷰 자동 수집(Coupang adapter)
3. 큐 워커 자동 분석
4. `1~2점` 리뷰만 모아 단점 요약 반환

`/insights/from-csv`는 아래를 한 번에 수행합니다.
1. CSV 리뷰 적재
2. 큐 워커 자동 분석
3. 상품별 `1~2점` 리뷰 단점 요약

`/insights/from-upload`는 CSV/XLSX 파일 업로드용 엔드포인트입니다.

## 수집 소스 어댑터

### 1) CSV 수집

```bash
npm run ingest:run
```

CSV 위치: `data/source/reviews/*.csv`

### 2) Coupang 어댑터 수집

```bash
npm run ingest:coupang
```

기본은 `mock-file` 모드이며 `data/source/coupang/mock-reviews.json` 사용.

### 3) CSV + Coupang 동시 실행

```bash
npm run ingest:all
```

## Coupang 어댑터 설정

`.env.example`를 참고해 환경변수를 설정하세요.

핵심 변수:

- `COUPANG_SOURCE_MODE=mock-file|http`
- `COUPANG_REVIEW_API_URL_TEMPLATE` (http 모드 필수)
- `COUPANG_ACCESS_KEY`, `COUPANG_SECRET_KEY`, `COUPANG_VENDOR_ID`
- `COUPANG_PRODUCTS_FILE` (기본: `data/source/products.csv`)

URL 템플릿 예시:

```text
https://api-gateway.coupang.com/example/reviews?productId={productId}&vendorItemId={vendorItemId}
```

주의:
- 공개 문서에서 리뷰 전용 엔드포인트가 명확하지 않으므로,
  실제 운영 시에는 부여받은 리뷰 API 스펙에 맞춰 템플릿/필드 매핑을 조정해야 합니다.

## 리뷰 자동화 흐름

1. 수집기가 신규 리뷰를 가져옴 (CSV/Coupang)
2. 리뷰 이벤트를 큐에 적재
3. `filter-worker`가 점수화/라벨링
4. `api-server`가 상품별 실제 소비자 리뷰를 조회 제공

## CSV 포맷

헤더 예시:

```csv
product_id,product_name,vendor_item_id,review_id,rating,created_at,review_text,source
```

XLSX도 동일한 컬럼명을 사용하면 됩니다.

## 브라우저 확장(반자동 수집)

`extension/` 폴더를 크롬 확장으로 로드한 뒤, 쿠팡 상품 페이지에서 팝업 버튼을 눌러 현재 보이는 리뷰를 CSV로 저장할 수 있습니다.

1. 크롬 `chrome://extensions` 이동
2. `개발자 모드` ON
3. `압축해제된 확장 프로그램 로드` -> `extension/` 선택
4. 쿠팡 상품 페이지에서 `UN-AD Export` 클릭 -> `현재 페이지 리뷰 CSV 저장`

## Playwright 수집 템플릿

정책 허용 범위에서만 사용하세요.

```bash
npm run crawl:template -- "https://www.coupang.com/vp/products/..."
```

출력 파일은 `data/source/reviews/crawl_<timestamp>.csv`로 저장됩니다.

## Python 크롤러(리팩터링 버전)

추가 스크립트: `scripts/crawl_coupang_reviews.py`

특징:
- 리뷰 중복 제거(`review_id` 우선, 없으면 해시)
- 더보기 + 스크롤 루프로 점진 수집
- CSV/XLSX 출력 지원

예시:

```bash
python3 scripts/crawl_coupang_reviews.py \
  "https://www.coupang.com/vp/products/131023672?itemId=362266710&vendorItemId=4279191312" \
  --max-reviews 200 \
  --out data/source/reviews/coupang_reviews.csv
```

주신 URL(기본값 내장)로 실행:

```bash
python3 scripts/crawl_coupang_reviews.py --max-reviews 200 --out data/source/reviews/coupang_reviews.csv
```

## Docker 실행(권장)

호스트에 Python/Playwright 라이브러리를 직접 깔지 않고 크롤러를 실행합니다.

```bash
scripts/run_crawler_docker.sh \
  "https://www.coupang.com/vp/products/8671137454?vendorItemId=92174443576&sourceType=HOME_GW_PROMOTION&searchId=feed-c19a9e097ff24146acb28d491b18944b-3.33.107%3Agw_promotion" \
  --max-reviews 200 \
  --headless \
  --out data/source/reviews/coupang_reviews_8671137454.csv
```

URL 인자를 생략하면 스크립트 기본 URL(위 상품)로 실행됩니다:

```bash
scripts/run_crawler_docker.sh --max-reviews 200 --headless --out data/source/reviews/coupang_reviews_8671137454.csv
```

## 로컬 Python 실행(대안)

의존성:
- `pip install playwright`
- `python -m playwright install chromium`
- (xlsx 저장 시) `pip install pandas openpyxl`

## 배포(Firebase Hosting)

정적 웹(`index.html`, `main.js`, `style.css`) 배포:

```bash
FIREBASE_PROJECT_ID=<your-project-id> npm run deploy:web
```

사전 조건:
- `npm i -g firebase-tools`로 Firebase CLI 설치
- `firebase login` 완료
- Firebase 프로젝트에 Hosting 활성화
