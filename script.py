# Before running the sample:
#    pip install --pre azure-ai-projects>=2.0.0b1
#    pip install azure-identity

import os
from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import ResponseStreamEventType


project_client = AIProjectClient(
    endpoint="https://abpatra-7946-resource.services.ai.azure.com/api/projects/abpatra-7946",
    credential=DefaultAzureCredential(),
)

with project_client:

    workflow = {
        "name": "SelfCorrecting-Workflow",
        "version": "10",
    }
    
    openai_client = project_client.get_openai_client()

    conversation = openai_client.conversations.create()
    print(f"Created conversation (id: {conversation.id})")

    stream = openai_client.responses.create(
        conversation=conversation.id,
        extra_body={"agent": {"name": workflow["name"], "type": "agent_reference"}},
        input="What is generative AI?",
        stream=True,
        metadata={"x-ms-debug-mode-enabled": "1"},
    )

    for event in stream:
        # ========== TEXT EVENTS ==========
        if event.type == ResponseStreamEventType.RESPONSE_OUTPUT_TEXT_DONE:
            # Final complete text output from an agent
            print(f"\n📝 [TEXT COMPLETE]\n{event.text}\n")
        
        elif event.type == ResponseStreamEventType.RESPONSE_OUTPUT_TEXT_DELTA:
            # Streaming text chunk (real-time output)
            print(event.delta, end="", flush=True)
        
        # ========== WORKFLOW ACTION EVENTS ==========
        elif event.type == ResponseStreamEventType.RESPONSE_OUTPUT_ITEM_ADDED:
            item = getattr(event, 'item', None)
            if item:
                item_type = getattr(item, 'type', 'unknown')
                
                if item_type == "workflow_action":
                    print(f"\n{'='*50}")
                    print(f"🚀 STARTED: {item.action_id}")
                    if hasattr(item, 'status'):
                        print(f"   Status: {item.status}")
                    if hasattr(item, 'previous_action_id') and item.previous_action_id:
                        print(f"   After: {item.previous_action_id}")
                    print(f"{'='*50}")
                
                elif item_type == "message":
                    role = getattr(item, 'role', 'unknown')
                    item_id = getattr(item, 'id', 'N/A')
                    print(f"\n💬 MESSAGE STARTED: role={role}, id={item_id}")
                
                else:
                    # Other item types (e.g., function_call, function_call_output)
                    print(f"\n➕ Item Added: type={item_type}")
        
        elif event.type == ResponseStreamEventType.RESPONSE_OUTPUT_ITEM_DONE:
            item = getattr(event, 'item', None)
            if item:
                item_type = getattr(item, 'type', 'unknown')
                
                if item_type == "workflow_action":
                    print(f"\n{'='*50}")
                    print(f"✅ COMPLETED: {item.action_id}")
                    print(f"   Status: {item.status}")
                    if hasattr(item, 'previous_action_id') and item.previous_action_id:
                        print(f"   After: {item.previous_action_id}")
                    print(f"{'='*50}")
                
                elif item_type == "message":
                    role = getattr(item, 'role', 'unknown')
                    item_id = getattr(item, 'id', 'N/A')
                    print(f"\n💬 MESSAGE DONE: role={role}, id={item_id}")
                
                else:
                    print(f"\n✓ Item Done: type={item_type}")
        
        # ========== RESPONSE-LEVEL EVENTS ==========
        elif event.type == ResponseStreamEventType.RESPONSE_CREATED:
            print(f"\n🆕 Response Created: id={event.response.id}")
        
        elif event.type == ResponseStreamEventType.RESPONSE_IN_PROGRESS:
            print(f"\n⏳ Response In Progress...")
        
        elif event.type == ResponseStreamEventType.RESPONSE_COMPLETED:
            print(f"\n🏁 Response Completed!")
            # Print usage statistics if available
            if hasattr(event.response, 'usage') and event.response.usage:
                usage = event.response.usage
                print(f"   📊 Tokens - Input: {getattr(usage, 'input_tokens', 'N/A')}, Output: {getattr(usage, 'output_tokens', 'N/A')}")
        
        elif event.type == ResponseStreamEventType.RESPONSE_FAILED:
            print(f"\n❌ Response Failed!")
            if hasattr(event, 'error'):
                print(f"   Error: {event.error}")
        
        # ========== CONTENT PART EVENTS ==========
        # These events track individual content parts within a message
        elif event.type == "response.content_part.added":
            # A new content part started (text, image, audio, etc.)
            part = getattr(event, 'part', None)
            if part:
                part_type = getattr(part, 'type', 'unknown')
                print(f"\n📎 Content Part Added: type={part_type}, content_index={event.content_index}")
            else:
                print(f"\n📎 Content Part Added: index={event.content_index}")
        
        elif event.type == "response.content_part.done":
            # A content part finished
            part = getattr(event, 'part', None)
            if part:
                part_type = getattr(part, 'type', 'unknown')
                # If it's text, you could print the full text here
                if part_type == 'output_text' and hasattr(part, 'text'):
                    print(f"\n📎 Content Part Done: type={part_type}")
                    # Uncomment below to see the text (but TEXT_DONE already shows this)
                    # print(f"   Text: {part.text[:100]}..." if len(part.text) > 100 else f"   Text: {part.text}")
                else:
                    print(f"\n📎 Content Part Done: type={part_type}")
            else:
                print(f"\n📎 Content Part Done: index={event.content_index}")
        
        # ========== OTHER EVENTS ==========
        elif event.type == ResponseStreamEventType.ERROR:
            print(f"\n⚠️ Error Event: {event}")
        
        else:
            # Catch-all for unknown events - useful for debugging
            print(f"\n❓ Unknown event type: {event.type}")
            # Print all available attributes for debugging
            print(f"   Available attrs: {[attr for attr in dir(event) if not attr.startswith('_')]}")

    openai_client.conversations.delete(conversation_id=conversation.id)
    print("Conversation deleted")
