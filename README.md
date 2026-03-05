# UN-AD

대량 상품 리뷰를 자동 수집/필터링하고, 쿠팡 링크 기반으로 `1~2점 리뷰 단점 요약`을 제공하는 파이프라인입니다.

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

## API 예시

- `GET /products`
- `GET /products/:id/stats`
- `GET /products/:id/reviews?label=real&limit=50`
- `POST /ingestion/run` (body: `{ "source": "csv|coupang|all" }`)
- `POST /insights/from-link` (body: `{ "url": "https://www.coupang.com/..." }`)
- `POST /insights/from-csv` (body: `{ "csvText": "<csv-content>" }`)
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
