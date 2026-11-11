# Infrastructure

The phone signs each request with a P-256 key. This stack checks that signature, then translates. The Cordova app does not call the model itself. The Lambda path flips a coin between Amazon Bedrock and a direct provider call. Bedrock flips again, between Claude Haiku and Nova Lite. Tokyo and Paris both use Haiku 4.5. A direct call flips between Gemini and xAI. Each flip is even. When xAI wins and its key is empty, the call uses Gemini. If that Gemini call fails, the request moves to Bedrock and flips between Claude and Nova. A missing Gemini key, or a Bedrock error, is the response. The function does not flip again after that. Debug on this Mac (`?debug=1`) still prefers a usable xAI key and otherwise uses Gemini. Bedrock needs no API key. Tokyo calls `jp.anthropic.claude-haiku-4-5-20251001-v1:0` and `amazon.nova-lite-v1:0`. Paris calls `eu.anthropic.claude-haiku-4-5-20251001-v1:0` and `eu.amazon.nova-lite-v1:0`. The role may call `bedrock:InvokeModel` only for those models.

The same template describes two copies. Paris stays `eu-west-3`. Tokyo is a second copy in `ap-northeast-1`. There is no Route 53, CloudFront, API Gateway, or DynamoDB global table. The phone stores both addresses and picks Tokyo only when its timezone is `Asia/Tokyo`. Enrollment is per region: the same phone key enrolls against whichever address it is calling. A different key still gets `409`. Enroll the phone before either address leaves the machine.

Three nested stacks, wired by `template.yaml`:

| Module | Owns | Does not own |
| --- | --- | --- |
| `modules/secret.yaml` | The secret containers | The key values |
| `modules/registry.yaml` | The device table | The enrolled public key |
| `modules/api.yaml` | The function and its function URL | The phrase |

CloudFormation creates the containers and deletes them with the stack. An update does not rewrite the values, because the template never sets them. The table is retained and has deletion protection. The enrolled phone is not wiped by an update.

IAM role names are global, so the Tokyo copy passes `RoleNameSuffix=-ap-northeast-1` and the role is `west2romaji-translate-ap-northeast-1`. The function, the secrets, and the device table keep their names. Those are regional. The phone enrolls its existing key the first time that region answers `401` with "not enrolled", then retries the translation once.

`make phoneinstall` reads `FUNCTION_URL` and `FUNCTION_URL_TOKYO` from `.env` and writes them into the iOS build. Leave `www/js/config.js` empty. Debug on this Mac (`?debug=1`) uses `.env` with the same model rule and does not use the function URL.

## What the phone will send

Both routes are `POST`, with a JSON body and two headers:

- `x-west2romaji-timestamp`: unix seconds
- `x-west2romaji-signature`: standard base64 of the ECDSA P-256 SHA-256 signature, DER encoded

The signed bytes are exactly:

```text
v1
POST
/enroll
1730000000
<hex sha256 of the raw body bytes>
```

The path is `/enroll` or `/translate`. The timestamp has to be within five minutes. A signature works once.

`POST /enroll` body:

```json
{"public_key": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"}
```

The public key must be ECDSA P-256, and it must be the key that signed the request. The first key is stored. A later different key gets `409`. The same key can enroll again, with a new signature.

`POST /translate` body:

```json
{"text": "Où est la gare ?"}
```

The response is `{ "japanese", "romaji", "source_lang", "region" }`. `region` is `AWS_REGION` on the function that answered, `eu-west-3` or `ap-northeast-1`. The phone shows it under the result.

Until a phone enrolls, anyone who can reach the enroll route and who holds some P-256 key can take the slot. Enroll the phone before that address leaves the machine. To open the slot again, delete the item whose `device_id` is `primary`. Leave the `sig#` items alone. They expire. The table's deletion protection blocks deleting the table, not that item.

## Names

| Name | What it is |
| --- | --- |
| `west2romaji` | CloudFormation stack. Termination protection is on. |
| `west2romaji/xai-api-key` | Secret. Used when the direct-call raffle picks xAI. |
| `west2romaji/gemini-api-key` | Secret. Used when the direct-call raffle picks Gemini. |
| `jp.anthropic.claude-haiku-4-5-20251001-v1:0` | Claude Haiku 4.5 in Tokyo. No key. |
| `eu.anthropic.claude-haiku-4-5-20251001-v1:0` | Claude Haiku 4.5 in Paris. No key. |
| `amazon.nova-lite-v1:0` | Nova Lite in Tokyo. No key. |
| `west2romaji-devices` | Enrollment table |
| `west2romaji-translate` | Function and function URL in each region. The Paris role uses this name. Tokyo passes `RoleNameSuffix=-ap-northeast-1`, so that role is `west2romaji-translate-ap-northeast-1`. |
