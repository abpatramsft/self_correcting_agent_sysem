"""
FastAPI backend for Self-Correcting Agents Web UI.
Provides SSE streaming endpoint for agent responses.
"""
import json
import asyncio
import queue
import threading
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from azure_client import stream_agent_response


app = FastAPI(title="Self-Correcting Agents API")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    query: str


async def event_generator(query: str):
    """
    Async generator that yields SSE-formatted events in real-time.
    Uses a queue to bridge sync generator to async streaming.
    """
    event_queue = queue.Queue()
    
    def run_sync_generator():
        """Run the sync generator and put events in queue."""
        try:
            for event in stream_agent_response(query):
                event_queue.put(event)
            event_queue.put(None)  # Signal completion
        except Exception as e:
            event_queue.put({"event": "error", "data": {"message": str(e)}})
            event_queue.put(None)
    
    # Start the sync generator in a background thread
    thread = threading.Thread(target=run_sync_generator, daemon=True)
    thread.start()
    
    # Yield events as they arrive
    try:
        while True:
            # Check queue with small timeout to allow async cooperation
            try:
                event = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: event_queue.get(timeout=0.1)
                )
            except queue.Empty:
                continue
            
            if event is None:  # Completion signal
                break
                
            event_type = event.get("event", "message")
            event_data = json.dumps(event.get("data", {}))
            yield f"event: {event_type}\ndata: {event_data}\n\n"
            
    except Exception as e:
        error_data = json.dumps({"message": str(e)})
        yield f"event: error\ndata: {error_data}\n\n"
    
    # Send done event
    yield f"event: done\ndata: {{}}\n\n"


@app.post("/api/chat")
async def chat(request: ChatRequest):
    """
    Stream agent responses for a given query using Server-Sent Events.
    """
    return StreamingResponse(
        event_generator(request.query),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
