"""
Azure AI Projects client setup and streaming logic.
"""
import json
from typing import Generator, Any
from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import ResponseStreamEventType


# Configuration - can be moved to environment variables
AZURE_ENDPOINT = "https://abpatra-7946-resource.services.ai.azure.com/api/projects/abpatra-7946"
WORKFLOW_NAME = "SelfCorrecting-Workflow"
WORKFLOW_VERSION = "10"


def get_project_client() -> AIProjectClient:
    """Create and return an AIProjectClient instance."""
    return AIProjectClient(
        endpoint=AZURE_ENDPOINT,
        credential=DefaultAzureCredential(),
    )


def stream_agent_response(query: str) -> Generator[dict, None, None]:
    """
    Stream agent responses for a given query.
    
    Yields SSE-formatted event dictionaries.
    """
    project_client = get_project_client()
    
    with project_client:
        openai_client = project_client.get_openai_client()
        conversation = openai_client.conversations.create()
        
        yield {
            "event": "conversation_created",
            "data": {"conversation_id": conversation.id}
        }
        
        try:
            stream = openai_client.responses.create(
                conversation=conversation.id,
                extra_body={"agent": {"name": WORKFLOW_NAME, "type": "agent_reference"}},
                input=query,
                stream=True,
                metadata={"x-ms-debug-mode-enabled": "1"},
            )
            
            for event in stream:
                sse_event = process_stream_event(event)
                if sse_event:
                    yield sse_event
                    
        except Exception as e:
            yield {
                "event": "error",
                "data": {"message": str(e)}
            }
        finally:
            # Cleanup conversation
            try:
                openai_client.conversations.delete(conversation_id=conversation.id)
                yield {
                    "event": "conversation_deleted",
                    "data": {"conversation_id": conversation.id}
                }
            except Exception:
                pass


def process_stream_event(event: Any) -> dict | None:
    """
    Process a stream event and return an SSE-formatted dictionary.
    """
    # ========== TEXT EVENTS ==========
    if event.type == ResponseStreamEventType.RESPONSE_OUTPUT_TEXT_DONE:
        return {
            "event": "text_done",
            "data": {"text": event.text}
        }
    
    elif event.type == ResponseStreamEventType.RESPONSE_OUTPUT_TEXT_DELTA:
        return {
            "event": "text_delta",
            "data": {"delta": event.delta}
        }
    
    # ========== WORKFLOW ACTION EVENTS ==========
    elif event.type == ResponseStreamEventType.RESPONSE_OUTPUT_ITEM_ADDED:
        item = getattr(event, 'item', None)
        if item:
            item_type = getattr(item, 'type', 'unknown')
            
            if item_type == "workflow_action":
                return {
                    "event": "action_started",
                    "data": {
                        "action_id": getattr(item, 'action_id', 'unknown'),
                        "status": getattr(item, 'status', 'unknown'),
                        "previous_action_id": getattr(item, 'previous_action_id', None)
                    }
                }
            
            elif item_type == "message":
                return {
                    "event": "message_started",
                    "data": {
                        "role": getattr(item, 'role', 'unknown'),
                        "id": getattr(item, 'id', 'N/A')
                    }
                }
            
            else:
                return {
                    "event": "item_added",
                    "data": {"type": item_type}
                }
    
    elif event.type == ResponseStreamEventType.RESPONSE_OUTPUT_ITEM_DONE:
        item = getattr(event, 'item', None)
        if item:
            item_type = getattr(item, 'type', 'unknown')
            
            if item_type == "workflow_action":
                return {
                    "event": "action_completed",
                    "data": {
                        "action_id": getattr(item, 'action_id', 'unknown'),
                        "status": getattr(item, 'status', 'unknown'),
                        "previous_action_id": getattr(item, 'previous_action_id', None)
                    }
                }
            
            elif item_type == "message":
                return {
                    "event": "message_done",
                    "data": {
                        "role": getattr(item, 'role', 'unknown'),
                        "id": getattr(item, 'id', 'N/A')
                    }
                }
            
            else:
                return {
                    "event": "item_done",
                    "data": {"type": item_type}
                }
    
    # ========== RESPONSE-LEVEL EVENTS ==========
    elif event.type == ResponseStreamEventType.RESPONSE_CREATED:
        return {
            "event": "response_status",
            "data": {
                "status": "created",
                "response_id": event.response.id
            }
        }
    
    elif event.type == ResponseStreamEventType.RESPONSE_IN_PROGRESS:
        return {
            "event": "response_status",
            "data": {"status": "in_progress"}
        }
    
    elif event.type == ResponseStreamEventType.RESPONSE_COMPLETED:
        usage_data = {}
        if hasattr(event.response, 'usage') and event.response.usage:
            usage = event.response.usage
            usage_data = {
                "input_tokens": getattr(usage, 'input_tokens', 0),
                "output_tokens": getattr(usage, 'output_tokens', 0)
            }
        return {
            "event": "response_status",
            "data": {
                "status": "completed",
                "usage": usage_data
            }
        }
    
    elif event.type == ResponseStreamEventType.RESPONSE_FAILED:
        error_msg = ""
        if hasattr(event, 'error'):
            error_msg = str(event.error)
        return {
            "event": "response_status",
            "data": {
                "status": "failed",
                "error": error_msg
            }
        }
    
    # ========== CONTENT PART EVENTS ==========
    elif event.type == "response.content_part.added":
        part = getattr(event, 'part', None)
        part_type = getattr(part, 'type', 'unknown') if part else 'unknown'
        return {
            "event": "content_part_added",
            "data": {
                "type": part_type,
                "content_index": getattr(event, 'content_index', 0)
            }
        }
    
    elif event.type == "response.content_part.done":
        part = getattr(event, 'part', None)
        part_type = getattr(part, 'type', 'unknown') if part else 'unknown'
        return {
            "event": "content_part_done",
            "data": {
                "type": part_type,
                "content_index": getattr(event, 'content_index', 0)
            }
        }
    
    # ========== ERROR EVENTS ==========
    elif event.type == ResponseStreamEventType.ERROR:
        return {
            "event": "error",
            "data": {"message": str(event)}
        }
    
    # Unknown event - log for debugging
    else:
        return {
            "event": "unknown",
            "data": {"type": str(event.type)}
        }
