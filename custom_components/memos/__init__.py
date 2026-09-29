"""The Memos integration."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from aiohttp import web

from homeassistant.components import frontend
from homeassistant.components.http import HomeAssistantView
try:
    from homeassistant.components.http import StaticPathConfig
except ImportError:
    StaticPathConfig = None

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import MemosApiClient, MemosApiError
from .const import (
    CONF_ACCESS_TOKEN,
    CONF_HOST,
    DOMAIN,
    PANEL_ICON,
    PANEL_NAME,
    PANEL_STATIC_PATH,
    PANEL_TITLE,
    PANEL_URL,
)

_LOGGER = logging.getLogger(__name__)


class MemosFeedView(HomeAssistantView):
    """View to return memos feed to the frontend."""

    url = "/api/memos/feed"
    name = "api:memos:feed"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the view."""
        self.hass = hass

    async def get(self, request: web.Request) -> web.Response:
        """Handle GET request for memos."""
        entries = self.hass.data.get(DOMAIN, {})
        if not entries:
            return self.json({"error": "Memos is not configured"}, status=400)

        # Use first active client
        client: MemosApiClient = next(iter(entries.values()))
        try:
            memos = await client.async_get_memos(page_size=100)
            user = client.user
            if not user:
                user = await client.async_get_current_user()

            default_visibility = "PROTECTED"
            settings = await client.async_get_user_settings()
            if settings and "memoVisibility" in settings:
                default_visibility = settings["memoVisibility"]

            return self.json({
                "memos": memos,
                "host": client.host,
                "user": user,
                "default_visibility": default_visibility,
            })
        except MemosApiError as err:
            return self.json({"error": str(err)}, status=500)


class MemosAttachmentView(HomeAssistantView):
    """View to proxy attachment images securely with the stored API token."""

    url = "/api/memos/attachment"
    name = "api:memos:attachment"
    requires_auth = False

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the view."""
        self.hass = hass

    async def get(self, request: web.Request) -> web.Response:
        """Handle GET request for attachments."""
        entries = self.hass.data.get(DOMAIN, {})
        if not entries:
            return web.Response(status=400, text="Memos not configured")

        path = request.query.get("path")
        filename = request.query.get("filename")
        if not path:
            return web.Response(status=400, text="Missing path parameter")

        client: MemosApiClient = next(iter(entries.values()))
        try:
            data, content_type = await client.async_get_raw_attachment(path, filename)
            return web.Response(
                body=data,
                content_type=content_type,
                headers={"Cache-Control": "public, max-age=86400"},
            )
        except Exception as err:
            _LOGGER.error("Failed to proxy memo attachment '%s': %s", path, err)
            return web.Response(status=500, text="Failed to retrieve attachment")


class MemosUploadView(HomeAssistantView):
    """View to upload an image or attachment file to Memos."""

    url = "/api/memos/upload"
    name = "api:memos:upload"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the view."""
        self.hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Handle POST file upload."""
        entries = self.hass.data.get(DOMAIN, {})
        if not entries:
            return self.json({"error": "Memos is not configured"}, status_code=400)

        client: MemosApiClient = next(iter(entries.values()))

        try:
            filename = "image.png"
            content_type = "image/png"
            data: bytes = b""

            # Check if multipart or JSON base64
            if request.content_type.startswith("multipart/"):
                reader = await request.multipart()
                while True:
                    part = await reader.next()
                    if part is None:
                        break
                    if part.filename:
                        filename = part.filename
                        content_type = part.headers.get("Content-Type", "image/png")
                        data = await part.read()
                        break
            else:
                body = await request.json()
                import base64
                filename = body.get("filename", "image.png")
                content_type = body.get("content_type", "image/png")
                b64_data = body.get("data", "")
                if "," in b64_data:
                    b64_data = b64_data.split(",", 1)[1]
                data = base64.b64decode(b64_data)

            if not data:
                return self.json({"error": "No file data received"}, status_code=400)

            res = await client.async_upload_resource(
                filename=filename,
                content_type=content_type,
                data=data,
            )
            return self.json({"success": True, "resource": res})
        except MemosApiError as err:
            _LOGGER.error("Memos API upload error: %s", err)
            return self.json({"error": str(err)}, status_code=500)
        except Exception as err:
            _LOGGER.exception("Unexpected error uploading file to Memos: %s", err)
            return self.json({"error": f"Internal upload error: {err}"}, status_code=500)


class MemosCreateView(HomeAssistantView):
    """View to create a new memo via frontend."""

    url = "/api/memos/create"
    name = "api:memos:create"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the view."""
        self.hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Handle POST request to create a memo."""
        entries = self.hass.data.get(DOMAIN, {})
        if not entries:
            return self.json({"error": "Memos is not configured"}, status_code=400)

        try:
            body = await request.json()
        except Exception:
            return self.json({"error": "Invalid JSON body"}, status_code=400)

        content = (body.get("content") or "").strip()
        resource_names = body.get("resource_names") or []
        if not content and not resource_names:
            return self.json({"error": "Content or image cannot be empty"}, status_code=400)

        visibility = body.get("visibility", "PRIVATE")
        client: MemosApiClient = next(iter(entries.values()))
        try:
            memo = await client.async_create_memo(
                content=content,
                visibility=visibility,
                resource_names=resource_names,
            )
            return self.json({"success": True, "memo": memo})
        except MemosApiError as err:
            return self.json({"error": str(err)}, status_code=500)


class MemosUpdateView(HomeAssistantView):
    """View to update a memo."""

    url = "/api/memos/update"
    name = "api:memos:update"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the view."""
        self.hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Handle POST request to update a memo."""
        entries = self.hass.data.get(DOMAIN, {})
        if not entries:
            return self.json({"error": "Memos is not configured"}, status_code=400)

        try:
            body = await request.json()
        except Exception:
            return self.json({"error": "Invalid JSON body"}, status_code=400)

        name = (body.get("name") or "").strip()
        content = (body.get("content") or "").strip()
        visibility = body.get("visibility")
        if not name or not content:
            return self.json({"error": "Name and content are required"}, status_code=400)

        client: MemosApiClient = next(iter(entries.values()))
        try:
            memo = await client.async_update_memo(name=name, content=content, visibility=visibility)
            return self.json({"success": True, "memo": memo})
        except MemosApiError as err:
            return self.json({"error": str(err)}, status_code=500)


class MemosDeleteView(HomeAssistantView):
    """View to delete a memo."""

    url = "/api/memos/delete"
    name = "api:memos:delete"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the view."""
        self.hass = hass

    async def post(self, request: web.Request) -> web.Response:
        """Handle POST request to delete a memo."""
        entries = self.hass.data.get(DOMAIN, {})
        if not entries:
            return self.json({"error": "Memos is not configured"}, status_code=400)

        try:
            body = await request.json()
        except Exception:
            return self.json({"error": "Invalid JSON body"}, status_code=400)

        name = (body.get("name") or "").strip()
        if not name:
            return self.json({"error": "Name is required"}, status_code=400)

        client: MemosApiClient = next(iter(entries.values()))
        try:
            await client.async_delete_memo(name=name)
            return self.json({"success": True, "name": name})
        except MemosApiError as err:
            return self.json({"error": str(err)}, status_code=500)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Memos from a config entry."""
    host = entry.data[CONF_HOST]
    token = entry.data[CONF_ACCESS_TOKEN]

    session = async_get_clientsession(hass)
    client = MemosApiClient(host=host, token=token, session=session)

    # Automatically fetch user info and update entry title if it contains URL or default
    try:
        user_info = await client.async_get_current_user()
        if user_info:
            username = (
                user_info.get("displayName")
                or user_info.get("username")
                or user_info.get("nickname")
                or ""
            )
            if username and (
                "http://" in entry.title
                or "https://" in entry.title
                or entry.title == "Memos"
            ):
                hass.config_entries.async_update_entry(
                    entry, title=f"Memos ({username})"
                )
    except Exception as err:
        _LOGGER.debug("Could not auto-update Memos entry title: %s", err)

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = client

    # Register static directory for custom panel
    frontend_path = str(Path(__file__).parent / "frontend")
    if hasattr(hass.http, "async_register_static_paths") and StaticPathConfig is not None:
        await hass.http.async_register_static_paths(
            [StaticPathConfig(PANEL_STATIC_PATH, frontend_path, cache_headers=False)]
        )
    elif hasattr(hass.http, "register_static_path"):
        hass.http.register_static_path(PANEL_STATIC_PATH, frontend_path, cache_headers=False)

    # Register HTTP views
    if len(hass.data[DOMAIN]) == 1:
        hass.http.register_view(MemosFeedView(hass))
        hass.http.register_view(MemosAttachmentView(hass))
        hass.http.register_view(MemosUploadView(hass))
        hass.http.register_view(MemosCreateView(hass))
        hass.http.register_view(MemosUpdateView(hass))
        hass.http.register_view(MemosDeleteView(hass))

        # Register sidebar panel automatically
        frontend.async_register_built_in_panel(
            hass,
            component_name="custom",
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            frontend_url_path=PANEL_URL,
            config={
                "_panel_custom": {
                    "name": PANEL_NAME,
                    "module_url": f"{PANEL_STATIC_PATH}/memos-panel.js?v=0.2.3",
                }
            },
            require_admin=False,
        )

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    hass.data[DOMAIN].pop(entry.entry_id, None)

    # If no more entries, remove panel
    if not hass.data.get(DOMAIN):
        frontend.async_remove_panel(hass, PANEL_URL)

    return True
