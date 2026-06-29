"""
MediPulse Prophet Forecasting Microservice (SHADOW MODE)
=========================================================

An OPTIONAL, stateless forecasting service that mirrors the contract of the
in-process Holt-Winters engine in medipulse-backend. It exists purely so the
backend can run it in *shadow mode* and measure, over many weeks, whether
Prophet beats Holt-Winters per product BEFORE anyone activates it.

Contract
--------
POST /forecast
  body: { "series": [{ "ds": "YYYY-MM-DD", "y": <number> }, ...],
          "horizonDays": 7 | 14 | 30 }
  ->    { "forecastedQty", "confidenceIntervalLow", "confidenceIntervalHigh",
          "estimatedDailyDemand", "trend", "trendMagnitude", "trainingDataPoints" }

GET /health -> { "status": "ok" }

Safety
------
- If Prophet is unavailable or the series is too short/degenerate, the service
  falls back to a simple linear-trend estimate so the backend always gets a
  well-formed ForecastResult. The backend treats this service as best-effort and
  never lets its output affect live reorder logic.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import List, Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field

logger = logging.getLogger("prophet-service")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="MediPulse Prophet Forecasting", version="1.0.0")


class Point(BaseModel):
    ds: str
    y: float


class ForecastRequest(BaseModel):
    series: List[Point] = Field(..., min_items=2)
    horizonDays: int = 14


class ForecastResult(BaseModel):
    forecastedQty: float
    confidenceIntervalLow: float
    confidenceIntervalHigh: float
    estimatedDailyDemand: float
    trend: Literal["increasing", "stable", "decreasing"]
    trendMagnitude: float
    trainingDataPoints: int


def _round(v: float, places: int = 1) -> float:
    return round(float(v), places)


def _linear_fallback(ys: List[float], horizon_weeks: float, n: int) -> ForecastResult:
    """Dependency-light fallback when Prophet is unavailable or data is sparse."""
    # Simple least-squares slope over weekly points.
    xs = list(range(n))
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    denom = sum((x - mean_x) ** 2 for x in xs) or 1.0
    slope = sum((xs[i] - mean_x) * (ys[i] - mean_y) for i in range(n)) / denom
    intercept = mean_y - slope * mean_x

    forecast_weekly = max(0.0, intercept + slope * (n - 1 + horizon_weeks))
    residuals = [abs(ys[i] - (intercept + slope * xs[i])) for i in range(n)]
    mae = (sum(residuals) / len(residuals)) if residuals else forecast_weekly * 0.2
    ci_half = 1.645 * mae * (horizon_weeks ** 0.5)

    avg = mean_y or 1.0
    weekly_slope_per_day = slope / 7.0
    if slope > avg * 0.1 / 7:
        trend = "increasing"
    elif slope < -avg * 0.1 / 7:
        trend = "decreasing"
    else:
        trend = "stable"

    return ForecastResult(
        forecastedQty=_round(forecast_weekly),
        confidenceIntervalLow=max(0.0, _round(forecast_weekly - ci_half)),
        confidenceIntervalHigh=_round(forecast_weekly + ci_half),
        estimatedDailyDemand=_round((forecast_weekly) / 7.0, 3),
        trend=trend,
        trendMagnitude=_round(abs(weekly_slope_per_day), 3),
        trainingDataPoints=n,
    )


def _prophet_forecast(req: ForecastRequest) -> ForecastResult:
    """Run Prophet if installed; otherwise raise to trigger fallback."""
    import pandas as pd  # type: ignore
    from prophet import Prophet  # type: ignore

    df = pd.DataFrame(
        {
            "ds": [datetime.fromisoformat(p.ds) for p in req.series],
            "y": [float(p.y) for p in req.series],
        }
    ).sort_values("ds")

    n = len(df)
    horizon_weeks = max(1, round(req.horizonDays / 7))

    model = Prophet(
        weekly_seasonality=False,
        daily_seasonality=False,
        yearly_seasonality=n >= 52,
        interval_width=0.90,
    )
    model.fit(df)

    future = model.make_future_dataframe(periods=horizon_weeks, freq="W-MON")
    fcst = model.predict(future)

    horizon_rows = fcst.tail(horizon_weeks)
    target = horizon_rows.iloc[-1]

    forecasted = max(0.0, float(target["yhat"]))
    ci_low = max(0.0, float(target["yhat_lower"]))
    ci_high = max(0.0, float(target["yhat_upper"]))

    # Trend from Prophet's own trend component.
    trend_series = fcst["trend"].tolist()
    slope_per_week = (trend_series[-1] - trend_series[0]) / max(1, len(trend_series) - 1)
    avg = (df["y"].mean() or 1.0)
    if slope_per_week > avg * 0.1:
        trend = "increasing"
    elif slope_per_week < -avg * 0.1:
        trend = "decreasing"
    else:
        trend = "stable"

    return ForecastResult(
        forecastedQty=_round(forecasted),
        confidenceIntervalLow=_round(ci_low),
        confidenceIntervalHigh=_round(ci_high),
        estimatedDailyDemand=_round(forecasted / 7.0, 3),
        trend=trend,  # type: ignore[arg-type]
        trendMagnitude=_round(abs(slope_per_week / 7.0), 3),
        trainingDataPoints=int(n),
    )


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/forecast", response_model=ForecastResult)
def forecast(req: ForecastRequest) -> ForecastResult:
    ys = [float(p.y) for p in req.series]
    n = len(ys)
    horizon_weeks = max(1, round(req.horizonDays / 7))

    try:
        return _prophet_forecast(req)
    except Exception as exc:  # ImportError or fit failure → safe fallback
        logger.warning("Prophet unavailable/failed, using linear fallback: %s", exc)
        return _linear_fallback(ys, horizon_weeks, n)
