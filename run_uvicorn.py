import sys
import asyncio

if sys.platform.startswith("win"):
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        pass

if __name__ == "__main__":
    # Import uvicorn after setting the loop policy so it uses the Proactor loop on Windows
    import uvicorn

    uvicorn.run("backend.rest_api.main:app", host="127.0.0.1", port=8000, reload=False)
