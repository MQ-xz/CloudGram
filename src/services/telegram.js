import { TelegramClient } from "telegram";
import { StoreSession } from 'telegram/sessions'

import { API_ID, API_HASH } from "../config/config";

const SESSION = new StoreSession('') //create a new StringSession, also you can use StoreSession

const client = new TelegramClient(SESSION, API_ID, API_HASH, { connectionRetries: 5 }) // Immediately create a client using your application data
client.connect()

export default client 