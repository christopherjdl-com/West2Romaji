"""Device table and secret values."""

import os

from errors import RequestError
from signing import load_p256_public_key

PRIMARY = "primary"
_table = None
_secrets = None


def table():
    global _table
    if _table is None:
        import boto3

        _table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
    return _table


def secrets():
    global _secrets
    if _secrets is None:
        import boto3

        _secrets = boto3.client("secretsmanager")
    return _secrets


def get_item(device_id):
    return table().get_item(Key={"device_id": device_id}).get("Item")


def put_unless_exists(item):
    try:
        table().put_item(Item=item, ConditionExpression="attribute_not_exists(device_id)")
    except Exception as error:
        code = _client_error_code(error)
        if code is None or code != "ConditionalCheckFailedException":
            raise
        return error
    return None


def enrolled_key():
    found = get_item(PRIMARY)
    if not found:
        return None
    try:
        return load_p256_public_key(found.get("public_key_pem"))
    except ValueError as error:
        raise RequestError(500, "The enrolled key could not be read.") from error


def secret_string(secret_id):
    if not secret_id:
        return ""
    try:
        response = secrets().get_secret_value(SecretId=secret_id)
    except Exception as error:
        code = _client_error_code(error)
        if code is None:
            raise
        if code == "ResourceNotFoundException":
            return ""
        raise
    return response.get("SecretString") or ""


def _client_error_code(error):
    from botocore.exceptions import ClientError

    if not isinstance(error, ClientError):
        return None
    return error.response.get("Error", {}).get("Code", "")
