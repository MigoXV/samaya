"""Validate pasted images and compose native multimodal input."""

import base64
import binascii
import re

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024


def message_inputs(text: str, images: list) -> list[dict]:
    if not isinstance(text, str):
        raise ValueError("无效的消息文本")  # noqa: TRY004 - operation rejection
    if not isinstance(images, list) or len(images) > 5:
        raise ValueError("每条消息最多添加 5 张图片")
    inputs = [{"type": "text", "text": text}] if text.strip() else []
    total = 0
    for image in images:
        url = image.get("url") if isinstance(image, dict) else None
        if not isinstance(url, str) or len(url) > 4 * ((MAX_IMAGE_BYTES + 2) // 3) + 64:
            raise ValueError("每张图片应小于等于 5 MB")
        match = re.fullmatch(
            r"data:image/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)", url
        )
        if not match:
            raise ValueError("支持粘贴 PNG、JPEG、WebP 或 GIF 图片")
        try:
            data = base64.b64decode(match[2], validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ValueError("图片编码无效，请重新粘贴") from exc
        signatures = {
            "png": data.startswith(b"\x89PNG\r\n\x1a\n"),
            "jpeg": data.startswith(b"\xff\xd8\xff"),
            "gif": data.startswith((b"GIF87a", b"GIF89a")),
            "webp": data.startswith(b"RIFF") and data[8:12] == b"WEBP",
        }
        if not data or len(data) > MAX_IMAGE_BYTES or not signatures[match[1]]:
            raise ValueError("图片内容无效或超过 5 MB，请重新粘贴")
        total += len(data)
        if total > MAX_TOTAL_IMAGE_BYTES:
            raise ValueError("每条消息的图片总大小不能超过 10 MB")
        inputs.append({"type": "image", "url": url})
    if not inputs:
        raise ValueError("消息不能为空")
    return inputs
