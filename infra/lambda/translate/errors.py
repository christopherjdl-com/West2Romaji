"""Failures returned to the phone."""


class StatusError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


class RequestError(StatusError):
    """The phone's request was rejected before a model was called."""


class TranslationError(StatusError):
    """A model provider rejected the phrase or failed to translate it."""
