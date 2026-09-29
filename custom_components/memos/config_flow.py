"""Config flow for Memos integration."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import MemosApiClient, MemosApiError, MemosAuthError, MemosConnectionError
from .const import CONF_ACCESS_TOKEN, CONF_HOST, DOMAIN

_LOGGER = logging.getLogger(__name__)

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_HOST): str,
        vol.Required(CONF_ACCESS_TOKEN): str,
    }
)


class MemosConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Memos."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            host = user_input[CONF_HOST].strip()
            token = user_input[CONF_ACCESS_TOKEN].strip()

            session = async_get_clientsession(self.hass)
            client = MemosApiClient(host=host, token=token, session=session)

            await self.async_set_unique_id(client.base_url.lower())
            self._abort_if_unique_id_configured()

            try:
                user_info = await client.async_validate_auth()
            except MemosAuthError:
                errors["base"] = "invalid_auth"
            except (MemosConnectionError, MemosApiError):
                errors["base"] = "cannot_connect"
            except Exception as err:
                _LOGGER.exception("Unexpected exception in config flow: %s", err)
                errors["base"] = "unknown"
            else:
                username = ""
                if isinstance(user_info, dict):
                    username = (
                        user_info.get("displayName")
                        or user_info.get("username")
                        or user_info.get("nickname")
                        or ""
                    )
                title = f"Memos ({username})" if username else f"Memos ({host})"

                return self.async_create_entry(
                    title=title,
                    data={
                        CONF_HOST: host,
                        CONF_ACCESS_TOKEN: token,
                    },
                )

        return self.async_show_form(
            step_id="user",
            data_schema=STEP_USER_DATA_SCHEMA,
            errors=errors,
        )
