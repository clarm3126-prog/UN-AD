FROM mcr.microsoft.com/playwright/python:v1.58.0-jammy

WORKDIR /work

# Required for xlsx output in the crawler script.
RUN pip install --no-cache-dir pandas openpyxl

# Default entrypoint runs the refactored crawler.
ENTRYPOINT ["python", "scripts/crawl_coupang_reviews.py"]
