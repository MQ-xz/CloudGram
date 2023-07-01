from pyrogram import Client

from config.settings import TELEGRAM_API_ID, TELEGRAM_API_HASH

telegram = Client("my_account", TELEGRAM_API_ID, TELEGRAM_API_HASH)
