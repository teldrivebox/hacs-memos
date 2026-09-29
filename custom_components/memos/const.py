"""Constants for the Memos integration."""
import logging

DOMAIN = "memos"
LOGGER = logging.getLogger(__package__)

# Configuration keys
CONF_HOST = "host"
CONF_ACCESS_TOKEN = "access_token"

# API paths
API_V1_PREFIX = "/api/v1"
API_PATH_MEMOS = "/memos"
API_PATH_USERS_ME = "/users/me"

# Panel constants
PANEL_NAME = "memos-panel"
PANEL_TITLE = "Memos"
PANEL_ICON = "mdi:note-text-outline"
PANEL_URL = "memos"
PANEL_STATIC_PATH = "/memos_static"
