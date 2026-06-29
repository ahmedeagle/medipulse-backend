# MediPulse Prophet Forecasting Microservice (Shadow Mode)

An **optional**, stateless forecasting service that mirrors the contract of the
in-process Holt-Winters engine in `medipulse-backend`. It exists purely so the
backend can run it in **shadow mode** and measure — over many weeks — whether
Prophet actually beats Holt-Winters *per product* before anyone activates it.

## Trust model

- **Off by default.** The backend only calls this service when
  `PROPHET_SHADOW_ENABLED=true` **and** `PROPHET_MICROSERVICE_URL` is set.
- **Pure observer.** Its output is written only to the `prophet_forecast_comparison`
  table. It never touches `demand_forecasts`, EOQ, reorder points, or procurement.
- **Fail-safe.** If this service is down or slow, the backend's live forecast is
  already persisted — nothing breaks.
- **Self-healing fallback.** If Prophet itself is unavailable, the service returns
  a simple linear-trend estimate so the contract is always satisfied.

## API

```
GET  /health   -> { "status": "ok" }

POST /forecast
  body: { "series": [{ "ds": "YYYY-MM-DD", "y": <number> }, ...],
          "horizonDays": 7 | 14 | 30 }
  ->    { forecastedQty, confidenceIntervalLow, confidenceIntervalHigh,
          estimatedDailyDemand, trend, trendMagnitude, trainingDataPoints }
```

## Run locally

```bash
cd prophet-service
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8200
```

## Run with Docker

```bash
docker build -t medipulse-prophet ./prophet-service
docker run -p 8200:8200 medipulse-prophet
```

## Enable shadow mode in the backend

```env
PROPHET_SHADOW_ENABLED=true
PROPHET_MICROSERVICE_URL=http://localhost:8200
```

Then inspect accuracy after a few weeks:

```sql
SELECT status, COUNT(*), AVG(holtMape), AVG(prophetMape)
FROM prophet_forecast_comparison
WHERE actualQty IS NOT NULL
GROUP BY status;
```

Only consider activating Prophet for products where `prophet_better` consistently
wins on `prophetMape`.
