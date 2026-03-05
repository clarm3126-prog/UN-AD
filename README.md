# UN-AD

대량 상품 리뷰를 자동 수집/필터링하기 위한 파이프라인 구조입니다.

## 구성

- `web`: 사용자용 프론트 (`index.html`, `main.js`, `style.css`)
- `backend/ingestion-service.js`: 리뷰 원천(CSV) 수집 후 큐 적재
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
- `POST /ingestion/run`
- `POST /reviews/:id/feedback`

## 리뷰 자동화 흐름

1. `data/source/reviews/*.csv` 파일이 들어옴
2. `ingestion-service`가 신규 파일만 처리
3. 리뷰 이벤트를 큐에 적재
4. `filter-worker`가 점수화/라벨링
5. `api-server`가 상품별 실제 소비자 리뷰를 조회 제공

## CSV 포맷

헤더 예시:

```csv
product_id,product_name,vendor_item_id,review_id,rating,created_at,review_text,source
```

## 운영 전환 포인트

공식 리뷰 API가 열리면 `backend/lib/ingestion-runner.js`에 소스 어댑터만 추가해 동일 파이프라인으로 확장하면 됩니다.
