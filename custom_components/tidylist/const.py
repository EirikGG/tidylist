"""Constants for the Tidylist (add-on) integration."""

DOMAIN = "tidylist"

# The add-on's topics; see MqttBridge in the add-on.
BASE_TOPIC = "shopping_list"
STATUS_TOPIC = f"{BASE_TOPIC}/status"
STATE_TOPICS = f"{BASE_TOPIC}/list/+/state"
