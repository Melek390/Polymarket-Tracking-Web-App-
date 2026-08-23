"""Parse an httpx response's JSON body off the event loop.

A large body (the 700 KB MLB live feed, a Gamma events page, a hydrated
whole-day schedule) takes tens to hundreds of ms to parse — an eternity next
to the 1-3s poll jobs that share the loop. py-spy on prod (Aug 23) showed
those parses among the top loop burners while the app felt frozen. Small
payloads (a linescore, a price dict) should keep calling r.json() directly:
the thread hop costs more than the parse.
"""
import asyncio


async def json_off_loop(response):
    return await asyncio.to_thread(response.json)
