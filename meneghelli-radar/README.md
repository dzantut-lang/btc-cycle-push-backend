# BTC MENEGHELLI RADAR — MNR 1.0

This module is an isolated, deterministic research engine for the BTC Cycle Desk. It is not connected to the official buy/sell engine and cannot modify its signals.

## Safety contract

- Feature access is restricted to the Advanced mode in the frontend.
- Essential mode must not import, render, request, or initialize this module.
- The Radar runs in observation-only / shadow mode.
- It does not create official BUY/SELL signals, execute orders, or send market-signal push notifications.
- Keep this feature on a separate Git branch until code review, automated tests, backtest validation, and a controlled deployment are complete.
- Rollback: disable the Advanced-only feature flag and revert the isolated MNR route/module deployment. Never roll back or replace the existing official engine as part of an MNR release.

## Engine API

`computeRadar({ candles, timeframe, closed, onchain })`

- `candles`: chronological, non-duplicated objects with `time` (Unix milliseconds), `close`, optional `high`, `low`, and `volume`.
- `timeframe`: currently `1d`, `3d` (default), or `1w`.
- `closed`: false while the latest candle is still forming. UI must label provisional values accordingly and only persist finalized signals from closed candles.
- `onchain`: optional arrays exactly aligned by index to candles: `mvrvZ`, `nupl`, `rhodl`, `puell`, and `cvdd`. Missing values are excluded, never synthesized.

The result includes Top Macro, Bottom Macro, Swing Reversal and Trading Opportunity scores, component coverage, individual technical metrics, data quality and explicit observation-only flags.

## Quantitative behavior

- Indicators are transformed to rolling historical percentiles using only the supplied current-and-prior observations.
- Macro scores use only available components and disclose coverage. At least three components are required for a score.
- The Pi Cycle component uses the 111-day / (2 × 350-day) ratio and a transparent proximity transform.
- No score is a calibrated probability. Calibration requires a separate, leakage-controlled walk-forward study.
- MNR 1.0 does not claim that its score levels or weights have passed historical validation.

## Data-source requirements before API integration

The current backend's Coin Metrics proxy exposes the MVRV ratio series (`CapMVRVCur`) and market/realized capitalization fields; `CapMVRVCur` is not itself an MVRV Z-Score. Do not map it into `onchain.mvrvZ`. Derive a correctly specified Z-Score from aligned Market Cap and Realized Cap history, or obtain a genuine Z-Score series from a source that documents its methodology. Similarly, CVDD, RHODL, Puell and NUPL must be sourced or derived with documented formulas before enabling their components.

## Frontend integration contract

The frontend must check the existing Advanced-mode state before mounting this module. The MNR navigation item, data request, chart and animations must not be loaded in Essential mode. If the API is unavailable or invalid, show a contained MNR error state inside Advanced mode only; never allow it to break dashboard initialization or the existing BTC chart, signals, alerts, or wallet panels.

## Validation

Run `npm test` and include dedicated tests for formulas, missing data, alignment, candle finalization, determinism, and regression isolation. Backtest labels, event definitions, fees, slippage, funding, and out-of-sample methodology must be reviewed before making any accuracy claims.
