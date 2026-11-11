"""API Gateway entry point."""

from app import handle


def lambda_handler(event, context):
    return handle(event)
