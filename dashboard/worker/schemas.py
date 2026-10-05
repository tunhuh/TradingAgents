"""Schema the summarizer asks the LLM to fill for one saved report."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

# Reuse the decision agents' rating enum and price-field coercion so a summary
# reads numbers the same way the Trader / Portfolio Manager schemas do.
from tradingagents.agents.schemas import PortfolioRating, _coerce_optional_float

_MAX_ITEMS = 3


class ReportSummary(BaseModel):
    rating: PortfolioRating = Field(
        description="The Portfolio Manager's FINAL rating: exactly one of Buy / Overweight / Hold / Underweight / Sell.",
    )
    price_target: float | None = Field(
        default=None, description="Final price target as an absolute price; null if the report gives none.",
    )
    stop_loss: float | None = Field(
        default=None, description="Stop-loss as an absolute price; null if the report gives none.",
    )
    time_horizon: str | None = Field(
        default=None, description="Time horizon as stated in the report (e.g. '3-6 months'); null if none.",
    )
    tldr: str = Field(description="At most 3 sentences: the final decision and the main reason for it.")
    bull_points: list[str] = Field(
        default_factory=list, description="Up to 3 strongest arguments for the position, one short sentence each.",
    )
    key_risks: list[str] = Field(
        default_factory=list, description="Up to 3 most important risks, one short sentence each.",
    )
    catalysts_to_watch: list[str] = Field(
        default_factory=list, description="Up to 3 upcoming events or price levels that would change the view.",
    )

    @field_validator("rating", mode="before")
    @classmethod
    def _normalize_rating(cls, value):
        return value.strip().capitalize() if isinstance(value, str) else value

    @field_validator("price_target", "stop_loss", mode="before")
    @classmethod
    def _coerce_price(cls, value):
        return _coerce_optional_float(value)

    @field_validator("bull_points", "key_risks", "catalysts_to_watch", mode="after")
    @classmethod
    def _cap_items(cls, value: list[str]) -> list[str]:
        return [s.strip() for s in value if s and s.strip()][:_MAX_ITEMS]
