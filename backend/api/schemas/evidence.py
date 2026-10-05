"""Request models for analyst feedback on a verdict."""

from pydantic import BaseModel


class FeedbackRequest(BaseModel):
    verdict_was_correct: bool
