"""API client for Memos v1 API."""
from __future__ import annotations

import asyncio
import logging
from typing import Any
from urllib.parse import urlparse

import aiohttp

from .const import API_PATH_MEMOS, API_V1_PREFIX

_LOGGER = logging.getLogger(__name__)


class MemosApiError(Exception):
    """Base exception for Memos API errors."""


class MemosAuthError(MemosApiError):
    """Exception raised when authentication fails (HTTP 401/403)."""


class MemosConnectionError(MemosApiError):
    """Exception raised when connection to the Memos server fails."""


class MemosApiClient:
    """Client for interacting with the Memos v1 API."""

    def __init__(
        self,
        host: str,
        token: str,
        session: aiohttp.ClientSession,
    ) -> None:
        """Initialize the API client."""
        self._host = self._sanitize_host(host)
        self._token = token.strip()
        self._session = session
        self._user: dict[str, Any] | None = None

    @property
    def user(self) -> dict[str, Any] | None:
        """Return cached user info."""
        return self._user

    @property
    def host(self) -> str:
        """Return base host URL."""
        return self._host

    @property
    def base_url(self) -> str:
        """Return the API v1 base URL."""
        return f"{self._host}{API_V1_PREFIX}"

    @staticmethod
    def _sanitize_host(host: str) -> str:
        """Clean and normalize the host URL."""
        url = host.strip().rstrip("/")
        if not url.startswith(("http://", "https://")):
            url = f"http://{url}"

        parsed = urlparse(url)
        path = parsed.path.rstrip("/")
        if path.endswith("/api/v1"):
            path = path[:-7]

        netloc = parsed.netloc
        scheme = parsed.scheme
        return f"{scheme}://{netloc}{path}".rstrip("/")

    def _get_headers(self) -> dict[str, str]:
        """Get standard HTTP headers for requests."""
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    async def _request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> Any:
        """Execute an HTTP request with error handling."""
        if not path.startswith("/"):
            path = f"/{path}"

        url = f"{self.base_url}{path}"
        headers = self._get_headers()

        try:
            async with self._session.request(
                method=method,
                url=url,
                headers=headers,
                params=params,
                json=json,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as response:
                if response.status in (401, 403):
                    text = await response.text()
                    _LOGGER.error("Memos auth error (%s): %s", response.status, text)
                    raise MemosAuthError(f"Authentication failed (HTTP {response.status})")

                if response.status >= 400:
                    text = await response.text()
                    _LOGGER.error("Memos API error (%s) on %s: %s", response.status, url, text)
                    raise MemosApiError(f"HTTP {response.status}: {text}")

                if response.status == 204:
                    return None

                return await response.json()

        except aiohttp.ClientConnectorError as err:
            _LOGGER.error("Cannot connect to Memos at %s: %s", url, err)
            raise MemosConnectionError(f"Connection failed: {err}") from err
        except asyncio.TimeoutError as err:
            _LOGGER.error("Timeout connecting to Memos at %s", url)
            raise MemosConnectionError("Request timed out") from err
        except (MemosApiError, MemosAuthError, MemosConnectionError):
            raise
        except Exception as err:
            _LOGGER.error("Unexpected error contacting Memos: %s", err)
            raise MemosApiError(f"Unexpected error: {err}") from err

    async def async_get_current_user(self) -> dict[str, Any] | None:
        """Fetch current authenticated user info."""
        try:
            data = await self._request("GET", "/auth/me")
            if isinstance(data, dict):
                self._user = data.get("user") or data
                return self._user
        except Exception as err:
            _LOGGER.debug("Could not fetch current Memos user info: %s", err)
        return None

    async def async_get_user_settings(self, user_name: str | None = None) -> dict[str, Any] | None:
        """Fetch user settings including default memo visibility."""
        target_name = user_name or (self._user.get("name") if self._user else None)
        if not target_name:
            user = await self.async_get_current_user()
            target_name = user.get("name") if user else None

        if not target_name:
            return None

        clean_name = target_name.lstrip("/")
        try:
            data = await self._request("GET", f"/{clean_name}/settings")
            if isinstance(data, dict):
                for item in data.get("settings", []):
                    if "generalSetting" in item:
                        return item["generalSetting"]
        except Exception as err:
            _LOGGER.debug("Could not fetch Memos user settings: %s", err)
        return None

    async def async_validate_auth(self) -> dict[str, Any] | None:
        """Validate connection and token, returning user info if available."""
        user = await self.async_get_current_user()
        await self._request("GET", API_PATH_MEMOS, params={"pageSize": 1})
        return user

    async def async_get_memos(self, page_size: int = 100) -> list[dict[str, Any]]:
        """Fetch readable memos without tag restriction."""
        params: dict[str, Any] = {
            "pageSize": page_size,
            "state": "NORMAL",
        }
        data = await self._request("GET", API_PATH_MEMOS, params=params)
        if isinstance(data, dict):
            return data.get("memos", [])
        return []

    async def async_get_raw_attachment(self, path: str) -> tuple[bytes, str]:
        """Fetch raw attachment file by relative or full path."""
        if path.startswith(("http://", "https://")):
            url = path
        else:
            clean_path = path.lstrip("/")
            url = f"{self._host}/{clean_path}"

        headers = {"Authorization": f"Bearer {self._token}"}
        async with self._session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=20)) as resp:
            content_type = resp.headers.get("Content-Type", "application/octet-stream")
            data = await resp.read()
            return data, content_type

    async def async_create_memo(self, content: str, visibility: str = "PRIVATE") -> dict[str, Any]:
        """Create a new memo."""
        payload = {
            "content": content,
            "visibility": visibility,
        }
        res = await self._request("POST", API_PATH_MEMOS, json=payload)
        return res or {}

    async def async_update_memo(
        self,
        name: str,
        content: str,
        visibility: str | None = None,
    ) -> dict[str, Any]:
        """Update a memo by name ('memos/{id}') with optional visibility."""
        clean_name = name.lstrip("/")
        path = f"/{clean_name}"
        payload: dict[str, Any] = {"content": content}
        update_mask = ["content"]
        if visibility:
            payload["visibility"] = visibility
            update_mask.append("visibility")

        params = {"updateMask": ",".join(update_mask)}
        res = await self._request("PATCH", path, params=params, json=payload)
        return res or {}

    async def async_delete_memo(self, name: str) -> None:
        """Delete a memo by name ('memos/{id}')."""
        clean_name = name.lstrip("/")
        path = f"/{clean_name}"
        await self._request("DELETE", path)
